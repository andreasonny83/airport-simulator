import { describe, expect, it } from "vitest";
import { RUNWAY_LAYOUT, WORLD_ASPECT, WORLD_HEIGHT } from "../config";
import { computeWorldSize, layoutRunways, runwayDesignator } from "./layout";
import { distance } from "./math";

describe("layout", () => {
  it("is a fixed size, whatever the window", () => {
    expect(computeWorldSize()).toEqual({
      width: WORLD_HEIGHT * WORLD_ASPECT,
      height: WORLD_HEIGHT,
    });
  });

  it("places runways relative to world size", () => {
    const world = computeWorldSize();
    const [red] = layoutRunways(world);
    const spec = RUNWAY_LAYOUT[0]!;
    expect(red!.center.x).toBeCloseTo(world.width * spec.fx);
    expect(red!.center.y).toBeCloseTo(world.height * spec.fy);
  });

  it("drops the yellow runway on narrow (portrait) screens", () => {
    expect(layoutRunways({ width: 56.25, height: WORLD_HEIGHT }).map((r) => r.color)).toEqual([
      "red",
      "blue",
    ]);
    expect(layoutRunways(computeWorldSize()).map((r) => r.color)).toContain("yellow");
  });

  it("puts the threshold behind the centre, opposite the landing heading", () => {
    const world = computeWorldSize();
    for (const r of layoutRunways(world)) {
      const toCenter = { x: r.center.x - r.threshold.x, y: r.center.y - r.threshold.y };
      // Vector threshold → centre points along the landing heading.
      const dot = toCenter.x * Math.cos(r.heading) + toCenter.y * Math.sin(r.heading);
      expect(dot).toBeCloseTo(distance(r.center, r.threshold));
    }
  });

  it("numbers runways by compass bearing of the landing direction", () => {
    expect(runwayDesignator(0)).toBe("09"); // east
    expect(runwayDesignator(Math.PI / 2)).toBe("18"); // +y = down the screen = south
    expect(runwayDesignator(Math.PI)).toBe("27"); // west
    expect(runwayDesignator(-Math.PI / 2)).toBe("36"); // north is 36, not 00
    expect(runwayDesignator(-Math.PI / 4)).toBe("05"); // NE, 045°
    expect(runwayDesignator((-3 * Math.PI) / 4)).toBe("32"); // NW, 315°
  });
});
