import { describe, expect, it } from "vitest";
import { appendPathPoint, startPath } from "./path";
import { createPlane } from "./plane";

describe("path drawing", () => {
  it("startPath clears the existing path and bumps the version", () => {
    const plane = createPlane(1, "red", { x: 0, y: 0 }, 0);
    plane.path = [{ x: 5, y: 5 }];
    const v = plane.pathVersion;
    startPath(plane);
    expect(plane.path).toEqual([]);
    expect(plane.pathVersion).toBeGreaterThan(v);
  });

  it("ignores points closer than minSpacing to the last point", () => {
    const plane = createPlane(1, "red", { x: 0, y: 0 }, 0);
    startPath(plane);
    // First point is measured against the plane's position.
    expect(appendPathPoint(plane, { x: 0.5, y: 0 }, 1)).toBe(false);
    expect(appendPathPoint(plane, { x: 2, y: 0 }, 1)).toBe(true);
    expect(appendPathPoint(plane, { x: 2.5, y: 0 }, 1)).toBe(false);
    expect(appendPathPoint(plane, { x: 3.5, y: 0 }, 1)).toBe(true);
    expect(plane.path).toEqual([
      { x: 2, y: 0 },
      { x: 3.5, y: 0 },
    ]);
  });

  it("copies points so callers can reuse their vectors", () => {
    const plane = createPlane(1, "red", { x: 0, y: 0 }, 0);
    const p = { x: 5, y: 0 };
    appendPathPoint(plane, p, 1);
    p.x = 99;
    expect(plane.path[0]).toEqual({ x: 5, y: 0 });
  });
});
