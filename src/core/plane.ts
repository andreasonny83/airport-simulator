/**
 * Plane creation and per-frame movement.
 *
 * All motion is expressed in units/second and scaled by `dt`. Flight is
 * integrated in fixed sub-steps (`FLIGHT_SUBSTEP`), so one long frame and
 * many short ones trace the same curve.
 */
import {
  FLIGHT_SUBSTEP,
  LANDING_ROLL_DISTANCE,
  LANDING_SPEED_END,
  LANDING_SPEED_START,
  MAX_TURN_RATE,
  PLANE_RADIUS,
  PLANE_SPEED,
  TURN_LAG,
  TURN_RESPONSE,
  WAYPOINT_CAPTURE_RADIUS,
} from "../config";
import { angleDelta, distance, lerp, normalizeAngle } from "./math";
import type { Plane, RunwayColor, Vec2, WorldSize } from "./types";

export function createPlane(id: number, color: RunwayColor, pos: Vec2, heading: number): Plane {
  return {
    id,
    color,
    pos: { ...pos },
    heading: normalizeAngle(heading),
    turnRate: 0,
    path: [],
    pathVersion: 0,
    phase: "flying",
    landingProgress: 0,
    warning: false,
    pathAnchored: false,
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
      updateFlying(plane, dt, world);
      return;
  }
}

/** Move `dist` units straight along the current heading. */
function moveForward(plane: Plane, dist: number): void {
  plane.pos.x += Math.cos(plane.heading) * dist;
  plane.pos.y += Math.sin(plane.heading) * dist;
}

/**
 * Fly for `dt` seconds. The plane always moves forward at cruise speed and
 * can only change heading gradually (see `steer`), so it follows its path
 * like a real aircraft: smooth arcs, never an instant turn-around.
 *
 * Steering is a feedback loop, and feedback loops react differently to big
 * and small time steps. So the frame is split into fixed-size sub-steps,
 * which keeps flight paths the same whatever the display refresh rate.
 */
function updateFlying(plane: Plane, dt: number, world: WorldSize): void {
  const steps = Math.max(1, Math.ceil(dt / FLIGHT_SUBSTEP));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const desired = desiredHeading(plane, world);
    steer(plane, desired ?? plane.heading, h);
    moveForward(plane, PLANE_SPEED * h);
  }
}

/**
 * The heading the plane wants to fly right now, or null for "carry on
 * straight".
 *
 * - With a path: aim at the next waypoint that is still worth chasing.
 * - Without one: if the plane has drifted off the field, head back towards
 *   the middle. This replaces the old instant mirror at the edge with a
 *   smooth U-turn.
 */
function desiredHeading(plane: Plane, world: WorldSize): number | null {
  const target = nextWaypoint(plane);
  if (target) return Math.atan2(target.y - plane.pos.y, target.x - plane.pos.x);

  const m = PLANE_RADIUS;
  const { x, y } = plane.pos;
  if (x < -m || x > world.width + m || y < -m || y > world.height + m) {
    return Math.atan2(world.height / 2 - y, world.width / 2 - x);
  }
  return null;
}

/**
 * Drop waypoints the plane has dealt with, and return the one to aim at now
 * (or undefined once the path is used up).
 *
 * A waypoint is dropped when it is:
 * - reached: within `WAYPOINT_CAPTURE_RADIUS`;
 * - passed: the plane is already beyond it along the path, e.g. it cut a
 *   corner it was too fast to take exactly;
 * - unreachable: it lies inside the plane's tightest turning circle, so no
 *   amount of turning can reach it without a full loop. If we kept chasing
 *   it, the plane would circle it forever.
 */
function nextWaypoint(plane: Plane): Vec2 | undefined {
  while (plane.path.length > 0) {
    const wp = plane.path[0]!;
    const next = plane.path[1];
    const reached = distance(plane.pos, wp) <= WAYPOINT_CAPTURE_RADIUS;
    const passed =
      next !== undefined &&
      (plane.pos.x - wp.x) * (next.x - wp.x) + (plane.pos.y - wp.y) * (next.y - wp.y) > 0;
    if (!reached && !passed && !insideTurnCircle(plane, wp)) return wp;

    plane.path.shift();
    plane.pathVersion++;
  }
  // Path used up: the anchor (if any) went with it.
  plane.pathAnchored = false;
  return undefined;
}

/**
 * True if `p` lies inside the circle the plane would fly if it turned
 * towards `p` as hard as it can. Points in there can't be reached directly.
 */
function insideTurnCircle(plane: Plane, p: Vec2): boolean {
  const radius = PLANE_SPEED / MAX_TURN_RATE;
  const fx = Math.cos(plane.heading);
  const fy = Math.sin(plane.heading);
  // Which side is `p` on? The sign of the 2D cross product (forward × to-p).
  const side = fx * (p.y - plane.pos.y) - fy * (p.x - plane.pos.x) >= 0 ? 1 : -1;
  // Centre of the turning circle: one radius out to that side.
  const cx = plane.pos.x - fy * side * radius;
  const cy = plane.pos.y + fx * side * radius;
  return Math.hypot(p.x - cx, p.y - cy) < radius;
}

/**
 * Turn the plane gradually towards `desired` over `dt` seconds.
 *
 * 1. The heading error, taken the short way round, sets a commanded turn
 *    rate. It is proportional to the error (a gentle easing onto the target)
 *    and capped at `MAX_TURN_RATE` (no hairpin snaps).
 * 2. The actual turn rate eases towards that command with time constant
 *    `TURN_LAG`, like a plane rolling into a bank. The exponential form
 *    `1 - exp(-dt / lag)` makes the easing frame-rate independent.
 * 3. Heading advances by the turn rate. Because it is always integrated from
 *    a finite rate, it can never jump.
 */
function steer(plane: Plane, desired: number, dt: number): void {
  const error = angleDelta(plane.heading, desired);
  const command = clamp(error * TURN_RESPONSE, -MAX_TURN_RATE, MAX_TURN_RATE);
  plane.turnRate += (command - plane.turnRate) * (1 - Math.exp(-dt / TURN_LAG));
  plane.heading = normalizeAngle(plane.heading + plane.turnRate * dt);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
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
