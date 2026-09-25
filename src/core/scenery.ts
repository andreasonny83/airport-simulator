/**
 * Procedural scenery layout: map bounds, airport grounds (see
 * core/airports.ts), a meandering river and scattered trees.
 *
 * This is pure data (no Babylon) so it can be unit-tested like the rest of
 * core. It is decoration only: the simulation never reads it, so nothing
 * here can affect spawning, collisions or landing.
 *
 * Everything is in sim coordinates (origin at the playfield's top-left,
 * +y towards the player). The map extends just far enough past the
 * playfield that the camera can zoom out / rotate without showing the void.
 */
import {
  MAP_MARGIN,
  SCENERY_SEED,
  STREAM_AIRFIELD_CLEARANCE,
  STREAM_BANK_WIDTH,
  STREAM_BASE_FY,
  STREAM_MEANDER_ANGLE,
  STREAM_WAVELENGTH,
  STREAM_WIDTH,
  STREAM_WIDTH_VARIATION,
  TREE_CONIFER_SHARE,
  TREE_DENSITY,
  TREE_RUNWAY_CLEARANCE,
  TREE_SCALE_MAX,
  TREE_SCALE_MIN,
  TREE_STREAM_CLEARANCE,
  ZOOM_MIN,
} from "../config";
import { layoutAirports, type Airport } from "./airports";
import { buildCountryside, countrysideClear, type Countryside } from "./countryside";
import { distanceToPolygon, rectCorners } from "./geometry";
import { maxViewRadius } from "./layout";
import { headingVector, lerp, mulberry32 } from "./math";
import type { OrientedRect, Rng, Runway, Vec2, WorldSize } from "./types";

/** Axis-aligned rectangle in sim coordinates. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Tree species; each renders with its own low-poly model. */
export type TreeKind = "conifer" | "broadleaf";

export interface Tree {
  kind: TreeKind;
  pos: Vec2;
  /** Uniform size multiplier (see `TREE_SCALE_MIN/MAX`). */
  scale: number;
  /** Spin around the vertical axis (radians) so trees don't look stamped. */
  rotation: number;
  /** 0..1, picks a shade of green for the canopy. */
  tint: number;
}

/** One sample of the stream centreline. */
export interface StreamPoint extends Vec2 {
  /** Water width here (world units). */
  width: number;
}

export interface Scenery {
  bounds: Bounds;
  /** Airport grounds: fences, towers, terminals (built before everything else avoids them). */
  airports: Airport[];
  /** Roads, village, fields and woods. */
  countryside: Countryside;
  /** Stream centreline, sampled left → right across the whole map. */
  stream: StreamPoint[];
  trees: Tree[];
}

/** Spacing between stream centreline samples, measured along the river. */
const STREAM_SAMPLE_STEP = 2.5;

/**
 * Steering that pulls the river back towards its base line, so random bends
 * can't make it wander off across the map. Full strength (`STREAM_PULL`
 * radians) once it strays `STREAM_PULL_RANGE` units away.
 */
const STREAM_PULL = 0.5;
const STREAM_PULL_RANGE = 10;

/** Hard cap on the flow angle: past 90° the river would flow backwards. */
const STREAM_MAX_ANGLE = 1.4;

/** Farthest the placement search moves the river off its preferred line. */
const STREAM_MAX_SHIFT = 150;

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

/**
 * Scenery map bounds: the smallest square, centred on the playfield, that
 * the camera can never see past.
 *
 * At zoom `z` the view shows the ground within `R / z` of its centre at any
 * heading, where `R` is the default view's half-diagonal on the ground in
 * the widest or tallest supported window (see `maxViewRadius`). It depends
 * on the fixed world only, so the map never changes on a resize.
 * That centre can be panned up to `panFraction(z)` of the field's
 * half-diagonal `D` off the middle (see render/camera.ts). The sum is
 * largest at one of the two ends of the range where panning scales:
 * - zoom 1:          D + R (full pan, default view);
 * - zoom `ZOOM_MIN`: R / ZOOM_MIN (no pan, widest view).
 * Past zoom 1 the view only shrinks, and in between both terms are
 * smaller than at one of the ends. `MAP_MARGIN` is added on top.
 */
