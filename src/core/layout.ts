/**
 * World sizing and runway placement.
 *
 * The world is always `WORLD_HEIGHT` units tall; its width follows the
 * viewport aspect ratio so the playfield fills the screen. Runways are placed
 * at fractions of the world size, so they re-flow on every resize.
 */
import {
  RUNWAY_LAYOUT,
  RUNWAY_LENGTH,
  RUNWAY_THRESHOLD_INSET,
  RUNWAY_WIDTH,
  WORLD_HEIGHT,
  YELLOW_RUNWAY_MIN_WIDTH,
} from "../config";
import { headingVector } from "./math";
import type { Runway, WorldSize } from "./types";

/** World dimensions for a viewport with the given width / height ratio. */
export function computeWorldSize(aspect: number): WorldSize {
  // Guard against a 0×0 canvas during startup (aspect would be NaN/Infinity).
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return { width: WORLD_HEIGHT * safeAspect, height: WORLD_HEIGHT };
}

/** Build the runway list for a given world size. */
export function layoutRunways(world: WorldSize): Runway[] {
  return RUNWAY_LAYOUT.filter(
    // Narrow (portrait) screens only get two runways, like the prototype.
    (spec) => spec.color !== "yellow" || world.width >= YELLOW_RUNWAY_MIN_WIDTH,
  ).map((spec) => {
    const center = { x: world.width * spec.fx, y: world.height * spec.fy };
    const dir = headingVector(spec.heading);
    // The threshold sits near the runway end the plane arrives at, i.e.
    // *behind* the centre relative to the landing heading.
    const back = RUNWAY_LENGTH / 2 - RUNWAY_THRESHOLD_INSET;
    return {
      color: spec.color,
      center,
      heading: spec.heading,
      length: RUNWAY_LENGTH,
      width: RUNWAY_WIDTH,
      threshold: { x: center.x - dir.x * back, y: center.y - dir.y * back },
    };
  });
}

/**
 * Painted runway number, as on a real airfield: the landing direction's
 * compass bearing in tens of degrees, 01–36 (north is 36, never 00).
 *
 * "North" is up the screen at the default camera, i.e. sim -y. A heading
 * of 0 (+x, east) is bearing 090 → "09".
 */
export function runwayDesignator(heading: number): string {
  const dir = headingVector(heading);
  // atan2(east, north) gives a clockwise-from-north bearing.
  const bearing = ((Math.atan2(dir.x, -dir.y) * 180) / Math.PI + 360) % 360;
  const tens = Math.round(bearing / 10) % 36 || 36;
  return String(tens).padStart(2, "0");
}
