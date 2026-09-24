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
 *   - bumps:  a little roll/pitch jitter from turbulence.
 *
 * All effects are kept small so the plane still sits over its path line
 * and under the player's finger.
 */
import type { Vec2 } from "../core/types";

/** Largest drift offset from the true position (world units). */
const DRIFT_AMPLITUDE = 0.45;
/** Largest crab angle into a full-strength crosswind (radians, ~6°). */
const MAX_CRAB = 0.1;
/** Largest turbulence roll/pitch wobble (radians, ~2°). */
const BUMP_AMPLITUDE = 0.035;
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
}

/**
 * Turbulence signal in roughly [-1, 1] for one plane.
 *
 * `phase` is different for each plane, so they don't all bob in sync.
 *
 * TODO(you): shape the feel of the turbulence here. The current version is
 * one smooth sine: steady, regular swaying.
 */
export function turbulence(time: number, phase: number): number {
  return Math.sin(time * 0.9 + phase);
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

  // Crosswind component: sin(wind - heading) is +1 when the wind blows from
  // the plane's left towards its right. The nose turns into the wind (the
  // opposite way) to cancel the drift.
  const crosswind = Math.sin(dir - heading) * strength * exposure;

  return {
    drift: {
      x: Math.cos(dir) * gust * DRIFT_AMPLITUDE,
      y: Math.sin(dir) * gust * DRIFT_AMPLITUDE,
    },
    crab: -crosswind * MAX_CRAB,
    roll: chop * BUMP_AMPLITUDE,
    pitch: gust * BUMP_AMPLITUDE * 0.5,
  };
}
