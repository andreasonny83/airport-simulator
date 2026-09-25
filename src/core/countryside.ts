/**
 * Countryside round the airports: roads (with bridges where they cross the
 * river), a village, farmland fields with hedgerows, and woods.
 *
 * Decoration only, like the rest of core/scenery.ts, and pure data so the
 * layout is deterministic: the same world size always gets the same land.
 *
 * Built in this order, each step keeping clear of the previous ones:
 *
 *   1. village centre: the clearest spot in the south of the field, between
 *      the airports;
 *   2. roads: A* over a coarse grid, joining each airport's terminal, the
 *      village and a few points out in the country. The airports are no-go,
 *      the river is very expensive to cross (so each road crosses once, at
 *      a narrow spot: that's a bridge), and existing road is cheap (so later
 *      roads join earlier ones and the whole thing reads as one network);
 *   3. houses along the roads near the village centre, plus its church;
 *   4. fields: a slightly rotated patchwork grid over the map. Noise decides
 *      each cell: woods, open meadow, or a crop field ringed by hedgerows.
 */
import {
  COUNTRYSIDE_REACH,
  FIELD_ANGLE,
  FIELD_SIZE_MAX,
  FIELD_SIZE_MIN,
  HEDGE_GAP,
  ROAD_CLEARANCE,
  ROAD_WIDTH,
  SCENERY_SEED,
  VILLAGE_RADIUS,
} from "../config";
import {
  arcLengths,
  clipHalfPlane,
  convexPolygonsNear,
  distanceToPolygon,
  distanceToSegment,
  nearestOnPolyline,
  pointInPolygon,
  resamplePolyline,
  roundCorners,
} from "./geometry";
import { lerp, mulberry32 } from "./math";
import type { Airport } from "./airports";
import { streamOuterHalfWidth, valueNoise, type Bounds, type StreamPoint } from "./scenery";
import type { Rng, Vec2, WorldSize } from "./types";

export type CropKind = "wheat" | "soil" | "greenCrop" | "hay";

export interface Field {
  /** Convex outline, inset from its neighbours by the hedgerow gap. */
  corners: Vec2[];
  crop: CropKind;
  /** Direction the crop rows run (radians). */
  rowHeading: number;
}

export interface Hedge {
  a: Vec2;
  b: Vec2;
}

export type HouseKind = "house" | "cottage" | "barn" | "church";

export interface House {
  kind: HouseKind;
  pos: Vec2;
  /** Direction the ridge runs (radians); houses line up with their road. */
  heading: number;
  /** 0..1, picks wall and roof colours. */
  tint: number;
}

/** A road's centreline, smoothed. */
export interface Road {
  points: Vec2[];
}

/**
 * A bridge: the stretch of a road that crosses the river, ramps included.
 * The middle (`wetFrom`–`wetTo`, over the water) is a drawbridge: its two
 * leaves lift to let sailboats through (see core/bridges.ts).
 */
export interface Bridge {
  /** Index of the road it carries, and the stretch of its points it replaces. */
  road: number;
  from: number;
  to: number;
  /** The road's centreline over the bridge (`road.points[from..to]`), ~1 unit apart. */
  points: Vec2[];
  /** Distance along `points` where the water starts and ends (the leaves' pivots). */
  wetFrom: number;
  wetTo: number;
}

/** Where roads meet or end. */
export interface RoadNode {
  pos: Vec2;
  /**
   * junction: where roads meet; edge: a road running off the map (cars come
   * and go here, out in the haze); entrance: a car park's gate.
   */
  kind: "junction" | "edge" | "entrance";
  /** For entrances: index of the airport (see `layoutAirports`) it serves. */
  airport?: number;
}

/** A stretch of road between two nodes, along the drawn centreline. */
export interface RoadEdge {
  a: number;
  b: number;
  /** Centreline from node `a` to node `b`. */
  points: Vec2[];
  length: number;
}

/** The roads as a graph, for routing traffic along exactly what's drawn. */
export interface RoadNetwork {
  nodes: RoadNode[];
  edges: RoadEdge[];
}

export interface Countryside {
  /** Roads as drawn: each stretch once, joining the network at junctions. */
  roads: Road[];
  /** The same roads as a graph (see `RoadNetwork`). */
  network: RoadNetwork;
  bridges: Bridge[];
  village: Vec2 | null;
  houses: House[];
  fields: Field[];
  hedges: Hedge[];
  /** Tree spots in woods and along hedgerows (added to the scattered trees). */
  woodland: Vec2[];
}

/** Road grid cell size (world units). */
const CELL = 2;
/** Noise seed for woods/meadow/crop patches (not the grass colour's). */
const LAND_USE_SEED = 0x1a2d;
/**
 * How busy the land is. Noise in each patchwork cell is compared against
 * these shares: below `WOODS_SHARE` woods, then `MEADOW_SHARE` of open
 * grass, the rest crop fields. Woods are planted a tree every
 * `WOOD_SPACING` (jittered); hedgerows grow a tree at a spot with
 * `HEDGE_TREE_CHANCE`, and each field edge has a hedge with `HEDGE_CHANCE`.
 */
