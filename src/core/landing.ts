/**
 * Landing detection.
 */
import { LANDING_ANGLE_TOLERANCE, LANDING_RADIUS } from "../config";
import { angleDelta, distance } from "./math";
import type { Plane, Runway } from "./types";

/** Result of `checkLanding`. */
export type LandingCheck =
  | { type: "landed"; runway: Runway }
  /** On a good approach, but the touchdown zone is blocked: go around. */
  | { type: "goAround"; runway: Runway }
  | null;

/**
 * If `plane` is over the threshold of its matching runway and travelling in
 * roughly the landing direction, switch it to the `landing` phase.
 *
 * Arriving from the wrong end (or crossing the runway side-on) does nothing:
 * the plane keeps flying and the player has to route it round again. So
 * does arriving while `isClear(runway)` says the touchdown zone is blocked;
 * then its approach path is cancelled and a go-around is reported (once).
 */
export function checkLanding(
  plane: Plane,
  runways: readonly Runway[],
  isClear: (runway: Runway) => boolean = () => true,
): LandingCheck {
  if (plane.phase !== "flying") return null;

  for (const runway of runways) {
    if (runway.color !== plane.color) continue;
    if (distance(plane.pos, runway.threshold) > LANDING_RADIUS) continue;
    if (Math.abs(angleDelta(plane.heading, runway.heading)) > LANDING_ANGLE_TOLERANCE) continue;

    if (!isClear(runway)) {
      // Only report planes that were actually on an approach (an anchored
      // path), and only once: dropping the path stops repeats next step.
      if (!plane.pathAnchored) return null;
      plane.path = [];
      plane.pathAnchored = false;
      plane.pathVersion++;
      return { type: "goAround", runway };
    }

    // Hand over from the drawn path to the ground route (see core/ground.ts,
    // `touchDown`), which curves the plane onto the centreline from its
    // current heading: no snap.
    plane.phase = "landing";
    plane.path = [];
    plane.pathAnchored = false;
    plane.pathVersion++;
    plane.warning = false;
    return { type: "landed", runway };
  }
  return null;
}
