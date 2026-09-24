/**
 * Plane spawning and the difficulty curve.
 */
import { PLANE_RADIUS, SPAWN_HEADING_JITTER, WARNING_DISTANCE } from "../config";
import { airspaceBounds } from "./layout";
import { distance } from "./math";
import { createPlane } from "./plane";
import { unlockedColors } from "./progression";
import type { GameState, Plane, Rng, RunwayColor, Vec2, WorldSize } from "./types";

export interface SpawnSpec {
  color: RunwayColor;
  pos: Vec2;
  heading: number;
}

/**
 * Pick a random colour, screen edge and inward heading for a new plane.
 * Planes appear just outside the airspace (one radius beyond its edge).
 */
export function pickSpawn(world: WorldSize, colors: readonly RunwayColor[], rng: Rng): SpawnSpec {
  const color = colors[Math.floor(rng() * colors.length)] ?? colors[0] ?? "red";
  const edge = Math.floor(rng() * 4); // 0 top, 1 right, 2 bottom, 3 left
  const along = rng();
  const jitter = (rng() - 0.5) * 2 * SPAWN_HEADING_JITTER;
  const r = PLANE_RADIUS;
  // Enter across the airspace edge, but aimed at the runway field: `along`
  // spans the field's side, not the (wider) airspace's.
  const b = airspaceBounds(world);

  switch (edge) {
    case 0:
      return {
        color,
        pos: { x: along * world.width, y: b.minY - r },
        heading: Math.PI / 2 + jitter,
      };
    case 1:
      return {
        color,
        pos: { x: b.maxX + r, y: along * world.height },
        heading: Math.PI + jitter,
      };
    case 2:
      return {
        color,
        pos: { x: along * world.width, y: b.maxY + r },
        heading: -Math.PI / 2 + jitter,
      };
    default:
      return { color, pos: { x: b.minX - r, y: along * world.height }, heading: jitter };
  }
}

/** How many times to re-roll a spawn that lands on top of another plane. */
const SPAWN_ATTEMPTS = 5;

/**
 * Add a new plane to `state`, only using colours whose runway exists and
 * has been unlocked at the current score (see `unlockedColors`). Re-rolls a few times to avoid spawning into an instant crash.
 *
 * @returns the new plane, or null if there are no runways.
 */
export function spawnPlane(state: GameState, rng: Rng): Plane | null {
  const colors = unlockedColors(state.score, state.runways);
  if (colors.length === 0) return null;

  let spec = pickSpawn(state.world, colors, rng);
  for (let i = 1; i < SPAWN_ATTEMPTS && isCrowded(spec.pos, state.planes); i++) {
    spec = pickSpawn(state.world, colors, rng);
  }

  const plane = createPlane(state.nextPlaneId++, spec.color, spec.pos, spec.heading);
  state.planes.push(plane);
  return plane;
}

function isCrowded(pos: Vec2, planes: readonly Plane[]): boolean {
  return planes.some((p) => p.phase === "flying" && distance(p.pos, pos) < WARNING_DISTANCE);
}

/**
 * Difficulty curve: decide the delay (seconds) before the NEXT spawn.
 * Called once right after each spawn.
 *
 * @param current  the interval that was just used (seconds)
 * @param score    planes landed so far this shift
 * @param elapsed  seconds since the shift started
 * @returns        the next interval in seconds (clamp to SPAWN_INTERVAL_MIN!)
 *
 * The prototype shaved a fixed 50 ms off after every spawn, down to a 1 s
 * floor — a purely time-based ramp. Alternatives worth considering:
 *   - score-based: reward skill, so a struggling player isn't buried;
 *   - stepped "waves": hold steady, then jump, giving breathing room;
 *   - exponential decay towards the floor: fast early ramp, gentle late game.
 *
 * TODO(you): implement the curve. Until then difficulty stays constant.
 */
export function nextSpawnInterval(current: number, score: number, elapsed: number): number {
  void score;
  void elapsed;
  return current;
}
