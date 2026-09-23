import { describe, expect, it } from "vitest";
import { angleDelta, distance, normalizeAngle } from "./math";

describe("distance", () => {
  it("is the euclidean distance", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe("normalizeAngle", () => {
  it("wraps into (-PI, PI]", () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-3 * Math.PI)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo(-Math.PI / 2);
    expect(normalizeAngle(2 * Math.PI + 0.25)).toBeCloseTo(0.25);
  });
});

describe("angleDelta", () => {
  it("returns the signed shortest rotation from a to b", () => {
    expect(angleDelta(0, Math.PI / 2)).toBeCloseTo(Math.PI / 2);
    expect(angleDelta(Math.PI / 2, 0)).toBeCloseTo(-Math.PI / 2);
  });

  it("goes the short way across the ±PI seam", () => {
    // 170° → -170° is a 20° turn, not 340°.
    const a = (170 * Math.PI) / 180;
    const b = (-170 * Math.PI) / 180;
    expect(angleDelta(a, b)).toBeCloseTo((20 * Math.PI) / 180);
  });

  it("handles un-normalised inputs (several turns, negative angles)", () => {
    expect(Math.abs(angleDelta((-7 * Math.PI) / 4, Math.PI / 4))).toBeCloseTo(0);
    expect(angleDelta(-Math.PI / 4, (5 * Math.PI) / 4)).toBeCloseTo(-Math.PI / 2);
    expect(angleDelta(0, 6 * Math.PI + 0.1)).toBeCloseTo(0.1);
  });
});