const WOODS_SHARE = 0.26;
const MEADOW_SHARE = 0.32;
const WOOD_SPACING = 2.6;
const HEDGE_TREE_CHANCE = 0.1;
const HEDGE_CHANCE = 0.75;
/** Cost multipliers for the road planner. */
const WATER_COST = 40;
const REUSE_COST = 0.35;

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function buildCountryside(
  world: WorldSize,
  map: Bounds,
  airports: readonly Airport[],
  obstacles: readonly (readonly Vec2[])[],
  stream: readonly StreamPoint[],
): Countryside {
  const rng = mulberry32(SCENERY_SEED ^ 0xc0de);
  const area = countrysideArea(map);
  const onWater = (p: Vec2) => nearBank(p, stream, 0.6);
  // Bounding boxes first: most points are nowhere near an airport.
  const boxes = obstacles.map((o) => ({
    minX: Math.min(...o.map((q) => q.x)),
    maxX: Math.max(...o.map((q) => q.x)),
    minY: Math.min(...o.map((q) => q.y)),
    maxY: Math.max(...o.map((q) => q.y)),
  }));
  const clearOf = (p: Vec2, gap: number) =>
    obstacles.every((o, i) => {
      const b = boxes[i]!;
      if (p.x < b.minX - gap || p.x > b.maxX + gap || p.y < b.minY - gap || p.y > b.maxY + gap) {
        return true;
      }
      return distanceToPolygon(p, o) >= gap;
    });

  const village = pickVillage(world, clearOf, onWater);

  // --- Roads ---------------------------------------------------------------
  // Roads plan over the whole map, so the out-of-town ones run right off
  // into the horizon (they fade with the grass) instead of stopping short.
  const grid = new RoadGrid(map, (p) => !clearOf(p, ROAD_CLEARANCE), onWater);
  const ends: Vec2[] = [];
  const leads: Vec2[] = [];
  /** Airport index of each entry in `ends` / `leads`. */
  const entranceOf: number[] = [];
  for (const [index, a] of airports.entries()) {
    if (!a.landside) continue;
    entranceOf.push(index);
    const d = { x: Math.cos(a.landside.direction), y: Math.sin(a.landside.direction) };
    ends.push(a.landside.entrance);
    // Drive straight out of the car park before the planner takes over.
    leads.push({
      x: a.landside.entrance.x + d.x * (ROAD_CLEARANCE + 2),
      y: a.landside.entrance.y + d.y * (ROAD_CLEARANCE + 2),
    });
  }
  const cx = (map.minX + map.maxX) / 2;
  const hub = village ?? { x: world.width / 2, y: world.height * 0.9 };
  // Out-of-town ends at the map's edge: west and east along the village's
  // latitude, and north across the river (so there's a bridge on screen).
  const northX = leads.length > 0 ? leads[leads.length - 1]!.x : cx;
  const country = [
    { x: map.minX + 1, y: hub.y },
    { x: map.maxX - 1, y: hub.y - 10 },
    { x: northX, y: map.minY + 1 },
  ];

  // Each airport to the village, the village out west and east, and the
  // last airport (blue/yellow's, whose terminal faces the river) north
  // over the river. `prefix` is the stretch out of the car park.
  const trips: { from: Vec2; to: Vec2; prefix: Vec2[]; airport?: number }[] = [];
  leads.forEach((lead, i) =>
    trips.push({ from: lead, to: hub, prefix: [ends[i]!], airport: entranceOf[i] }),
  );
  trips.push({ from: hub, to: country[0]!, prefix: [] });
  trips.push({ from: hub, to: country[1]!, prefix: [] });
  const lastLead = leads[leads.length - 1];
  trips.push(
    lastLead
      ? {
          from: lastLead,
          to: country[2]!,
          prefix: [ends[ends.length - 1]!],
          airport: entranceOf[entranceOf.length - 1],
        }
      : { from: hub, to: country[2]!, prefix: [] },
  );

  // Plan every trip; the stretches not already paved become new roads. A
  // road that branches off (or back onto) the network has its end snapped
  // onto the other road's actual, smoothed centreline, so it really meets
  // it: the grid cell it was planned to join can be ~2 units off that line.
  const roads: Road[] = [];
  const joins: Join[] = [];
  const entrances: { road: number; airport: number }[] = [];
  for (const trip of trips) {
    const cells = grid.route(trip.from, trip.to);
    if (!cells) continue;
    for (const run of grid.newRuns(cells)) {
      const pts = run.cells.map((c) => grid.center(c));
      const fromTripStart = run.cells[0] === cells[0];
      if (fromTripStart) pts.unshift(...trip.prefix);
      if (pts.length < 2) continue;
      const road: Road = { points: smooth(pts) };
      const index = roads.length;
      for (const end of ["start", "end"] as const) {
        const joined = end === "start" ? run.joinStart : run.joinEnd;
        if (!joined || roads.length === 0) continue;
        const at = end === "start" ? 0 : road.points.length - 1;
        const snap = snapToRoads(road.points[at]!, roads);
        road.points[at] = snap.point;
        joins.push({ road: index, end, onto: snap.road, along: snap.along, point: snap.point });
      }
      if (fromTripStart && trip.airport !== undefined && trip.prefix.length > 0) {
        entrances.push({ road: index, airport: trip.airport });
      }
      roads.push(road);
    }
    grid.pave(cells);
  }
  const network = buildNetwork(roads, joins, entrances, map);

  const bridges = roads.flatMap((r, i) => findBridges(r.points, i, stream));
  const nearRoad = (p: Vec2, gap: number) =>
    roads.some((r) => distanceToPolylineCheap(p, r.points) < gap);

  // --- Village -------------------------------------------------------------
  const houses = village ? placeHouses(village, roads, rng, clearOf, onWater, stream) : [];
  const nearHouse = (p: Vec2, gap: number) =>
    houses.some((h) => Math.hypot(h.pos.x - p.x, h.pos.y - p.y) < gap);

  // --- Fields & woods ------------------------------------------------------
  // A field must be clear all over, not just at a few sample points: a road
  // or the river can cut straight across the middle.
  const fieldBlocked = (poly: readonly Vec2[]) =>
    obstacles.some((o) => convexPolygonsNear(poly, o, 2)) ||
    stream.some((p) => distanceToPolygon(p, poly) < streamOuterHalfWidth(p) + 2) ||
    roads.some((r) => r.points.some((q) => distanceToPolygon(q, poly) < ROAD_WIDTH / 2 + 1.5)) ||
    houses.some((h) => distanceToPolygon(h.pos, poly) < 4.5) ||
    (village !== null && distanceToPolygon(village, poly) < VILLAGE_RADIUS * 0.8);

  const fields: Field[] = [];
  const hedges: Hedge[] = [];
  const woodland: Vec2[] = [];
  for (const cell of patchwork(area, rng)) {
    const roll = rng();
    const cropRoll = rng();
    const c = centroid(cell);
    const use = landUse(c, roll);
    if (use === "meadow") continue;
    const inset = insetQuad(cell, HEDGE_GAP);
    if (use === "woods") {
      // Individual trees: fine right up to roads and fields.
      for (const p of scatterIn(cell, WOOD_SPACING, rng)) {
        if (
          !clearOf(p, 1.5) ||
          distanceToBank(p, stream) < 2.5 ||
          nearRoad(p, ROAD_WIDTH / 2 + 1.2) ||
          nearHouse(p, 3)
        ) {
          continue;
        }
        woodland.push(p);
      }
      continue;
    }
    if (fieldBlocked(inset)) continue;
    const crop: CropKind =
      cropRoll < 0.34 ? "wheat" : cropRoll < 0.58 ? "greenCrop" : cropRoll < 0.8 ? "soil" : "hay";
    const e0 = { x: inset[1]!.x - inset[0]!.x, y: inset[1]!.y - inset[0]!.y };
    const e1 = { x: inset[2]!.x - inset[1]!.x, y: inset[2]!.y - inset[1]!.y };
    const long = Math.hypot(e0.x, e0.y) >= Math.hypot(e1.x, e1.y) ? e0 : e1;
    fields.push({ corners: inset, crop, rowHeading: Math.atan2(long.y, long.x) });
    // Hedgerows round the outside, with the odd tree growing out of them.
    for (let i = 0; i < inset.length; i++) {
      const a = inset[i]!;
      const b = inset[(i + 1) % inset.length]!;
      // Some field edges are open: no hedge, and no hedgerow trees.
      if (rng() > HEDGE_CHANCE) continue;
      const out = offsetEdge(a, b, c, HEDGE_GAP / 2);
      hedges.push(out);
      const len = Math.hypot(out.b.x - out.a.x, out.b.y - out.a.y);
      for (let t = 3; t < len - 3; t += 7) {
        if (rng() < HEDGE_TREE_CHANCE) {
          woodland.push({
            x: lerp(out.a.x, out.b.x, t / len),
            y: lerp(out.a.y, out.b.y, t / len),
          });
        }
      }
    }
  }

  return { roads, network, bridges, village, houses, fields, hedges, woodland };
}

