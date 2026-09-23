import { describe, expect, it } from "vitest";
import { LANDING_ROLL_DISTANCE, PLANE_RADIUS, PLANE_SPEED } from "../config";
import { createPlane, updatePlane } from "./plane";
import type { Plane, WorldSize } from "./types";

const world: WorldSize = { width: 200, height: 100 };

/** Run `updatePlane` `steps` times with a fixed dt. */
function simulate(plane: Plane, totalSeconds: number, steps: number): Plane {
  const dt = totalSeconds / steps;
  for (let i = 0; i < steps; i++) updatePlane(plane, dt, world);
  return plane;
}

describe("updatePlane", () => {
  it("flies straight along its heading at PLANE_SPEED", () => {
    const plane = createPlane(1, "red", { x: 10, y: 50 }, 0);
    updatePlane(plane, 1, world);
    expect(plane.pos.x).toBeCloseTo(10 + PLANE_SPEED);
    expect(plane.pos.y).toBeCloseTo(50);
  });

  it("is frame-rate independent when flying straight (1×1s ≈ 60×1/60s)", () => {
    const a = simulate(createPlane(1, "red", { x: 10, y: 10 }, 0.7), 1, 1);
    const b = simulate(createPlane(2, "red", { x: 10, y: 10 }, 0.7), 1, 60);
    expect(b.pos.x).toBeCloseTo(a.pos.x, 5);
    expect(b.pos.y).toBeCloseTo(a.pos.y, 5);
  });

  it("is frame-rate independent when following a path", () => {
    const path = [
      { x: 12, y: 50 },
      { x: 14, y: 52 },
      { x: 15, y: 55 },
      { x: 20, y: 55 },
    ];
    const a = createPlane(1, "red", { x: 10, y: 50 }, 0);
    const b = createPlane(2, "red", { x: 10, y: 50 }, 0);
    a.path = path.map((p) => ({ ...p }));
    b.path = path.map((p) => ({ ...p }));
    simulate(a, 1, 1);
    simulate(b, 1, 60);
    expect(b.pos.x).toBeCloseTo(a.pos.x, 5);
    expect(b.pos.y).toBeCloseTo(a.pos.y, 5);
    expect(b.path.length).toBe(a.path.length);
  });

  it("consumes reached waypoints and bumps pathVersion", () => {
    const plane = createPlane(1, "red", { x: 10, y: 50 }, 0);
    plane.path = [
      { x: 11, y: 50 },
      { x: 30, y: 50 },
    ];
    const v = plane.pathVersion;
    updatePlane(plane, 0.5, world); // moves 4 units: passes first waypoint
    expect(plane.path).toEqual([{ x: 30, y: 50 }]);
    expect(plane.pathVersion).toBeGreaterThan(v);
    expect(plane.pos.x).toBeCloseTo(10 + PLANE_SPEED * 0.5);
  });

  it("turns back towards the field when leaving the bounds", () => {
    const plane = createPlane(1, "red", { x: -PLANE_RADIUS - 0.1, y: 50 }, Math.PI);
    updatePlane(plane, 0.01, world);
    expect(Math.cos(plane.heading)).toBeGreaterThan(0);
  });

  it("does not flip back out when already heading inward (no edge jitter)", () => {
    // Spawned just outside the left edge, heading right: must keep heading right.
    const plane = createPlane(1, "red", { x: -PLANE_RADIUS - 0.5, y: 50 }, 0);
    updatePlane(plane, 0.01, world);
    updatePlane(plane, 0.01, world);
    expect(Math.cos(plane.heading)).toBeGreaterThan(0);
  });

  it("rolls out while landing and becomes landed after LANDING_ROLL_DISTANCE", () => {
    const plane = createPlane(1, "red", { x: 50, y: 50 }, 0);
    plane.phase = "landing";
    updatePlane(plane, 0.1, world);
    expect(plane.landingProgress).toBeGreaterThan(0);
    expect(plane.phase).toBe("landing");
    simulate(plane, 10, 600);
    expect(plane.phase).toBe("landed");
    expect(plane.landingProgress).toBe(1);
    expect(plane.pos.x - 50).toBeCloseTo(LANDING_ROLL_DISTANCE, 0);
  });
});
