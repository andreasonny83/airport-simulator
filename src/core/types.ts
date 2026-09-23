/**
 * Core simulation types.
 *
 * Everything in `src/core` is pure TypeScript: no DOM, no Babylon.js. The sim
 * lives on a flat 2D ground plane measured in "world units". The render layer
 * maps sim `(x, y)` onto Babylon's `(x, z)` ground axes.
 *
 * Conventions:
 * - Origin is the top-left corner of the playfield; `x` grows right, `y` grows
 *   "down" (towards the player), matching the original 2D prototype.
 * - Headings are radians measured with `Math.atan2(dy, dx)`, so `0` points
 *   along +x and `Math.PI / 2` points along +y.
 */

/** A point or vector on the ground plane, in world units. */
export interface Vec2 {
  x: number;
  y: number;
}

/** Colours shared by runways and the planes that must land on them. */
export type RunwayColor = "red" | "blue" | "yellow";

/**
 * Lifecycle of a single plane:
 * - `flying`  : airborne, follows its path, can collide.
 * - `landing` : touched down, rolling along the runway and fading out.
 * - `landed`  : finished; pruned from state at the end of the step.
 */
export type PlanePhase = "flying" | "landing" | "landed";

/**
 * Top-level game phase, drives which overlay the UI shows. `step` only
 * advances the sim while `playing`, so `paused` freezes everything in place.
 */
export type GamePhase = "start" | "playing" | "paused" | "gameover";

/** Size of the playfield in world units (height is fixed, width follows aspect). */
export interface WorldSize {
  width: number;
  height: number;
}

export interface Plane {
  /** Stable id, used by the render layer to match meshes to planes. */
  id: number;
  color: RunwayColor;
  pos: Vec2;
  /** Direction of travel in radians (see file header for convention). */
  heading: number;
  /** Remaining waypoints drawn by the player, consumed front-to-back. */
  path: Vec2[];
  /**
   * Bumped every time `path` changes (point added, waypoint consumed, path
   * cleared). Lets the renderer rebuild the path line only when needed.
   */
  pathVersion: number;
  phase: PlanePhase;
  /** 0 → 1 while rolling down the runway; drives deceleration and fade. */
  landingProgress: number;
  /** True while another flying plane is dangerously close. */
  warning: boolean;
}

export interface Runway {
  color: RunwayColor;
  /** Centre of the runway strip. */
  center: Vec2;
  /** Direction a plane must be travelling to land (radians). */
  heading: number;
  /** Strip length along `heading` (world units). */
  length: number;
  /** Strip width across `heading` (world units). */
  width: number;
  /** Touchdown point: planes must pass over this point to land. */
  threshold: Vec2;
}

export interface GameState {
  phase: GamePhase;
  /** Number of planes landed this shift. */
  score: number;
  /** Seconds since the current shift started. */
  elapsed: number;
  /** Seconds accumulated towards the next spawn. */
  spawnTimer: number;
  /** Seconds between spawns; shrinks as difficulty ramps up. */
  spawnInterval: number;
  /** Next id handed out by `createPlane`. */
  nextPlaneId: number;
  world: WorldSize;
  runways: Runway[];
  planes: Plane[];
}

/** Things that happened during a `step`, for the UI/renderer to react to. */
export type SimEvent =
  | { type: "spawned"; planeId: number }
  | { type: "landed"; planeId: number; color: RunwayColor }
  | { type: "crash"; planeIds: [number, number]; at: Vec2 };

/** Random source in `[0, 1)`. Injected so tests can be deterministic. */
export type Rng = () => number;
