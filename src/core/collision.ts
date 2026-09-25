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
 * Pairwise check of all *flying* planes. Planes on the ground (landing,
 * taxiing, stowing) are ignored: aircraft overhead never collide with
 * them or warn about them, and they keep their own spacing (core/ground.ts).
 * Departing planes are ignored too, and so are inbound ones (still flying in
 * from off-screen, where the player can't see or steer them). O(n²), which
 * is fine for the handful of planes on screen.
 */
export function detectCollisions(planes: readonly Plane[]): CollisionResult {
  const flying = planes.filter((p) => p.phase === "flying" && !p.inbound);
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
