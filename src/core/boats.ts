/**
 * River boat traffic: small boats sailing the whole river, from one edge of
 * the map to the other.
 *
 * Nothing pops into view: boats set off from the river's ends, far out in
 * the horizon haze (they fade with the grass, see `horizonFade`), and the
 * river starts with a few already under way. Sailboats are too tall for the
 * drawbridges when they're down, so each one asks for the bridge to open
 * (`bridgeDemand`) and waits short of it until it's up; motorboats pass
 * under.
 *
 * Purely decorative, like the rest of the scenery: the simulation never
 * reads it, so boats can't affect planes, paths or scoring. Kept pure (no
 * Babylon) so the timing and movement are deterministic and testable;
 * render/boats.ts turns it into meshes.
 */
import {
  BOAT_FADE_DISTANCE,
  BOAT_MAX,
  BOAT_SPAWN_MAX,
  BOAT_SPAWN_MIN,
  BOAT_TYPES,
} from "../config";
import { lerp, mulberry32 } from "./math";
import { horizonFade, mapBounds, type Bounds, type StreamPoint } from "./scenery";
import type { Rng, Vec2, WorldSize } from "./types";

export type BoatKind = keyof typeof BOAT_TYPES;

export interface Boat {
  id: number;
  kind: BoatKind;
  /** Distance travelled along the river centreline (see `BoatRoute.along`). */
  s: number;
  /** +1 sails downstream (increasing `s`), -1 upstream. */
  dir: 1 | -1;
  /** Current speed: cruising, or stopped for a bridge or the boat ahead. */
  speed: number;
}

/** The river boats use, with arc lengths for sampling. */
export interface BoatRoute {
  line: readonly StreamPoint[];
  /** Cumulative distance along `line` at each point. */
  along: number[];
  /** Boats appear and disappear at these distances (the map's edges). */
  start: number;
  end: number;
  /** The scenery map, for fading boats into the horizon. */
  bounds: Bounds;
}

export interface BoatTraffic {
  route: BoatRoute;
  boats: Boat[];
  /** Distance along the river of each bridge (drawbridge) crossing it. */
  gates: number[];
  /** Seconds until the next boat tries to set off. */
  nextSpawnIn: number;
  nextId: number;
  rng: Rng;
}

/** Where a boat is right now, ready for rendering. */
export interface BoatPose {
  pos: Vec2;
  heading: number;
  /** 0..1: fades with the horizon haze and at the river's very ends. */
  opacity: number;
}

/** Seed for boat traffic, so every game shows the same rhythm of boats. */
const TRAFFIC_SEED = 0xb0a7;
/** Boats already under way when the world is built. */
const START_BOATS = 4;
/**
 * A sailboat asks for a bridge to open from this far away (along the
 * river): enough for the leaves' lift, not so much that cars wait long…
 */
const GATE_CALL = 16;
/** …and waits this far short of it until the leaves are up. */
const GATE_WAIT = 7;
/** Boats keep at least this far behind the boat ahead in their lane. */
const BOAT_GAP = 6;

/** The whole river within the scenery map, edge to edge. */
export function boatRoute(line: readonly StreamPoint[], world: WorldSize): BoatRoute {
  const along: number[] = [0];
  for (let i = 1; i < line.length; i++) {
    along.push(
      along[i - 1]! + Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y),
    );
  }
  const bounds = mapBounds(world);
  const inside = (p: StreamPoint) => p.x >= bounds.minX && p.x <= bounds.maxX;
  const first = Math.max(0, line.findIndex(inside));
  let last = line.length - 1;
  while (last > 0 && !inside(line[last]!)) last--;
  return { line, along, start: along[first]!, end: along[last]!, bounds };
}

/**
 * Fresh traffic for a river: a few boats already spread along it, the rest
 * setting off from its ends on the spawn timer.
 *
 * @param gates  where bridges cross the river (any point on each bridge)
 */
export function createBoatTraffic(
  line: readonly StreamPoint[],
  world: WorldSize,
  gates: readonly Vec2[] = [],
): BoatTraffic {
  const rng = mulberry32(TRAFFIC_SEED);
  const route = boatRoute(line, world);
  const traffic: BoatTraffic = {
    route,
    boats: [],
    gates: gates.map((g) => nearestAlong(route, g)),
    nextSpawnIn: lerp(BOAT_SPAWN_MIN, BOAT_SPAWN_MAX, rng()) / 2,
    nextId: 1,
    rng,
  };
  for (let i = 0; i < START_BOATS; i++) {
    const kind: BoatKind = i % 2 === 0 ? "sailboat" : "motorboat";
    const dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
    // Spread out along the river, and clear of the bridges.
    let s = lerp(route.start, route.end, (i + 0.25 + rng() * 0.5) / START_BOATS);
    if (traffic.gates.some((g) => Math.abs(g - s) < GATE_CALL)) s += GATE_CALL * 2 * dir;
    s = Math.max(route.start, Math.min(route.end, s));
    traffic.boats.push({ id: traffic.nextId++, kind, s, dir, speed: BOAT_TYPES[kind].speed });
  }
  return traffic;
}

/**
 * Advance every boat by `dt` seconds, retire the ones that reached the far
 * end of the river, and launch a new one when the spawn timer runs out.
 *
 * @param gatesOpen  per bridge (see `createBoatTraffic`): leaves fully up
 */
