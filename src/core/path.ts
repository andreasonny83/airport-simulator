/**
 * Player-drawn flight paths.
 */
import { PATH_MIN_SPACING } from "../config";
import { distance } from "./math";
import type { Plane, Vec2 } from "./types";

/** Begin drawing a new path for `plane`, discarding the old one. */
export function startPath(plane: Plane): void {
  plane.path = [];
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
  const last = plane.path[plane.path.length - 1] ?? plane.pos;
  if (distance(last, point) < minSpacing) return false;
  plane.path.push({ x: point.x, y: point.y });
  plane.pathVersion++;
  return true;
}
