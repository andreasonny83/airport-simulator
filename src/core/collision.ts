/**
 * Mid-air collision and proximity detection.
 */
import { COLLISION_DISTANCE, WARNING_DISTANCE } from "../config";
import { distance } from "./math";
import type { Plane } from "./types";

export interface CollisionResult {
  /** First pair of planes found overlapping, or null. */
  crash: [Plane, Plane] | null;
  /** Ids of flying planes that are uncomfortably close to another. */
  warnings: Set<number>;
}

/**
 * Pairwise check of all *flying* planes (landing planes are on the ground and
 * can't collide). O(n²), which is fine for the handful of planes on screen.
 */
export function detectCollisions(planes: readonly Plane[]): CollisionResult {
  const flying = planes.filter((p) => p.phase === "flying");
  const warnings = new Set<number>();
  let crash: [Plane, Plane] | null = null;

  for (let i = 0; i < flying.length; i++) {
    const a = flying[i]!;
    for (let j = i + 1; j < flying.length; j++) {
      const b = flying[j]!;
      const d = distance(a.pos, b.pos);
      if (d < COLLISION_DISTANCE) {
        crash ??= [a, b];
      } else if (d < WARNING_DISTANCE) {
        warnings.add(a.id);
        warnings.add(b.id);
      }
    }
  }
  return { crash, warnings };
}
