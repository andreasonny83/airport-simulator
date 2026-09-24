/**
 * Landing detection.
 */
import { LANDING_ANGLE_TOLERANCE, LANDING_RADIUS } from "../config";
import { angleDelta, distance } from "./math";
import type { Plane, Runway } from "./types";

/**
 * If `plane` is over the threshold of its matching runway and travelling in
 * roughly the landing direction, switch it to the `landing` phase.
 *
 * Arriving from the wrong end (or crossing the runway side-on) does nothing:
 * the plane keeps flying and the player has to route it round again.
 *
 * @returns the runway landed on, or null.
 */
export function checkLanding(plane: Plane, runways: readonly Runway[]): Runway | null {
  if (plane.phase !== "flying") return null;

  for (const runway of runways) {
    if (runway.color !== plane.color) continue;
    if (distance(plane.pos, runway.threshold) > LANDING_RADIUS) continue;
    if (Math.abs(angleDelta(plane.heading, runway.heading)) > LANDING_ANGLE_TOLERANCE) continue;

    plane.phase = "landing";
    plane.heading = runway.heading; // snap onto the runway centreline heading
    plane.turnRate = 0; // wings level for the rollout (the renderer eases the visuals)
    plane.path = [];
    plane.pathAnchored = false;
    plane.pathVersion++;
    plane.landingProgress = 0;
    plane.warning = false;
    return runway;
  }
  return null;
}
