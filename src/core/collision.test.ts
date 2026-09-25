import { describe, expect, it } from "vitest";
import { COLLISION_DISTANCE, WARNING_DISTANCE } from "../config";
import { detectCollisions } from "./collision";
import { computeWorldSize } from "./layout";
import { createPlane } from "./plane";

describe("detectCollisions", () => {
  const world = computeWorldSize();

  it("reports a crash when two flying planes overlap", () => {
    const a = createPlane(1, "red", { x: 0, y: 0 }, 0);
    const b = createPlane(2, "blue", { x: COLLISION_DISTANCE * 0.9, y: 0 }, 0);
    const result = detectCollisions([a, b], world);
    expect(result.crash).toEqual([a, b]);
  });

  it("flags a proximity warning without crashing", () => {
    const a = createPlane(1, "red", { x: 0, y: 0 }, 0);
    const b = createPlane(2, "blue", { x: (COLLISION_DISTANCE + WARNING_DISTANCE) / 2, y: 0 }, 0);
    const c = createPlane(3, "blue", { x: 100, y: 100 }, 0);
    const result = detectCollisions([a, b, c], world);
    expect(result.crash).toBeNull();
    expect([...result.warnings].sort()).toEqual([1, 2]);
  });

  it("ignores planes that are landing", () => {
    const a = createPlane(1, "red", { x: 0, y: 0 }, 0);
    const b = createPlane(2, "blue", { x: 0.1, y: 0 }, 0);
    b.phase = "landing";
    const result = detectCollisions([a, b], world);
    expect(result.crash).toBeNull();
    expect(result.warnings.size).toBe(0);
  });
});
