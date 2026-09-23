/**
 * Plane creation and per-frame movement.
 *
 * All motion is expressed in units/second and scaled by `dt`, so the result
 * of one 1-second step matches sixty 1/60-second steps (see plane.test.ts).
 */
import {
  LANDING_ROLL_DISTANCE,
  LANDING_SPEED_END,
  LANDING_SPEED_START,
  PLANE_RADIUS,
  PLANE_SPEED,
} from "../config";
import { lerp, normalizeAngle } from "./math";
import type { Plane, RunwayColor, Vec2, WorldSize } from "./types";

export function createPlane(id: number, color: RunwayColor, pos: Vec2, heading: number): Plane {
  return {
    id,
    color,
    pos: { ...pos },
    heading: normalizeAngle(heading),
    path: [],
    pathVersion: 0,
    phase: "flying",
    landingProgress: 0,
    warning: false,
  };
}

/** Advance one plane by `dt` seconds. */
export function updatePlane(plane: Plane, dt: number, world: WorldSize): void {
  switch (plane.phase) {
    case "landed":
      return;
    case "landing":
      updateLanding(plane, dt);
      return;
    case "flying":
      updateFlying(plane, dt);
      turnBackAtBounds(plane, world);
      return;
  }
}

/** Move `dist` units straight along the current heading. */
function moveForward(plane: Plane, dist: number): void {
  plane.pos.x += Math.cos(plane.heading) * dist;
  plane.pos.y += Math.sin(plane.heading) * dist;
}

function updateFlying(plane: Plane, dt: number): void {
  let remaining = PLANE_SPEED * dt;

  // Follow the drawn path. Leftover distance after reaching a waypoint is
  // carried on to the next one, so a big dt doesn't "lose" movement at
  // corners — this is what keeps path following frame-rate independent.
  while (remaining > 0 && plane.path.length > 0) {
    const target = plane.path[0]!;
    const dx = target.x - plane.pos.x;
    const dy = target.y - plane.pos.y;
    const dist = Math.hypot(dx, dy);

    // Keep the old heading if we're sitting exactly on the waypoint.
    if (dist > 0) plane.heading = Math.atan2(dy, dx);

    if (dist <= remaining) {
      plane.pos.x = target.x;
      plane.pos.y = target.y;
      plane.path.shift();
      plane.pathVersion++;
      remaining -= dist;
    } else {
      moveForward(plane, remaining);
      remaining = 0;
    }
  }

  // No (more) path: keep cruising straight.
  if (remaining > 0) moveForward(plane, remaining);
}

/**
 * Stop planes wandering off forever: once a plane is fully outside the field
 * AND still heading outward, reflect its heading back in.
 *
 * Checking the heading (not just position) fixes the prototype's edge jitter,
 * where a plane still outside after reflecting would flip straight back out.
 */
function turnBackAtBounds(plane: Plane, world: WorldSize): void {
  const m = PLANE_RADIUS;
  const { x, y } = plane.pos;
  const cos = Math.cos(plane.heading);
  const sin = Math.sin(plane.heading);

  if ((x < -m && cos < 0) || (x > world.width + m && cos > 0)) {
    plane.heading = Math.PI - plane.heading; // mirror across the vertical axis
  }
  if ((y < -m && sin < 0) || (y > world.height + m && sin > 0)) {
    plane.heading = -plane.heading; // mirror across the horizontal axis
  }
  plane.heading = normalizeAngle(plane.heading);
}

/** Roll along the runway, decelerating, until `LANDING_ROLL_DISTANCE` is covered. */
function updateLanding(plane: Plane, dt: number): void {
  const speed = PLANE_SPEED * lerp(LANDING_SPEED_START, LANDING_SPEED_END, plane.landingProgress);
  const rolledSoFar = plane.landingProgress * LANDING_ROLL_DISTANCE;
  // Never roll past the end: keeps the final resting spot dt-independent.
  const dist = Math.min(speed * dt, LANDING_ROLL_DISTANCE - rolledSoFar);

  moveForward(plane, dist);
  plane.landingProgress = Math.min(1, (rolledSoFar + dist) / LANDING_ROLL_DISTANCE);
  if (plane.landingProgress >= 1) plane.phase = "landed";
}
