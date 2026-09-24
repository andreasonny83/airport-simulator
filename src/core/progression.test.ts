import { describe, expect, it } from "vitest";
import { MAX_AIRBORNE } from "../config";
import { createPlane } from "./plane";
import { flyingCount, maxAirborne, newlyUnlockedColors, unlockedColors } from "./progression";
import { createGameState } from "./state";

describe("maxAirborne", () => {
  it("starts with a single plane", () => {
    expect(maxAirborne(0, 0)).toBe(1);
  });

  it("grows with landings", () => {
    expect(maxAirborne(20, 0)).toBeGreaterThan(maxAirborne(0, 0));
  });

  it("never shrinks as score or time grow", () => {
    for (let score = 0; score < 40; score++) {
      for (let t = 0; t < 600; t += 15) {
        expect(maxAirborne(score + 1, t)).toBeGreaterThanOrEqual(maxAirborne(score, t));
        expect(maxAirborne(score, t + 15)).toBeGreaterThanOrEqual(maxAirborne(score, t));
      }
    }
  });

  it("is clamped to MAX_AIRBORNE", () => {
    expect(maxAirborne(1000, 100000)).toBe(MAX_AIRBORNE);
  });
});

describe("unlockedColors", () => {
  const landscape = createGameState(16 / 9).runways;

  it("starts with red only", () => {
    expect(unlockedColors(0, landscape)).toEqual(["red"]);
  });

  it("opens colours in layout order as the score rises", () => {
    expect(unlockedColors(3, landscape)).toEqual(["red", "blue"]);
    expect(unlockedColors(7, landscape)).toEqual(["red", "blue", "yellow"]);
  });

  it("skips colours with no runway on the field", () => {
    const noYellow = landscape.filter((r) => r.color !== "yellow");
    expect(unlockedColors(100, noYellow)).toEqual(["red", "blue"]);
  });

  it("always offers the first existing runway", () => {
    const blueOnly = landscape.filter((r) => r.color === "blue");
    expect(unlockedColors(0, blueOnly)).toEqual(["blue"]);
  });

  it("reports only colours crossed by a score change", () => {
    expect(newlyUnlockedColors(2, 3, landscape)).toEqual(["blue"]);
    expect(newlyUnlockedColors(3, 4, landscape)).toEqual([]);
  });
});

describe("flyingCount", () => {
  it("ignores planes that are rolling out", () => {
    const a = createPlane(1, "red", { x: 0, y: 0 }, 0);
    const b = createPlane(2, "red", { x: 0, y: 0 }, 0);
    b.phase = "landing";
    expect(flyingCount([a, b])).toBe(1);
  });
});