export function stepBoats(
  traffic: BoatTraffic,
  dt: number,
  gatesOpen: readonly boolean[] = [],
): void {
  const { route } = traffic;
  for (const boat of traffic.boats) {
    const cruise = BOAT_TYPES[boat.kind].speed;
    let target: number = cruise;
    // Sailboats wait short of a bridge that isn't open yet.
    if (boat.kind === "sailboat") {
      traffic.gates.forEach((g, i) => {
        const ahead = (g - boat.s) * boat.dir;
        if (!gatesOpen[i] && ahead > GATE_WAIT - 1 && ahead < GATE_WAIT + 3) target = 0;
      });
    }
    // Don't sail into the boat ahead in the same lane.
    for (const other of traffic.boats) {
      if (other === boat || other.kind !== boat.kind || other.dir !== boat.dir) continue;
      const gap = (other.s - boat.s) * boat.dir;
      if (gap > 0 && gap < BOAT_GAP) target = Math.min(target, other.speed);
    }
    // Ease speed (boats take a moment to stop and to get going).
    boat.speed += (target - boat.speed) * Math.min(1, dt * 1.5);
    boat.s += boat.dir * boat.speed * dt;
  }
  traffic.boats = traffic.boats.filter((b) => b.s >= route.start && b.s <= route.end);

  traffic.nextSpawnIn -= dt;
  if (traffic.nextSpawnIn > 0) return;
  traffic.nextSpawnIn = lerp(BOAT_SPAWN_MIN, BOAT_SPAWN_MAX, traffic.rng());
  if (traffic.boats.length >= BOAT_MAX) return;

  const kind: BoatKind = traffic.rng() < 0.5 ? "sailboat" : "motorboat";
  const dir: 1 | -1 = traffic.rng() < 0.5 ? 1 : -1;
  const s = dir === 1 ? route.start : route.end;
  // Skip the launch if the last boat from this end hasn't got clear yet;
  // the next timer will retry.
  const blocked = traffic.boats.some(
    (b) => b.kind === kind && b.dir === dir && Math.abs(b.s - s) < BOAT_GAP * 2,
  );
  if (blocked) return;
  traffic.boats.push({ id: traffic.nextId++, kind, s, dir, speed: BOAT_TYPES[kind].speed });
}

/** Per bridge: a sailboat is on its way through (within `GATE_CALL`, or under it). */
export function bridgeDemand(traffic: BoatTraffic): boolean[] {
  return traffic.gates.map((g) =>
    traffic.boats.some((b) => {
      if (b.kind !== "sailboat") return false;
      const ahead = (g - b.s) * b.dir;
      // Still wanted until the mast is well past the far side.
      return ahead < GATE_CALL && ahead > -6;
    }),
  );
}

/** Distance along the river of the point nearest `p`. */
function nearestAlong(route: BoatRoute, p: Vec2): number {
  let best = 0;
  let bestD = Infinity;
  route.line.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < bestD) {
      bestD = d;
      best = route.along[i]!;
    }
  });
  return best;
}

/** Index of the segment containing distance `s` (binary search). */
function segmentAt(along: readonly number[], s: number): number {
  let lo = 0;
  let hi = along.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (along[mid]! <= s) lo = mid;
    else hi = mid - 1;
  }
  return Math.max(0, lo);
}

/** Centreline point, and interpolated river width, at distance `s`. */
function sampleRiver(route: BoatRoute, s: number): StreamPoint {
  const i = segmentAt(route.along, s);
  const a = route.line[i]!;
  const b = route.line[Math.min(route.line.length - 1, i + 1)]!;
  const len = route.along[i + 1]! - route.along[i]! || 1;
  const t = Math.max(0, Math.min(1, (s - route.along[i]!) / len));
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), width: lerp(a.width, b.width, t) };
}

/**
 * Where a boat is: on its lane (right of the centreline, looking the way it
 * sails, so boats going opposite ways pass each other), facing along the
 * river, and how visible it is.
 */
export function boatPose(route: BoatRoute, boat: Boat): BoatPose {
  const here = sampleRiver(route, boat.s);
  // Heading from points a little ahead and behind: smooth through the
  // centreline's corners, where a single segment's direction would snap.
  const ahead = sampleRiver(route, boat.s + 2);
  const behind = sampleRiver(route, boat.s - 2);
  let tx = ahead.x - behind.x;
  let ty = ahead.y - behind.y;
  const len = Math.hypot(tx, ty) || 1;
  tx = (tx / len) * boat.dir;
  ty = (ty / len) * boat.dir;

  // Sim +y points down the screen, so (-ty, tx) is to the right of travel:
  // boats keep to starboard, like real river traffic.
  const offset = (BOAT_TYPES[boat.kind].lane * here.width) / 2;
  const pos = { x: here.x - ty * offset, y: here.y + tx * offset };

  const fromEnds = Math.min(boat.s - route.start, route.end - boat.s);
  const opacity = Math.max(
    0,
    Math.min(fromEnds / BOAT_FADE_DISTANCE, 1 - horizonFade(pos, route.bounds)),
  );
  return { pos, heading: Math.atan2(ty, tx), opacity };
}