/**
 * True if a tree may grow at `p` as far as the countryside is concerned:
 * not in a crop field, on a road or bridge, or in someone's house.
 */
export function countrysideClear(p: Vec2, land: Countryside): boolean {
  if (land.fields.some((f) => pointInPolygon(p, f.corners))) return false;
  if (land.roads.some((r) => distanceToPolylineCheap(p, r.points) < ROAD_WIDTH / 2 + 1.2)) {
    return false;
  }
  return land.houses.every((h) => Math.hypot(h.pos.x - p.x, h.pos.y - p.y) >= 3);
}

// ---------------------------------------------------------------------------
// Area & village
// ---------------------------------------------------------------------------

/** The part of the map with countryside: the rest fades into the horizon. */
function countrysideArea(map: Bounds): Bounds {
  const cx = (map.minX + map.maxX) / 2;
  const cy = (map.minY + map.maxY) / 2;
  const half = ((map.maxX - map.minX) / 2) * COUNTRYSIDE_REACH;
  return { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half };
}

/**
 * Village centre: nearest spot to the south-middle of the field that has
 * `VILLAGE_RADIUS` of open land round it (no airport, no river).
 */
function pickVillage(
  world: WorldSize,
  clearOf: (p: Vec2, gap: number) => boolean,
  onWater: (p: Vec2) => boolean,
): Vec2 | null {
  const target = { x: world.width * 0.5, y: world.height * 0.92 };
  let best: Vec2 | null = null;
  let bestD = Infinity;
  for (let y = world.height * 0.7; y <= world.height * 1.15; y += 2) {
    for (let x = world.width * 0.2; x <= world.width * 0.8; x += 2) {
      const p = { x, y };
      const d = Math.hypot(x - target.x, (y - target.y) * 1.5);
      if (d >= bestD) continue;
      if (!clearOf(p, VILLAGE_RADIUS)) continue;
      let wet = false;
      for (let a = 0; a < 8 && !wet; a++) {
        const q = {
          x: x + Math.cos((a / 8) * Math.PI * 2) * VILLAGE_RADIUS,
          y: y + Math.sin((a / 8) * Math.PI * 2) * VILLAGE_RADIUS,
        };
        wet = onWater(q) || onWater(p);
      }
      if (wet) continue;
      best = p;
      bestD = d;
    }
  }
  return best;
}

