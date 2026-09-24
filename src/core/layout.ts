/**
 * World sizing and runway placement.
 *
 * The world is always `WORLD_HEIGHT` units tall; its width follows the
 * viewport aspect ratio so the playfield fills the screen. Runways are placed
 * at fractions of the world size, so they re-flow on every resize.
 */
import {
  AIRSPACE_SCREEN_INSET,
  CAMERA_FIT_PADDING,
  CAMERA_TILT,
  FLIGHT_ALTITUDE,
  RUNWAY_LAYOUT,
  RUNWAY_LENGTH,
  RUNWAY_THRESHOLD_INSET,
  RUNWAY_WIDTH,
  WORLD_HEIGHT,
  YELLOW_RUNWAY_MIN_WIDTH,
} from "../config";
import { headingVector } from "./math";
import type { Bounds } from "./scenery";
import type { Runway, Vec2, WorldSize } from "./types";

/** World dimensions for a viewport with the given width / height ratio. */
export function computeWorldSize(aspect: number): WorldSize {
  // Guard against a 0×0 canvas during startup (aspect would be NaN/Infinity).
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  return { width: WORLD_HEIGHT * safeAspect, height: WORLD_HEIGHT };
}

/**
 * Half-height (scene units) of the orthographic view that shows the whole
 * field at zoom 1. The camera divides this by its zoom (render/camera.ts).
 *
 * It fits the field's bounding circle rather than its rectangle, so the
 * scale never changes while the view rotates:
 * - screen X: a ground point `r` from the centre spans at most ±r;
 * - screen Y: ground distance is foreshortened by cos(tilt), and altitude
 *   adds up to FLIGHT_ALTITUDE · sin(tilt).
 *
 * @param aspect  viewport width / height
 */
export function viewHalfHeight(world: WorldSize, aspect: number): number {
  const r = Math.hypot(world.width / 2, world.height / 2);
  const maxX = r;
  const maxY = r * Math.cos(CAMERA_TILT) + FLIGHT_ALTITUDE * Math.sin(CAMERA_TILT);
  const safeAspect = aspect > 0 ? aspect : 1;
  return Math.max(maxY, maxX / safeAspect) * CAMERA_FIT_PADDING;
}

/**
 * The airspace: the ground visible in the default camera view (zoom 1, not
 * rotated), pulled in from every screen edge by `AIRSPACE_SCREEN_INSET`.
 * Paths are clipped to it, planes spawn just outside it, and a plane steered
 * past it leaves the world.
 *
 * Sizing it from the view (rather than a fixed margin round the field) keeps
 * the edge on screen with an even gap on any aspect ratio: 4:3 has little
 * room beside the field, ultrawide and portrait screens have lots.
 *
 * The world's aspect equals the viewport's (see `computeWorldSize`), so the
 * view can be worked out from `world` alone.
 */
export function airspaceBounds(world: WorldSize): Bounds {
  const aspect = world.width / world.height;
  const halfH = viewHalfHeight(world, aspect);
  const gap = halfH * AIRSPACE_SCREEN_INSET;
  // Screen X is ground X one-to-one; screen Y is ground depth × cos(tilt).
  // Never smaller than the field itself.
  const halfX = Math.max(world.width / 2, halfH * aspect - gap);
  const halfY = Math.max(world.height / 2, (halfH - gap) / Math.cos(CAMERA_TILT));
  const cx = world.width / 2;
  const cy = world.height / 2;
  return { minX: cx - halfX, minY: cy - halfY, maxX: cx + halfX, maxY: cy + halfY };
}

/** True if `p` is inside the airspace (edge included). */
export function isInAirspace(p: Vec2, world: WorldSize): boolean {
  const b = airspaceBounds(world);
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
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
