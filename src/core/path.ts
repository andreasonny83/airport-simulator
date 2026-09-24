/**
 * Player-drawn flight paths.
 */
import { ANCHOR_RADIUS, LANDING_ANGLE_TOLERANCE, PATH_MIN_SPACING } from "../config";
import { angleDelta, distance } from "./math";
import type { Plane, Runway, Vec2 } from "./types";

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
 * Snap the end of the plane's path onto its runway threshold, if the path
 * has just reached the anchor area from the landing direction.
 *
 * Call after each new path point. On success the path's tail inside the
 * anchor area is replaced by one point exactly on the threshold, so the
 * plane flies a straight final approach and `checkLanding` is guaranteed to
 * fire as it arrives. `plane.pathAnchored` is set, which locks the path.
 *
 * The approach is judged on the final leg (last point outside the area →
 * threshold), the same heading the plane will have when it gets there. A
 * path reaching the threshold from the wrong end or side-on doesn't anchor;
 * the player can keep dragging and come round again.
 *
 * @returns the runway anchored to, or null.
 */
export function anchorPath(plane: Plane, runways: readonly Runway[]): Runway | null {
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

  plane.path.length = keep;
  plane.path.push({ ...runway.threshold });
  plane.pathAnchored = true;
  plane.pathVersion++;
  return runway;
}