/** Houses both sides of every road near the village centre, and a church. */
function placeHouses(
  village: Vec2,
  roads: readonly Road[],
  rng: Rng,
  clearOf: (p: Vec2, gap: number) => boolean,
  onWater: (p: Vec2) => boolean,
  stream: readonly StreamPoint[],
): House[] {
  const houses: House[] = [];
  const free = (p: Vec2, gap: number) =>
    clearOf(p, 3) &&
    !onWater(p) &&
    distanceToBank(p, stream) > 3 &&
    houses.every((h) => Math.hypot(h.pos.x - p.x, h.pos.y - p.y) >= gap) &&
    roads.every((r) => distanceToPolylineCheap(p, r.points) >= ROAD_WIDTH / 2 + 1.4);

  for (const road of roads) {
    const pts = road.points;
    let since = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      since += Math.hypot(b.x - a.x, b.y - a.y);
      if (since < 2.6) continue;
      since = 0;
      const heading = Math.atan2(b.y - a.y, b.x - a.x);
      const n = { x: -Math.sin(heading), y: Math.cos(heading) };
      for (const side of [1, -1]) {
        const off = 3.1 + rng() * 1.2;
        const p = { x: b.x + n.x * off * side, y: b.y + n.y * off * side };
        const r = Math.hypot(p.x - village.x, p.y - village.y);
        // Denser in the middle, thinning out towards the edge of the village.
        if (r > VILLAGE_RADIUS || rng() > 1 - (r / VILLAGE_RADIUS) * 0.45) continue;
        if (!free(p, 2.6)) continue;
        houses.push({
          kind: rng() < 0.3 ? "cottage" : "house",
          pos: p,
          heading: heading + (rng() - 0.5) * 0.12,
          tint: rng(),
        });
      }
    }
  }

  // A second row behind the street houses in the middle of the village,
  // so it reads as a place rather than a ribbon along the road.
  for (const front of [...houses]) {
    const r = Math.hypot(front.pos.x - village.x, front.pos.y - village.y);
    if (r > VILLAGE_RADIUS * 0.7 || rng() > 0.7) continue;
    const toRoad = { x: -Math.sin(front.heading), y: Math.cos(front.heading) };
    // Step further from the nearest road along the house's normal.
    const road = roads.reduce((best, rd) =>
      distanceToPolylineCheap(front.pos, rd.points) <
      distanceToPolylineCheap(front.pos, best.points)
        ? rd
        : best,
    );
    const away =
      distanceToPolylineCheap(
        { x: front.pos.x + toRoad.x, y: front.pos.y + toRoad.y },
        road.points,
      ) > distanceToPolylineCheap(front.pos, road.points)
        ? 1
        : -1;
    const p = {
      x: front.pos.x + toRoad.x * away * (3 + rng()),
      y: front.pos.y + toRoad.y * away * (3 + rng()),
    };
    if (!free(p, 2.6)) continue;
    houses.push({
      kind: rng() < 0.5 ? "cottage" : "house",
      pos: p,
      heading: front.heading + (rng() - 0.5) * 0.3,
      tint: rng(),
    });
  }

  // The church: a little way off the main street, on open ground, as near
  // the middle as it will fit.
  church: for (const dist of [6, 8, 10, 12, 14]) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const p = { x: village.x + Math.cos(a) * dist, y: village.y + Math.sin(a) * dist };
      if (free(p, 4.5)) {
        houses.push({ kind: "church", pos: p, heading: 0, tint: 0.5 });
        break church;
      }
    }
  }

  // A farm or two on the way out of the village: farmhouse plus big barn.
  for (const road of roads) {
    const pts = road.points;
    for (let i = 8; i < pts.length; i += 14) {
      const p0 = pts[i]!;
      const r = Math.hypot(p0.x - village.x, p0.y - village.y);
      if (r < VILLAGE_RADIUS * 1.6 || r > VILLAGE_RADIUS * 4 || rng() > 0.35) continue;
      const b = pts[Math.min(pts.length - 1, i + 1)]!;
      const heading = Math.atan2(b.y - p0.y, b.x - p0.x);
      const n = { x: -Math.sin(heading), y: Math.cos(heading) };
      const side = rng() < 0.5 ? 1 : -1;
      const farm = { x: p0.x + n.x * 4 * side, y: p0.y + n.y * 4 * side };
      const barn = { x: farm.x + n.x * 4.5 * side, y: farm.y + n.y * 4.5 * side };
      if (!free(farm, 3) || !free(barn, 4)) continue;
      houses.push({ kind: "house", pos: farm, heading, tint: rng() });
      houses.push({ kind: "barn", pos: barn, heading: heading + Math.PI / 2, tint: rng() });
    }
  }
  return houses;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/**
 * Land use for a patchwork cell at `c`: big soft patches (noise) so woods
 * and meadows come in clumps, with `roll` breaking up the edges.
 */
