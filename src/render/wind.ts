/**
 * Purely visual wind: makes airborne planes look like they're flying through
 * moving air.
 *
 * Nothing in here touches the simulation. Collisions, landings and paths all
 * use the true `plane.pos` / `plane.heading`. The renderer only adds:
 *   - drift:  a small position offset (a fraction of a world unit) that
 *             swells and fades with gusts, as if the plane gets pushed about;
 *   - crab:   a slight yaw into the crosswind, like a real pilot holding a
 *             track in a side wind;
 *   - bumps:  roll/pitch wobble and a little up/down bob from turbulence
 *             (the bob also shows in the plane's ground shadow).
 *
 * Effects are tuned to read clearly at game zoom (1 world unit is roughly
 * 9 px at 720p) while staying well inside the plane's grab radius, so the
 * plane still sits near its path line and under the player's finger.
 */
import type { Vec2 } from "../core/types";

/** Largest drift offset along the wind (world units, about half a plane length). */
const DRIFT_AMPLITUDE = 0.1;
/** Largest sideways wander across the wind, as a fraction of the drift. */
const WANDER_SHARE = 0.1;
/** Largest crab angle into a full-strength crosswind (radians, ~10°). */
const MAX_CRAB = 0.1;
/** Largest turbulence roll wobble (radians, ~8°); pitch uses half. */
const BUMP_AMPLITUDE = 0.1;
/** Largest altitude bob (scene units). */
const LIFT_AMPLITUDE = 0.1;
/** Prevailing wind direction (sim radians) and how far it slowly veers. */
const BASE_DIRECTION = Math.PI * 0.15;
const VEER = 0.5;

/** Visual wind effect for one plane at one moment. */
export interface WindEffect {
  /** Offset to add to the plane's sim position (world units). */
  drift: Vec2;
  /** Extra yaw (radians) to add to the displayed heading. */
  crab: number;
  /** Extra roll (radians) about the nose. */
  roll: number;
  /** Extra pitch (radians). */
  pitch: number;
  /** Extra altitude (scene units): up and down bumps. */
  lift: number;
}

/**
 * Turbulence signal in roughly [-1, 1] for one plane.
 *
 * `phase` is different for each plane, so they don't all bob in sync.
 *
 * Two ingredients:
 * - sway: three sines at unrelated frequencies. The sum never quite repeats,
 *   so it reads as restless air rather than a metronome.
 * - gusts: a high odd power of a slow sine. It stays near 0 most of the time
 *   and spikes briefly around its peaks, giving an occasional hard shove.
 *   The odd power keeps the sign, so gusts push both ways.
 *
 * `tanh` softly limits the total to (-1, 1) without clipping the peaks flat.
 */
export function turbulence(time: number, phase: number): number {
  const sway =
    0.55 * Math.sin(time * 0.7 + phase) +
    0.3 * Math.sin(time * 1.9 + phase * 1.7) +
    0.15 * Math.sin(time * 4.3 + phase * 2.9);
  const gust = Math.sin(time * 0.31 + phase * 0.5) ** 9;
  return Math.tanh(sway * 1.1 + gust * 0.9);
}

/**
 * Wind direction (sim radians) and strength (0..1) at `time`: one prevailing
 * wind that slowly veers and breathes. Shared by every plane.
 */
function windAt(time: number): { dir: number; strength: number } {
  return {
    dir: BASE_DIRECTION + VEER * Math.sin(time * 0.05),
    strength: 0.7 + 0.3 * Math.sin(time * 0.13 + 1.3),
  };
}

/**
 * Wind effect on a plane flying along `heading`.
 *
 * @param id        plane id, used to spread per-plane phases
 * @param exposure  0..1; scales everything down, e.g. to 0 once the plane
 *                  has touched down on the runway
 */
export function windEffect(
  time: number,
  id: number,
  heading: number,
  exposure: number,
): WindEffect {
  const { dir, strength } = windAt(time);
  // Golden-ratio spacing spreads the phases evenly, whatever the id.
  const phase = id * 2.399963;
  const gust = turbulence(time, phase) * strength * exposure;
  // A second, faster signal for the bumps, so drift and wobble don't move
  // in lockstep.
  const chop = turbulence(time * 2.7, phase * 1.7 + 4.1) * strength * exposure;
  // A third signal for side-to-side wander, so the drift traces a loose 2D
  // wobble instead of sliding back and forth along one line.
  const wander = turbulence(time * 1.3, phase * 0.6 + 2.2) * strength * exposure;

  // Crosswind component: sin(wind - heading) is +1 when the wind blows from
  // the plane's left towards its right. The nose turns into the wind (the
  // opposite way) to cancel the drift.
  const crosswind = Math.sin(dir - heading) * strength * exposure;

  return {
    drift: {
      // Along the wind, plus a smaller push across it (perpendicular is
      // (-sin, cos)).
      x: (Math.cos(dir) * gust - Math.sin(dir) * wander * WANDER_SHARE) * DRIFT_AMPLITUDE,
      y: (Math.sin(dir) * gust + Math.cos(dir) * wander * WANDER_SHARE) * DRIFT_AMPLITUDE,
    },
    crab: -crosswind * MAX_CRAB,
    roll: chop * BUMP_AMPLITUDE,
    pitch: gust * BUMP_AMPLITUDE * 0.5,
    lift: chop * LIFT_AMPLITUDE,
  };
}
