/**
 * Small, dependency-free math helpers for the 2D simulation.
 */
import type { Vec2 } from "./types";

const TWO_PI = Math.PI * 2;

/** Euclidean distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Wrap any angle into the half-open range (-PI, PI].
 *
 * JavaScript's `%` keeps the sign of the dividend (`-1 % 3 === -1`), so we
 * shift into a positive range first to get a true mathematical modulo.
 */
export function normalizeAngle(angle: number): number {
  const wrapped = (((angle + Math.PI) % TWO_PI) + TWO_PI) % TWO_PI; // [0, 2PI)
  // `wrapped === 0` means the input was exactly -PI (mod 2PI): report +PI.
  return wrapped === 0 ? Math.PI : wrapped - Math.PI;
}

/**
 * Signed shortest rotation (radians) that turns heading `from` into `to`.
 * Result is in (-PI, PI]; positive means "turn towards +angle".
 */
export function angleDelta(from: number, to: number): number {
  return normalizeAngle(to - from);
}

/** Unit vector pointing along `heading`. */
export function headingVector(heading: number): Vec2 {
  return { x: Math.cos(heading), y: Math.sin(heading) };
}

/** Linear interpolation between `a` and `b` by `t` (0 → a, 1 → b). */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