function landUse(c: Vec2, roll: number): "woods" | "meadow" | "crop" {
  const n = valueNoise(c.x / 70, c.y / 70, LAND_USE_SEED) * 0.75 + roll * 0.25;
  if (n < WOODS_SHARE) return "woods";
  if (n < WOODS_SHARE + MEADOW_SHARE) return "meadow";
  return "crop";
}

/**
 * Cells of a patchwork grid over `area`, rotated by `FIELD_ANGLE` about its
 * centre, with columns and rows of random widths.
 */
function patchwork(area: Bounds, rng: Rng): Vec2[][] {
  const cx = (area.minX + area.maxX) / 2;
  const cy = (area.minY + area.maxY) / 2;
  // Cover the rotated square generously.
  const half = ((area.maxX - area.minX) / 2) * 1.2;
  const cuts = (): number[] => {
    const out = [-half];
    while (out[out.length - 1]! < half)
      out.push(out[out.length - 1]! + lerp(FIELD_SIZE_MIN, FIELD_SIZE_MAX, rng()));
    return out;
  };
  const us = cuts();
  const vs = cuts().map((v) => v * 0.75); // rows a bit shorter than columns
  const c = Math.cos(FIELD_ANGLE);
  const s = Math.sin(FIELD_ANGLE);
  const at = (u: number, v: number): Vec2 => ({ x: cx + u * c - v * s, y: cy + u * s + v * c });
  const cells: Vec2[][] = [];
  for (let i = 1; i < us.length; i++) {
    for (let j = 1; j < vs.length; j++) {
      const quad = [
        at(us[i - 1]!, vs[j - 1]!),
        at(us[i]!, vs[j - 1]!),
        at(us[i]!, vs[j]!),
        at(us[i - 1]!, vs[j]!),
      ];
      const m = centroid(quad);
      if (m.x < area.minX || m.x > area.maxX || m.y < area.minY || m.y > area.maxY) continue;
      cells.push(quad);
    }
  }
  return cells;
}

/** Shrink a convex quad towards its centre by `d` on every side. */
function insetQuad(quad: readonly Vec2[], d: number): Vec2[] {
  let poly = [...quad];
  const c = centroid(quad);
  for (let i = 0; i < quad.length; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % quad.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    // Point the normal inwards.
    if ((c.x - a.x) * n.x + (c.y - a.y) * n.y < 0) n = { x: -n.x, y: -n.y };
    poly = clipHalfPlane(poly, n, a.x * n.x + a.y * n.y + d);
  }
  return poly;
}

/** Edge `a`–`b` of a polygon centred on `c`, pushed `d` outwards. */
function offsetEdge(a: Vec2, b: Vec2, c: Vec2, d: number): Hedge {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
  if ((a.x - c.x) * n.x + (a.y - c.y) * n.y < 0) n = { x: -n.x, y: -n.y };
  return {
    a: { x: a.x + n.x * d, y: a.y + n.y * d },
    b: { x: b.x + n.x * d, y: b.y + n.y * d },
  };
}

/** Jittered grid of points inside a convex polygon. */
function scatterIn(poly: readonly Vec2[], spacing: number, rng: Rng): Vec2[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const out: Vec2[] = [];
  for (let y = minY; y < maxY; y += spacing) {
    for (let x = minX; x < maxX; x += spacing) {
      const p = { x: x + (rng() - 0.5) * spacing * 0.8, y: y + (rng() - 0.5) * spacing * 0.8 };
      if (pointInPolygon(p, poly)) out.push(p);
    }
  }
  return out;
}

