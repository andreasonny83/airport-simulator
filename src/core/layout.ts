/**
 * World sizing and runway placement.
 *
 * The world is always `WORLD_HEIGHT` units tall; its width follows the
 * viewport aspect ratio so the playfield fills the screen. Runways are placed
 * at fractions of the world size, so they re-flow on every resize.
 */
import {
  AIRSPACE_MARGIN,
  CAMERA_FIT_PADDING,
  CAMERA_TILT,
  FLIGHT_ALTITUDE,
  RUNWAY_LAYOUT,
  RUNWAY_LENGTH,
  RUNWAY_THRESHOLD_INSET,
  RUNWAY_WIDTH,
  WORLD_HEIGHT,
  YELLOW_RUNWAY_MIN_WIDTH,
  ZOOM_MIN,
} from "../config";
import { layoutAirfield } from "./airfield";
import { headingVector } from "./math";
import type { Bounds } from "./scenery";
import type { Runway, Vec2, WorldSize } from "./types";

/** World dimensions for a viewport with the given width / height ratio. */
export function computeWorldSize(aspect: number): WorldSize {
  // Guard against a 0×0 canvas during startup (aspect would be NaN/Infinity).
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  // const safeAspect = 1.6;
  return { width: WORLD_HEIGHT * safeAspect, height: WORLD_HEIGHT };
}

/**
 * The airspace: the runway field grown by `AIRSPACE_MARGIN` on every side.
 * Paths are clipped to it, planes fly in across its edge (see
 * core/spawner.ts), and a plane steered past it leaves the world.
 *
 * The far/near margin is stretched by 1 / cos(tilt): the camera
 * foreshortens ground depth by cos(tilt), so on screen the gap round the
 * field looks the same on all four sides.
 */
export function airspaceBounds(world: WorldSize): Bounds {
  const mx = AIRSPACE_MARGIN;
  const my = AIRSPACE_MARGIN / Math.cos(CAMERA_TILT);
  return { minX: -mx, minY: -my, maxX: world.width + mx, maxY: world.height + my };
}

/**
 * Half-height (scene units) of the orthographic view that frames the
 * airspace at zoom 1 and the default heading. The camera divides this by
 * its zoom (render/camera.ts).
 *
 * - screen X: ground x maps one-to-one;
 * - screen Y: ground depth is foreshortened by cos(tilt), and altitude
 *   adds up to FLIGHT_ALTITUDE · sin(tilt) (planes on the far edge).
 *
 * It only depends on the world, never on the current heading, so rotating
 * the view never changes the scale. (Turned away from the default heading,
 * the airspace's corners can leave the screen; zooming out brings them back.)
 *
 * @param aspect  viewport width / height
 */
export function viewHalfHeight(world: WorldSize, aspect: number): number {
  const a = airspaceBounds(world);
  const maxX = (a.maxX - a.minX) / 2;
  const maxY =
    ((a.maxY - a.minY) / 2) * Math.cos(CAMERA_TILT) + FLIGHT_ALTITUDE * Math.sin(CAMERA_TILT);
  const safeAspect = aspect > 0 ? aspect : 1;
  return Math.max(maxY, maxX / safeAspect) * CAMERA_FIT_PADDING;
}

/**
 * The patch of ground the default view shows (zoom 1, not rotated or
 * panned), in sim coordinates. Wider than the airspace on one axis unless
 * the screen's aspect matches it exactly. Arriving planes start outside it,
 * so they fly into view instead of popping up.
 *
 * The world's aspect equals the viewport's (see `computeWorldSize`), so the
 * view can be worked out from `world` alone.
 */
export function defaultViewBounds(world: WorldSize): Bounds {
  const aspect = world.width / world.height;
  const halfH = viewHalfHeight(world, aspect);
  const halfX = halfH * aspect;
  const halfY = halfH / Math.cos(CAMERA_TILT);
  const cx = world.width / 2;
  const cy = world.height / 2;
  return { minX: cx - halfX, minY: cy - halfY, maxX: cx + halfX, maxY: cy + halfY };
}

/**
 * How far (as a fraction of the field's half-size) the view may be panned
 * off the field's centre at `zoom`. Full range from zoom 1 in, shrinking
 * linearly to nothing at `ZOOM_MIN`, where the view is already wide enough.
 * This keeps the zoomed-out view centred, so the scenery map (see
 * core/scenery.ts `mapBounds`) needn't stretch to cover a far-panned one.
 */
export function panFraction(zoom: number): number {
  return Math.min(1, Math.max(0, (zoom - ZOOM_MIN) / (1 - ZOOM_MIN)));
}

/** True if `p` is inside the airspace (edge included). */
export function isInAirspace(p: Vec2, world: WorldSize): boolean {
  const b = airspaceBounds(world);
  return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
}

/** Build the runway list (each with its taxiway and hangars) for a world size. */
export function layoutRunways(world: WorldSize): Runway[] {
  let nextStandId = 0;
  return RUNWAY_LAYOUT.filter(
    // Narrow (portrait) screens only get two runways, like the prototype.
    (spec) => spec.color !== "yellow" || world.width >= YELLOW_RUNWAY_MIN_WIDTH,
  ).map((spec) => {
    const center = { x: world.width * spec.fx, y: world.height * spec.fy };
    const dir = headingVector(spec.heading);
    // The threshold sits near the runway end the plane arrives at, i.e.
    // *behind* the centre relative to the landing heading.
    const back = RUNWAY_LENGTH / 2 - RUNWAY_THRESHOLD_INSET;
    const airfield = layoutAirfield(spec.color, center, spec.heading, spec.apronSide, nextStandId);
    nextStandId += airfield.stands.length;
    return {
      color: spec.color,
      center,
      heading: spec.heading,
      length: RUNWAY_LENGTH,
      width: RUNWAY_WIDTH,
      threshold: { x: center.x - dir.x * back, y: center.y - dir.y * back },
      airfield,
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
