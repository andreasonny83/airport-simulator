/**
 * Onboarding progression: how much traffic the player is trusted with.
 *
 * A new shift starts with one plane of one colour. Landings (and, slowly,
 * time) raise the number of planes allowed in the air at once, and landings
 * open further runway colours one at a time. `step` and `spawnPlane` consult
 * these rules; nothing here mutates state.
 */
import {
  COLOR_UNLOCK_SCORES,
  LANDINGS_PER_EXTRA_PLANE,
  MAX_AIRBORNE,
  RUNWAY_LAYOUT,
  SECONDS_PER_EXTRA_PLANE,
} from "../config";
import type { Plane, Runway, RunwayColor } from "./types";

/**
 * Cap on simultaneously *flying* planes (rolling-out planes don't count).
 *
 * Contract: returns 1 at `(0, 0)`, never decreases as either argument grows,
 * and never exceeds `MAX_AIRBORNE`.
 *
 * @param score    planes landed so far this shift
 * @param elapsed  seconds since the shift started
 *
 * Two ways to combine the landing and time contributions:
 *   - additive (`1 + fromLandings + fromTime`): time keeps adding pressure
 *     even for a skilled player, so late game gets busier for everyone;
 *   - `max(landingCap, timeCap)`: time only rescues a stuck/idle player and
 *     never overtakes someone landing planes steadily.
 *
 * TODO(you): pick a combination and fold in `elapsed` /
 * `SECONDS_PER_EXTRA_PLANE`. Until then the cap is driven by landings alone.
 */
export function maxAirborne(score: number, elapsed: number): number {
  void elapsed;
  void SECONDS_PER_EXTRA_PLANE;
  const cap = 1 + Math.floor(score / LANDINGS_PER_EXTRA_PLANE);
  return Math.min(MAX_AIRBORNE, cap);
}

/**
 * Colours new planes may be given at this score: runways in `RUNWAY_LAYOUT`
 * order whose unlock score has been reached, skipping any that aren't on the
 * field (portrait screens have no yellow runway). Always includes the first
 * existing runway so there is something to spawn.
 */
export function unlockedColors(score: number, runways: readonly Runway[]): RunwayColor[] {
  const present = RUNWAY_LAYOUT.map((r) => r.color).filter((c) =>
    runways.some((r) => r.color === c),
  );
  const open = present.filter((c) => COLOR_UNLOCK_SCORES[c] <= score);
  if (open.length === 0 && present[0]) open.push(present[0]);
  return open;
}

/**
 * Colours that open exactly when the score goes from `before` to `after`
 * (only those with a runway on the field).
 */
export function newlyUnlockedColors(
  before: number,
  after: number,
  runways: readonly Runway[],
): RunwayColor[] {
  const was = new Set(unlockedColors(before, runways));
  return unlockedColors(after, runways).filter((c) => !was.has(c));
}

/** Number of planes still in the air (not rolling out or finished). */
export function flyingCount(planes: readonly Plane[]): number {
  let n = 0;
  for (const p of planes) if (p.phase === "flying") n++;
  return n;
}