function centroid(poly: readonly Vec2[]): Vec2 {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  return { x: x / poly.length, y: y / poly.length };
}

// ---------------------------------------------------------------------------
// Roads
// ---------------------------------------------------------------------------

/** Coarse grid the road planner searches (cells are indices into it). */
class RoadGrid {
  readonly cols: number;
  readonly rows: number;
  private readonly blocked: Uint8Array;
  private readonly water: Uint8Array;
  private readonly paved: Uint8Array;

  constructor(
    private readonly area: Bounds,
    isBlocked: (p: Vec2) => boolean,
    isWater: (p: Vec2) => boolean,
  ) {
    this.cols = Math.ceil((area.maxX - area.minX) / CELL);
    this.rows = Math.ceil((area.maxY - area.minY) / CELL);
    const n = this.cols * this.rows;
    this.blocked = new Uint8Array(n);
    this.water = new Uint8Array(n);
    this.paved = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const p = this.center(i);
      this.blocked[i] = isBlocked(p) ? 1 : 0;
      this.water[i] = isWater(p) ? 1 : 0;
    }
  }

  center(i: number): Vec2 {
    const c = i % this.cols;
    const r = Math.floor(i / this.cols);
    return { x: this.area.minX + (c + 0.5) * CELL, y: this.area.minY + (r + 0.5) * CELL };
  }

  cellOf(p: Vec2): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor((p.x - this.area.minX) / CELL)));
    const r = Math.min(this.rows - 1, Math.max(0, Math.floor((p.y - this.area.minY) / CELL)));
    return r * this.cols + c;
  }

  pave(cells: readonly number[]): void {
    for (const c of cells) this.paved[c] = 1;
  }

  /**
   * Maximal runs of `cells` that aren't paved yet, each reaching one cell
   * into the network where it branches off or joins back (`joinStart` /
   * `joinEnd`: that end meets an existing road).
   */
  newRuns(cells: readonly number[]): { cells: number[]; joinStart: boolean; joinEnd: boolean }[] {
    const runs: { cells: number[]; joinStart: boolean; joinEnd: boolean }[] = [];
    let run: number[] = [];
    let joinStart = false;
    cells.forEach((c, i) => {
      if (!this.paved[c]) {
        if (run.length === 0) {
          joinStart = i > 0;
          if (joinStart) run.push(cells[i - 1]!); // branch off the network
        }
        run.push(c);
      } else if (run.length > 0) {
        run.push(c); // join back onto the network
        runs.push({ cells: run, joinStart, joinEnd: true });
        run = [];
      }
    });
    if (run.length > 0) runs.push({ cells: run, joinStart, joinEnd: false });
    return runs;
  }

  /** Cheapest 8-connected path of cells from `a` to `b` (A*), or null. */
  route(a: Vec2, b: Vec2): number[] | null {
    const start = this.cellOf(a);
    const goal = this.cellOf(b);
    const n = this.cols * this.rows;
    const g = new Float64Array(n).fill(Infinity);
    const from = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const gp = this.center(goal);
    const h = (i: number) => {
      const p = this.center(i);
      return Math.hypot(p.x - gp.x, p.y - gp.y) * REUSE_COST;
    };
    g[start] = 0;
    heap.push(start, h(start));
    while (heap.size > 0) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cc = cur % this.cols;
      const cr = Math.floor(cur / this.cols);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nc = cc + dc;
          const nr = cr + dr;
          if (nc < 0 || nr < 0 || nc >= this.cols || nr >= this.rows) continue;
          const next = nr * this.cols + nc;
          // Start and goal may sit just inside an airport's margin.
          if (this.blocked[next] && next !== goal) continue;
          let step = (dr !== 0 && dc !== 0 ? Math.SQRT2 : 1) * CELL;
          if (this.water[next]) step *= WATER_COST;
          else if (this.paved[next]) step *= REUSE_COST;
          const cost = g[cur]! + step;
          if (cost < g[next]!) {
            g[next] = cost;
            from[next] = cur;
            heap.push(next, cost + h(next));
          }
        }
      }
    }
    if (from[goal] === -1 && goal !== start) return null;
    const path: number[] = [];
    for (let c = goal; c !== -1; c = from[c]!) path.push(c);
    return path.reverse();
  }
}

/** Binary min-heap of (item, priority). */
class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: number, p: number): void {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent]! <= this.prio[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0]!;
    const lastItem = this.items.pop()!;
    const lastPrio = this.prio.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.items.length && this.prio[l]! < this.prio[m]!) m = l;
        if (r < this.items.length && this.prio[r]! < this.prio[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number): void {
    [this.items[a], this.items[b]] = [this.items[b]!, this.items[a]!];
    [this.prio[a], this.prio[b]] = [this.prio[b]!, this.prio[a]!];
  }
}

/**
 * Grid staircase → road: drop points that don't change direction much
 * (Douglas–Peucker), then round the corners (Chaikin, three times), then
 * resample evenly so houses, dashes and cars can step along it.
 */
