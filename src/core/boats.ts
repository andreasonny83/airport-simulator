/**
 * River boat traffic: small boats that now and then sail along the stretch
 * of river beside the playfield.
 *
 * Purely decorative, like the rest of the scenery: the simulation never
 * reads it, so boats can't affect planes, paths or scoring. Kept pure (no
 * Babylon) so the timing and movement are deterministic and testable;
 * render/boats.ts turns it into meshes.
 */
import {
  BOAT_FADE_DISTANCE,
  BOAT_MAX,
  BOAT_ROUTE_MARGIN,
  BOAT_SPAWN_MAX,
  BOAT_SPAWN_MIN,
  BOAT_TYPES,
} from "../config";
import { lerp, mulberry32 } from "./math";
import type { StreamPoint } from "./scenery";
import type { Rng, Vec2, WorldSize } from "./types";

export type BoatKind = keyof typeof BOAT_TYPES;

export interface Boat {
  id: number;
  kind: BoatKind;
  /** Distance travelled along the river centreline (see `BoatRoute.along`). */
  s: number;
  /** +1 sails downstream (increasing `s`), -1 upstream. */
  dir: 1 | -1;
}

/** The stretch of river boats use, with arc lengths for sampling. */
export interface BoatRoute {
  line: readonly StreamPoint[];
  /** Cumulative distance along `line` at each point. */
  along: number[];
  /** Boats appear and disappear at these distances (just off the field). */
  start: number;
  end: number;
}

export interface BoatTraffic {
  route: BoatRoute;
  boats: Boat[];
  /** Seconds until the next boat tries to set off. */
  nextSpawnIn: number;
  nextId: number;
  rng: Rng;
}

/** Where a boat is right now, ready for rendering. */
export interface BoatPose {
  pos: Vec2;
  heading: number;
  /** 0..1: fades in/out near the route's ends so boats never pop. */
  opacity: number;
}

/** Seed for boat traffic, so every game shows the same rhythm of boats. */
const TRAFFIC_SEED = 0xb0a7;

/**
 * Route over the part of the river within `BOAT_ROUTE_MARGIN` of the
 * playfield (the river itself runs right across the much larger map, and
 * a boat crawling along all of it would spend minutes out of sight).
 */
export function boatRoute(line: readonly StreamPoint[], world: WorldSize): BoatRoute {
  const along: number[] = [0];
  for (let i = 1; i < line.length; i++) {
    along.push(
      along[i - 1]! + Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.y - line[i - 1]!.y),
    );
  }
  const margin = BOAT_ROUTE_MARGIN * world.height;
  const first = line.findIndex((p) => p.x >= -margin);
  let last = line.length - 1;
  while (last > 0 && line[last]!.x > world.width + margin) last--;
  return {
    line,
    along,
    start: along[Math.max(0, first)]!,
    end: along[Math.max(0, last)]!,
  };
}

/**
 * Fresh traffic for a river. One sailboat is already under way beside the
 * field, so the river looks alive from the first frame; the rest launch
 * from the route's ends on the spawn timer.
 */
export function createBoatTraffic(line: readonly StreamPoint[], world: WorldSize): BoatTraffic {
  const rng = mulberry32(TRAFFIC_SEED);
  const route = boatRoute(line, world);
  return {
    route,
    boats: [{ id: 1, kind: "sailboat", s: lerp(route.start, route.end, 0.35), dir: 1 }],
    nextSpawnIn: lerp(BOAT_SPAWN_MIN, BOAT_SPAWN_MAX, rng()) / 2,
    nextId: 2,
    rng,
  };
}

/**
 * Advance every boat by `dt` seconds, retire the ones that reached the far
 * end of the route, and launch a new one when the spawn timer runs out.
 */
export function stepBoats(traffic: BoatTraffic, dt: number): void {
  const { route } = traffic;
  for (const boat of traffic.boats) {
    boat.s += boat.dir * BOAT_TYPES[boat.kind].speed * dt;
  }
  traffic.boats = traffic.boats.filter((b) => b.s >= route.start && b.s <= route.end);

  traffic.nextSpawnIn -= dt;
  if (traffic.nextSpawnIn > 0) return;
  traffic.nextSpawnIn = lerp(BOAT_SPAWN_MIN, BOAT_SPAWN_MAX, traffic.rng());
  if (traffic.boats.length >= BOAT_MAX) return;

  const kind: BoatKind = traffic.rng() < 0.5 ? "sailboat" : "motorboat";
  const dir: 1 | -1 = traffic.rng() < 0.5 ? 1 : -1;
  const s = dir === 1 ? route.start : route.end;
  // Same kind + same direction = same speed and lane, so a boat can only
  // collide with one that launched from the same end moments ago. Skip the
  // launch if that one hasn't got clear yet; the next timer will retry.
  const blocked = traffic.boats.some(
    (b) => b.kind === kind && b.dir === dir && Math.abs(b.s - s) < BOAT_FADE_DISTANCE * 1.5,
  );
  if (blocked) return;
  traffic.boats.push({ id: traffic.nextId++, kind, s, dir });
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
  const opacity = Math.max(0, Math.min(1, fromEnds / BOAT_FADE_DISTANCE));
  return { pos, heading: Math.atan2(ty, tx), opacity };
}