export function mapBounds(world: WorldSize): Bounds {
  const r = maxViewRadius(world);
  const d = Math.hypot(world.width, world.height) / 2;
  const half = Math.max(d + r, r / ZOOM_MIN) + MAP_MARGIN;
  const cx = world.width / 2;
  const cy = world.height / 2;
  return { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half };
}

/**
 * How much of the way `p` has faded into the horizon, 0..1: nothing inside
 * the inner 65% of the map, then easing to fully faded at its edge (by
 * Chebyshev distance, so the map's square edge disappears evenly). The grass,
 * roads and cars all fade by this, so they melt away together.
 */
export function horizonFade(p: Vec2, bounds: Bounds): number {
  const half = (bounds.maxX - bounds.minX) / 2;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const edge = Math.max(Math.abs(p.x - cx), Math.abs(p.y - cy)) / half;
  const f = Math.min(1, Math.max(0, (edge - 0.65) / 0.35));
  return f * f * (3 - 2 * f);
}

/**
 * How far `p` lies outside the playfield rectangle (0 when inside). Handy
 * for making scenery denser away from where the player draws paths.
 */
export function distanceOutsidePlayfield(p: Vec2, world: WorldSize): number {
  const dx = Math.max(0 - p.x, 0, p.x - world.width);
  const dy = Math.max(0 - p.y, 0, p.y - world.height);
  return Math.hypot(dx, dy);
}

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

/** Deterministic hash of an integer lattice point to [0, 1). */
function hash2(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * 2D value noise in [0, 1): random values on an integer grid, smoothly
 * interpolated in between. Scale the inputs to set the feature size, e.g.
 * `valueNoise(x / 40, y / 40)` gives blobs roughly 40 units across.
 */
export function valueNoise(x: number, y: number, seed = SCENERY_SEED): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  // Smoothstep weights hide the grid's straight edges.
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = lerp(hash2(ix, iy, seed), hash2(ix + 1, iy, seed), sx);
  const bottom = lerp(hash2(ix, iy + 1, seed), hash2(ix + 1, iy + 1, seed), sx);
  return lerp(top, bottom, sy);
}

// ---------------------------------------------------------------------------
// Stream
// ---------------------------------------------------------------------------

/** Half-width of the stream at `p` out to the edge of its bank. */
export function streamOuterHalfWidth(p: StreamPoint): number {
  return p.width / 2 + STREAM_BANK_WIDTH;
}

/**
 * Stream centreline across the full map width. We walk along the river and
 * steer its *direction* with smooth 1D noise (two octaves: long sweeping
 * bends plus smaller wiggles), gently pulled back towards the base line so
 * it can't wander off. Unlike a sine, the bends come out uneven — long
 * straight-ish reaches, lazy curves and the odd tight loop — like a real
 * river seen from the air.
 *
 * The line comes back centred on y = 0; `placeStream` moves it into
 * position. Seeds come from `rng`, so a seeded rng gives the same river.
 */
export function streamCenterline(world: WorldSize, rng: Rng): StreamPoint[] {
  const bounds = mapBounds(world);
  const bendSeed = Math.floor(rng() * 2 ** 31);
  const wiggleSeed = Math.floor(rng() * 2 ** 31);
  const widthSeed = Math.floor(rng() * 2 ** 31);

  const step = STREAM_SAMPLE_STEP;
  // Signed noise in roughly [-1, 1]. Value noise bunches around its middle,
  // so it's stretched ×1.8 and clamped to reach full-strength bends.
  const signed = (v: number) => Math.max(-1, Math.min(1, (v * 2 - 1) * 1.8));

  const points: StreamPoint[] = [];
  let x = bounds.minX - step;
  let y = 0;
  // Iteration cap is just a safety net; x always advances (|angle| < 90°).
  for (let s = 0; x <= bounds.maxX + step && points.length < 100_000; s += step) {
    const sweep = signed(valueNoise(s / (STREAM_WAVELENGTH / 2), 0.5, bendSeed));
    const wiggle = signed(valueNoise(s / (STREAM_WAVELENGTH / 7), 0.5, wiggleSeed));
    const pull = STREAM_PULL * Math.max(-1, Math.min(1, -y / STREAM_PULL_RANGE));
    const angle = Math.max(
      -STREAM_MAX_ANGLE,
      Math.min(STREAM_MAX_ANGLE, STREAM_MEANDER_ANGLE * (0.8 * sweep + 0.2 * wiggle) + pull),
    );

    const widthNoise = valueNoise(s / 40, 0.5, widthSeed) * 2 - 1;
    points.push({ x, y, width: STREAM_WIDTH * (1 + STREAM_WIDTH_VARIATION * widthNoise) });

    x += Math.cos(angle) * step;
    y += Math.sin(angle) * step;
  }

  return points;
}