function smooth(points: readonly Vec2[]): Vec2[] {
  if (points.length < 3) return resamplePolyline(points, 1);
  return resamplePolyline(roundCorners(simplify(points, 1.8), 3), 1);
}

function simplify(points: readonly Vec2[], tol: number): Vec2[] {
  if (points.length < 3) return [...points];
  let worst = 0;
  let index = 0;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i]!, a, b);
    if (d > worst) {
      worst = d;
      index = i;
    }
  }
  if (worst <= tol) return [a, b];
  const left = simplify(points.slice(0, index + 1), tol);
  const right = simplify(points.slice(index), tol);
  return [...left.slice(0, -1), ...right];
}

/** Points of road either side of the water that the bridge's ramps take up. */
const BRIDGE_RAMP_POINTS = 5;

/**
 * The bridges on `road`: each stretch over the river, plus
 * `BRIDGE_RAMP_POINTS` of road either side for the ramps up to the deck
 * (fewer if the road ends or meets a junction sooner).
 */
function findBridges(
  road: readonly Vec2[],
  index: number,
  stream: readonly StreamPoint[],
): Bridge[] {
  const bridges: Bridge[] = [];
  let first = -1;
  for (let i = 0; i <= road.length; i++) {
    const wet = i < road.length && distanceToBank(road[i]!, stream) < 0.4;
    if (wet && first === -1) first = i;
    if (!wet && first !== -1) {
      const from = Math.max(0, first - BRIDGE_RAMP_POINTS);
      const to = Math.min(road.length - 1, i - 1 + BRIDGE_RAMP_POINTS);
      const points = road.slice(from, to + 1).map((p) => ({ ...p }));
      const along = arcLengths(points);
      // The leaves pivot half a point outside the last dry point each side.
      const wetFrom = Math.max(0, along[first - from]! - 0.5);
      const wetTo = Math.min(along[along.length - 1]!, along[i - 1 - from]! + 0.5);
      bridges.push({ road: index, from, to, points, wetFrom, wetTo });
      first = -1;
    }
  }
  return bridges;
}

// ---------------------------------------------------------------------------
// Road network
// ---------------------------------------------------------------------------

/** One road's end snapped onto another road. */
interface Join {
  road: number;
  end: "start" | "end";
  onto: number;
  /** Distance along road `onto` of the snapped point. */
  along: number;
  point: Vec2;
}

/** Nearest point on any of `roads` to `p`. */
function snapToRoads(
  p: Vec2,
  roads: readonly Road[],
): { road: number; point: Vec2; along: number } {
  let best = { road: 0, point: p, along: 0, distance: Infinity };
  roads.forEach((r, i) => {
    const n = nearestOnPolyline(p, r.points);
    if (n.distance < best.distance)
      best = { road: i, point: n.point, along: n.along, distance: n.distance };
  });
  return best;
}

/**
 * Turn the drawn roads into a graph. Nodes: every road end (a junction if
 * it was snapped onto another road, an entrance at a car park gate, an edge
 * where it runs off the map) and every point where another road joins it.
 * Edges: the stretches of each road between consecutive nodes.
 */
function buildNetwork(
  roads: readonly Road[],
  joins: readonly Join[],
  entrances: readonly { road: number; airport: number }[],
  map: Bounds,
): RoadNetwork {
  const nodes: RoadNode[] = [];
  const addNode = (pos: Vec2, kind: RoadNode["kind"], airport?: number): number => {
    // The same place reached from two roads is one node.
    const near = nodes.findIndex((n) => Math.hypot(n.pos.x - pos.x, n.pos.y - pos.y) < 0.6);
    if (near >= 0) {
      if (kind !== "edge" && nodes[near]!.kind === "edge") nodes[near]!.kind = kind;
      return near;
    }
    nodes.push(
      airport === undefined ? { pos: { ...pos }, kind } : { pos: { ...pos }, kind, airport },
    );
    return nodes.length - 1;
  };

  // Where along each road the nodes fall.
  const cuts: { along: number; node: number }[][] = roads.map(() => []);
  for (const j of joins) {
    const node = addNode(j.point, "junction");
    cuts[j.onto]!.push({ along: j.along, node });
    const road = roads[j.road]!;
    cuts[j.road]!.push({ along: j.end === "start" ? 0 : arcLengths(road.points).at(-1)!, node });
  }
  roads.forEach((road, i) => {
    const length = arcLengths(road.points).at(-1)!;
    for (const [end, along] of [
      ["start", 0],
      ["end", length],
    ] as const) {
      if (cuts[i]!.some((c) => Math.abs(c.along - along) < 1e-6)) continue;
      const p = end === "start" ? road.points[0]! : road.points.at(-1)!;
      const entrance = end === "start" ? entrances.find((e) => e.road === i) : undefined;
      const atEdge =
        p.x < map.minX + 3 || p.x > map.maxX - 3 || p.y < map.minY + 3 || p.y > map.maxY - 3;
      const kind = entrance ? "entrance" : atEdge ? "edge" : "junction";
      cuts[i]!.push({ along, node: addNode(p, kind, entrance?.airport) });
    }
  });

  // Edges: split each road at its cuts.
  const edges: RoadEdge[] = [];
  roads.forEach((road, i) => {
    const along = arcLengths(road.points);
    const sorted = [...cuts[i]!].sort((a, b) => a.along - b.along);
    for (let k = 1; k < sorted.length; k++) {
      const from = sorted[k - 1]!;
      const to = sorted[k]!;
      if (from.node === to.node || to.along - from.along < 0.2) continue;
      const pts: Vec2[] = [pointAt(road.points, along, from.along)];
      for (let n = 0; n < road.points.length; n++) {
        if (along[n]! > from.along + 1e-6 && along[n]! < to.along - 1e-6)
          pts.push({ ...road.points[n]! });
      }
      pts.push(pointAt(road.points, along, to.along));
      edges.push({ a: from.node, b: to.node, points: pts, length: to.along - from.along });
    }
  });
  return { nodes, edges };
}

