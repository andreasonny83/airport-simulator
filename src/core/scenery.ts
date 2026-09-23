/**
 * Procedural scenery layout: map bounds, a meandering stream and scattered
 * trees.
 *
 * This is pure data (no Babylon) so it can be unit-tested like the rest of
 * core. It is decoration only: the simulation never reads it, so nothing
 * here can affect spawning, collisions or landing.
 *
 * Everything is in sim coordinates (origin at the playfield's top-left,
 * +y towards the player). The map extends well past the playfield so the
 * camera can zoom out / rotate without showing the void.
 */
import {
  MAP_SCALE,
  SCENERY_SEED,
  STREAM_AMPLITUDE,
  STREAM_BASE_FY,
  STREAM_WAVELENGTH,
  STREAM_WIDTH,
  TREE_CONIFER_SHARE,
  TREE_DENSITY,
  TREE_RUNWAY_CLEARANCE,
  TREE_SCALE_MAX,
  TREE_SCALE_MIN,
  TREE_STREAM_CLEARANCE,
} from "../config";
import { headingVector, lerp, mulberry32 } from "./math";
import type { Rng, Runway, Vec2, WorldSize } from "./types";

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

export interface Scenery {
  bounds: Bounds;
  /** Stream centreline, sampled left → right across the whole map. */
  stream: Vec2[];
  trees: Tree[];
}

/** Spacing between stream centreline samples (world units). */
const STREAM_SAMPLE_STEP = 1.5;

/**
 * The centreline is two sines added together; the second one's amplitude is
 * this fraction of the first. Total swing is `(1 + ratio) × STREAM_AMPLITUDE`.
 */
const STREAM_SECONDARY_RATIO = 0.4;

/** Max distance of the stream centreline from its base line. */
export const STREAM_MAX_OFFSET = STREAM_AMPLITUDE * (1 + STREAM_SECONDARY_RATIO);

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

/**
 * Scenery map bounds: a square `MAP_SCALE × max(width, height)` on a side,
 * centred on the playfield.
 */
export function mapBounds(world: WorldSize): Bounds {
  const half = (MAP_SCALE * Math.max(world.width, world.height)) / 2;
  const cx = world.width / 2;
  const cy = world.height / 2;
  return { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half };
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

/**
 * Stream centreline across the full map width: the sum of two sines around
 * `STREAM_BASE_FY × height`. Random phases come from `rng`, so a seeded rng
 * gives the same river every time.
 */
export function streamCenterline(world: WorldSize, rng: Rng): Vec2[] {
  const bounds = mapBounds(world);
  const baseY = world.height * STREAM_BASE_FY;
  const phase1 = rng() * Math.PI * 2;
  const phase2 = rng() * Math.PI * 2;
  const k1 = (Math.PI * 2) / STREAM_WAVELENGTH;
  // Non-integer ratio so the two waves never line up into a repeating pattern.
  const k2 = k1 * 2.3;

  const points: Vec2[] = [];
  for (let x = bounds.minX; x <= bounds.maxX + STREAM_SAMPLE_STEP; x += STREAM_SAMPLE_STEP) {
    const y =
      baseY +
      STREAM_AMPLITUDE * Math.sin(k1 * x + phase1) +
      STREAM_AMPLITUDE * STREAM_SECONDARY_RATIO * Math.sin(k2 * x + phase2);
    points.push({ x, y });
  }
  return points;
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
 * Distance from `p` to a runway's rectangle (0 when inside). Works in the
 * runway's local frame: `u` along the heading, `v` across it.
 */
export function distanceToRunway(p: Vec2, runway: Runway): number {
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
  runways: readonly Runway[],
  stream: readonly Vec2[],
  rng: Rng,
): Tree[] {
  const b = mapBounds(world);
  const area = (b.maxX - b.minX) * (b.maxY - b.minY);
  const candidates = Math.round((area / 1000) * TREE_DENSITY);
  const streamClearance = STREAM_WIDTH / 2 + TREE_STREAM_CLEARANCE;
  const baseY = world.height * STREAM_BASE_FY;

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

    if (runways.some((r) => distanceToRunway(pos, r) < TREE_RUNWAY_CLEARANCE)) continue;
    // Cheap band test first: the stream never strays further than
    // STREAM_MAX_OFFSET from its base line, so most points skip the polyline.
    if (
      Math.abs(pos.y - baseY) < STREAM_MAX_OFFSET + streamClearance &&
      distanceToPolyline(pos, stream) < streamClearance
    ) {
      continue;
    }
    if (keepRoll >= treeDensity(pos, world)) continue;

    trees.push({ kind, pos, scale, rotation, tint });
  }
  return trees;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Full scenery layout for a world size. Deterministic (fixed seed). */
export function buildScenery(world: WorldSize, runways: readonly Runway[]): Scenery {
  const rng = mulberry32(SCENERY_SEED);
  const stream = streamCenterline(world, rng);
  const trees = scatterTrees(world, runways, stream, rng);
  return { bounds: mapBounds(world), stream, trees };
}