/**
 * Everything built on the ground at the airports, as polygons: each fenced
 * airside, terminal and car park. Trees and the river keep clear of these.
 */
export function airportObstacles(airports: readonly Airport[]): Vec2[][] {
  return airports.flatMap((a) => [
    a.perimeter,
    ...(a.landside ? [rectCorners(a.landside.terminal), rectCorners(a.landside.carPark)] : []),
  ]);
}

/**
 * Move a centred stream (see `streamCenterline`) to its base line, shifted
 * up or down by the smallest amount that keeps every bank at least
 * `STREAM_AIRFIELD_CLEARANCE` from every airport (see `airportObstacles`).
 */
export function placeStream(
  line: readonly StreamPoint[],
  world: WorldSize,
  obstacles: readonly (readonly Vec2[])[],
): StreamPoint[] {
  const baseY = world.height * STREAM_BASE_FY;
  const clearAt = (y0: number) =>
    line.every((p) => {
      const q = { x: p.x, y: p.y + y0 };
      const reach = streamOuterHalfWidth(p) + STREAM_AIRFIELD_CLEARANCE;
      return obstacles.every((o) => distanceToPolygon(q, o) >= reach);
    });

  // Try 0, -1, +1, -2, +2, … so the river ends up as near its line as allowed.
  let offset = baseY;
  for (let d = 0; d <= STREAM_MAX_SHIFT; d++) {
    const candidate = clearAt(baseY - d) ? baseY - d : clearAt(baseY + d) ? baseY + d : null;
    if (candidate !== null) {
      offset = candidate;
      break;
    }
  }
  return line.map((p) => ({ ...p, y: p.y + offset }));
}

/**
 * Distance from `p` to the stream's outer bank (negative when on the bank or
 * in the water). Conservative: uses the wider bank of each segment.
 */
export function distanceToStreamBank(p: Vec2, stream: readonly StreamPoint[]): number {
  let best = Infinity;
  for (let i = 1; i < stream.length; i++) {
    const a = stream[i - 1]!;
    const b = stream[i]!;
    const reach = Math.max(streamOuterHalfWidth(a), streamOuterHalfWidth(b));
    best = Math.min(best, distanceToSegment(p, a, b) - reach);
  }
  return best;
}

// ---------------------------------------------------------------------------
// Distances
// ---------------------------------------------------------------------------

/** Distance from `p` to the segment `a`–`b`. */
function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  // Project p onto the segment, clamped to its ends.
  const t =
    lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** Shortest distance from `p` to a polyline. */
export function distanceToPolyline(p: Vec2, line: readonly Vec2[]): number {
  if (line.length === 1) return Math.hypot(p.x - line[0]!.x, p.y - line[0]!.y);
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    best = Math.min(best, distanceToSegment(p, line[i - 1]!, line[i]!));
  }
  return best;
}

/**
 * Distance from `p` to a runway's rectangle, or any other `OrientedRect`
 * (0 when inside). Works in the rectangle's local frame: `u` along the
 * heading, `v` across it.
 */
