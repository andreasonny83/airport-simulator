import { describe, expect, it } from "vitest";
import { WORLD_HEIGHT } from "../config";
import { computeWorldSize, layoutRunways } from "./layout";
import { distance } from "./math";

describe("layout", () => {
  it("keeps height fixed and scales width with aspect", () => {
    expect(computeWorldSize(2)).toEqual({ width: WORLD_HEIGHT * 2, height: WORLD_HEIGHT });
  });

  it("places runways relative to world size", () => {
    const world = computeWorldSize(16 / 9);
    const [red] = layoutRunways(world);
    expect(red!.center.x).toBeCloseTo(world.width * 0.25);
    expect(red!.center.y).toBeCloseTo(world.height * 0.7);
  });

  it("drops the yellow runway on narrow (portrait) screens", () => {
    expect(layoutRunways(computeWorldSize(9 / 16)).map((r) => r.color)).toEqual(["red", "blue"]);
    expect(layoutRunways(computeWorldSize(16 / 9)).map((r) => r.color)).toContain("yellow");
  });

  it("puts the threshold behind the centre, opposite the landing heading", () => {
    const world = computeWorldSize(16 / 9);
    for (const r of layoutRunways(world)) {
      const toCenter = { x: r.center.x - r.threshold.x, y: r.center.y - r.threshold.y };
      // Vector threshold → centre points along the landing heading.
      const dot = toCenter.x * Math.cos(r.heading) + toCenter.y * Math.sin(r.heading);
      expect(dot).toBeCloseTo(distance(r.center, r.threshold));
    }
  });
});
