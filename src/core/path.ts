/**
 * Player-drawn flight paths.
 */
import {
  ANCHOR_HEADING_MARGIN,
  ANCHOR_LANDING_MARGIN,
  ANCHOR_RADIUS,
  FLIGHT_SUBSTEP,
  LANDING_ANGLE_TOLERANCE,
  LANDING_RADIUS,
  PATH_MIN_SPACING,
  PLANE_SPEED,
} from "../config";
import { airspaceBounds, isInAirspace } from "./layout";
import { angleDelta, distance } from "./math";
import { updatePlane } from "./plane";
import type { Plane, Runway, Vec2, WorldSize } from "./types";

/** Begin drawing a new path for `plane`, discarding the old one. */
export function startPath(plane: Plane): void {
  plane.path = [];
  plane.pathAnchored = false;
  plane.pathVersion++;
}

/**
 * Append `point` to the plane's path if it is at least `minSpacing` away from
 * the previous point (or from the plane itself, for the first point).
 * Dropping near-duplicate points keeps the path array — and the rendered
 * line — small while the pointer jitters.
 *
 * @returns true if the point was added.
 */
export function appendPathPoint(
  plane: Plane,
  point: Vec2,
  minSpacing: number = PATH_MIN_SPACING,
): boolean {
  // An anchored path is finished: extra wiggles past the runway are ignored.
  if (plane.pathAnchored) return false;
  const last = plane.path[plane.path.length - 1] ?? plane.pos;
  if (distance(last, point) < minSpacing) return false;
  plane.path.push({ x: point.x, y: point.y });
  plane.pathVersion++;
  return true;
}

/**
 * Keep drawn paths inside the airspace (see `airspaceBounds`). Paths can't
 * go past its edge: a plane
 * is sent off the world by drawing up to the border, and it then flies on
 * straight (see `departing` in core/plane.ts).
 *
 * Looks at the segment from the path's current end (or the plane itself)
 * to the pointer's `point`:
 * - `point` inside the airspace: returned unchanged;
 * - the segment leaves the airspace: the point where it crosses the border, so
 *   the line ends exactly on the edge. Further drags outside clip to that
 *   same point, which `appendPathPoint`'s spacing check then drops;
 * - both ends outside (e.g. a plane that has only just spawned): null.
 *
 * Once the pointer comes back inside, drawing carries on from the border.
 */
export function clampPathPoint(plane: Plane, point: Vec2, world: WorldSize): Vec2 | null {
  if (isInAirspace(point, world)) return { x: point.x, y: point.y };
  const from = plane.path[plane.path.length - 1] ?? plane.pos;
  if (!isInAirspace(from, world)) return null;

  // Walk from `from` towards `point` and stop at the first border hit: the
  // smallest fraction t at which x or y reaches its limit.
  const b = airspaceBounds(world);
  const dx = point.x - from.x;
  const dy = point.y - from.y;
  let t = 1;
  if (dx > 0) t = Math.min(t, (b.maxX - from.x) / dx);
  if (dx < 0) t = Math.min(t, (b.minX - from.x) / dx);
  if (dy > 0) t = Math.min(t, (b.maxY - from.y) / dy);
  if (dy < 0) t = Math.min(t, (b.minY - from.y) / dy);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

/**
 * Snap the end of the plane's path onto its runway threshold, if the path
 * has just reached the anchor area from the landing direction.
 *
 * Call after each new path point. On success the path's tail inside the
 * anchor area is replaced by one point exactly on the threshold, so the
 * plane flies a straight final approach and `checkLanding` is guaranteed to
 * fire as it arrives. `plane.pathAnchored` is set, which locks the path.
 *
 * The approach is judged twice: first on the final leg (last point outside
 * the area → threshold), a cheap check that rejects paths reaching the
 * threshold from the wrong end or side-on; then by a dry-run flight (see
 * `landsOnSnappedPath`), since the plane's limited turn rate can make it
 * miss a leg that looks fine on paper. Either way a rejected path simply
 * doesn't anchor: the player can keep dragging and come round again.
 *
 * @returns the runway anchored to, or null.
 */
export function anchorPath(
  plane: Plane,
  runways: readonly Runway[],
  world: WorldSize,
): Runway | null {
  if (plane.pathAnchored || plane.path.length === 0) return null;
  const runway = runways.find((r) => r.color === plane.color);
  if (!runway) return null;

  const end = plane.path[plane.path.length - 1]!;
  if (distance(end, runway.threshold) > ANCHOR_RADIUS) return null;

  // Last point of the approach that is still outside the anchor area (or
  // the plane itself if the whole path is inside it).
  let keep = plane.path.length;
  while (keep > 0 && distance(plane.path[keep - 1]!, runway.threshold) <= ANCHOR_RADIUS) keep--;
  const from = keep > 0 ? plane.path[keep - 1]! : plane.pos;

  const approach = Math.atan2(runway.threshold.y - from.y, runway.threshold.x - from.x);
  if (Math.abs(angleDelta(approach, runway.heading)) > LANDING_ANGLE_TOLERANCE) return null;

  const snapped = [...plane.path.slice(0, keep), { ...runway.threshold }];
  // A good-looking final leg can still be unflyable, e.g. a sharp corner at
  // the edge of the anchor area: the plane can't turn that tightly, cuts
  // the corner and arrives off-heading or wide. Only anchor (and show the
  // green ring) if the plane really lands.
  if (!landsOnSnappedPath(plane, snapped, runway, world)) return null;

  plane.path = snapped;
  plane.pathAnchored = true;
  plane.pathVersion++;
  return runway;
}

/**
 * Dry run: fly a copy of `plane` along `path` and report whether it lands
 * on `runway`.
 *
 * This is a faithful preview of the real flight: the sim is deterministic,
 * flight is integrated in small sub-steps whatever the frame rate, and an
 * anchored path is locked, so nothing else changes the plane's route on the
 * way. (Traffic can still force a go-around or a crash; that isn't judged
 * here.)
 */
function landsOnSnappedPath(
  plane: Plane,
  path: readonly Vec2[],
  runway: Runway,
  world: WorldSize,
): boolean {
  const ghost: Plane = {
    ...plane,
    pos: { ...plane.pos },
    path: path.map((p) => ({ ...p })),
    pathAnchored: true,
    ground: null,
  };

  // Time budget: the whole path at cruise speed, doubled for turns.
  let length = 0;
  let prev = plane.pos;
  for (const p of path) {
    length += distance(prev, p);
    prev = p;
  }
  const maxSteps = Math.ceil(((2 * length) / PLANE_SPEED + 1) / FLIGHT_SUBSTEP);

  for (let i = 0; i < maxSteps; i++) {
    updatePlane(ghost, FLIGHT_SUBSTEP, world);
    // Same test as `checkLanding`, with a safety margin: the real flight can
    // differ slightly (landing is checked once per frame, and sub-steps
    // shrink on fast displays), so a borderline pass isn't a promise.
    const over = distance(ghost.pos, runway.threshold) <= LANDING_RADIUS - ANCHOR_LANDING_MARGIN;
    const aligned =
      Math.abs(angleDelta(ghost.heading, runway.heading)) <=
      LANDING_ANGLE_TOLERANCE - ANCHOR_HEADING_MARGIN;
    if (over && aligned) return true;
    // Threshold dropped (reached off-heading, or skipped as unreachable) and
    // the plane has flown clear of it: it would not land.
    if (!ghost.pathAnchored && distance(ghost.pos, runway.threshold) > LANDING_RADIUS) {
      return false;
    }
  }
  return false;
}