/** Point at distance `s` along a polyline with arc lengths `along`. */
function pointAt(line: readonly Vec2[], along: readonly number[], s: number): Vec2 {
  for (let i = 1; i < line.length; i++) {
    if (along[i]! >= s) {
      const t = (s - along[i - 1]!) / (along[i]! - along[i - 1]! || 1);
      const a = line[i - 1]!;
      const b = line[i]!;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  return { ...line[line.length - 1]! };
}

/**
 * Cheapest route through the network from node `from` to node `to`
 * (Dijkstra; the graph has a dozen nodes), as one centreline, or null.
 */
export function routeBetween(net: RoadNetwork, from: number, to: number): Vec2[] | null {
  const dist = net.nodes.map(() => Infinity);
  const via: { edge: number; forward: boolean }[] = net.nodes.map(() => ({
    edge: -1,
    forward: true,
  }));
  const done = net.nodes.map(() => false);
  dist[from] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < dist.length; i++)
      if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || u === to) break;
    done[u] = true;
    net.edges.forEach((e, k) => {
      const v = e.a === u ? e.b : e.b === u ? e.a : -1;
      if (v < 0 || done[v]) return;
      if (dist[u]! + e.length < dist[v]!) {
        dist[v] = dist[u]! + e.length;
        via[v] = { edge: k, forward: e.a === u };
      }
    });
  }
  if (dist[to] === Infinity) return null;
  const pieces: Vec2[][] = [];
  for (let n = to; n !== from;) {
    const { edge, forward } = via[n]!;
    const e = net.edges[edge]!;
    pieces.push(forward ? e.points : [...e.points].reverse());
    n = forward ? e.a : e.b;
  }
  const out: Vec2[] = [];
  for (const piece of pieces.reverse()) out.push(...(out.length ? piece.slice(1) : piece));
  return out;
}

// ---------------------------------------------------------------------------
// Distances
// ---------------------------------------------------------------------------

/**
 * True if `p` is within `limit` of the stream's outer bank (or on it). Much
 * cheaper than `distanceToBank` where it matters, over the road grid's
 * tens of thousands of cells: segments whose box is out of reach are skipped.
 */
function nearBank(p: Vec2, stream: readonly StreamPoint[], limit: number): boolean {
  for (let i = 1; i < stream.length; i++) {
    const a = stream[i - 1]!;
    const b = stream[i]!;
    const reach = Math.max(streamOuterHalfWidth(a), streamOuterHalfWidth(b)) + limit;
    if (p.x < Math.min(a.x, b.x) - reach || p.x > Math.max(a.x, b.x) + reach) continue;
    if (p.y < Math.min(a.y, b.y) - reach || p.y > Math.max(a.y, b.y) + reach) continue;
    if (distanceToSegment(p, a, b) < reach) return true;
  }
  return false;
}

/** Distance from `p` to the stream's outer bank (negative on the bank/water). */
function distanceToBank(p: Vec2, stream: readonly StreamPoint[]): number {
  let best = Infinity;
  for (let i = 1; i < stream.length; i++) {
    const a = stream[i - 1]!;
    const b = stream[i]!;
    const reach = Math.max(streamOuterHalfWidth(a), streamOuterHalfWidth(b));
    // Skip segments whose bounding box is already farther than the best.
    const bx = Math.max(0, Math.min(a.x, b.x) - p.x, p.x - Math.max(a.x, b.x));
    const by = Math.max(0, Math.min(a.y, b.y) - p.y, p.y - Math.max(a.y, b.y));
    if (Math.max(bx, by) - reach >= best) continue;
    best = Math.min(best, distanceToSegment(p, a, b) - reach);
  }
  return best;
}

/** Distance to a densely sampled polyline, checking points only (fast enough, ~1 unit apart). */
function distanceToPolylineCheap(p: Vec2, line: readonly Vec2[]): number {
  let best = Infinity;
  for (const q of line) {
    const d = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y);
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}