export function distanceToRunway(p: Vec2, runway: OrientedRect): number {
  const dir = headingVector(runway.heading);
  const dx = p.x - runway.center.x;
  const dy = p.y - runway.center.y;
  const u = dx * dir.x + dy * dir.y;
  const v = -dx * dir.y + dy * dir.x;
  const outU = Math.max(Math.abs(u) - runway.length / 2, 0);
  const outV = Math.max(Math.abs(v) - runway.width / 2, 0);
  return Math.hypot(outU, outV);
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

/**
 * Probability (0..1) that a tree candidate at `p` is kept, after the hard
 * runway/stream clearances have already been applied.
 *
 * This is the main art-direction knob for the landscape:
 * - Trees inside the playfield sit under drawn paths and planes, which adds
 *   visual clutter exactly where the player needs to read the board.
 * - A completely bare playfield, on the other hand, looks like a golf course.
 *
 * Useful helpers: `distanceOutsidePlayfield(p, world)` (0 inside the field,
 * grows outward) and `valueNoise(x / size, y / size)` for clumps/clearings.
 *
 * TODO(user): replace the placeholder with your own density rule.
 */
export function treeDensity(p: Vec2, world: WorldSize): number {
  void p;
  void world;
  return 1;
}

/**
 * Scatter trees over the map by rejection sampling: draw uniform candidates,
 * throw away any too close to a runway or the stream, then keep the rest
 * with probability `treeDensity(p)`.
 */
export function scatterTrees(
  world: WorldSize,
  obstacles: readonly (readonly Vec2[])[],
  stream: readonly StreamPoint[],
  rng: Rng,
  land: Countryside | null = null,
): Tree[] {
  const b = mapBounds(world);
  const area = (b.maxX - b.minX) * (b.maxY - b.minY);
  const candidates = Math.round((area / 1000) * TREE_DENSITY);
  // The band of y the river and its banks can touch, for a cheap pre-test.
  let bandMin = Infinity;
  let bandMax = -Infinity;
  for (const p of stream) {
    const reach = streamOuterHalfWidth(p) + TREE_STREAM_CLEARANCE;
    bandMin = Math.min(bandMin, p.y - reach);
    bandMax = Math.max(bandMax, p.y + reach);
  }

  const trees: Tree[] = [];
  for (let i = 0; i < candidates; i++) {
    // Draw every random number up front so each candidate consumes the same
    // amount of the sequence whether or not it's rejected. Keeps the layout
    // stable when a clearance or density rule is tweaked.
    const pos = { x: lerp(b.minX, b.maxX, rng()), y: lerp(b.minY, b.maxY, rng()) };
    const scale = lerp(TREE_SCALE_MIN, TREE_SCALE_MAX, rng());
    const rotation = rng() * Math.PI * 2;
    const tint = rng();
    const kind: TreeKind = rng() < TREE_CONIFER_SHARE ? "conifer" : "broadleaf";
    const keepRoll = rng();

    // Keep the airports clear: runways, taxiways, hangars, fences, terminals.
    if (obstacles.some((o) => distanceToPolygon(pos, o) < TREE_RUNWAY_CLEARANCE)) continue;
    // Cheap band test first, so most points skip the full polyline check.
    if (
      pos.y > bandMin &&
      pos.y < bandMax &&
      distanceToStreamBank(pos, stream) < TREE_STREAM_CLEARANCE
    ) {
      continue;
    }
    if (keepRoll >= treeDensity(pos, world)) continue;
    // Not in the crops, on the roads or in the village.
    if (land && !countrysideClear(pos, land)) continue;

    trees.push({ kind, pos, scale, rotation, tint });
  }

  // Woods and hedgerow trees, planted where the countryside put them.
  for (const pos of land?.woodland ?? []) {
    const scale = lerp(TREE_SCALE_MIN, TREE_SCALE_MAX, rng());
    const rotation = rng() * Math.PI * 2;
    const tint = rng();
    const kind: TreeKind = rng() < TREE_CONIFER_SHARE ? "conifer" : "broadleaf";
    if (obstacles.some((o) => distanceToPolygon(pos, o) < TREE_RUNWAY_CLEARANCE)) continue;
    trees.push({ kind, pos, scale, rotation, tint });
  }
  return trees;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Full scenery layout for a world size and runway layout. Deterministic
 * (fixed seed); the runways only move the river and clear the trees.
 */
export function buildScenery(world: WorldSize, runways: readonly Runway[]): Scenery {
  const rng = mulberry32(SCENERY_SEED);
  const airports = layoutAirports(runways, world);
  const obstacles = airportObstacles(airports);
  const stream = placeStream(streamCenterline(world, rng), world, obstacles);
  const bounds = mapBounds(world);
  const countryside = buildCountryside(world, bounds, airports, obstacles, stream);
  const trees = scatterTrees(world, obstacles, stream, rng, countryside);
  return { bounds, airports, countryside, stream, trees };
}
