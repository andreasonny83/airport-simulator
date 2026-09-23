import { describe, expect, it } from "vitest";
import { checkLanding } from "./landing";
import { createPlane } from "./plane";
import type { Runway } from "./types";

const runway: Runway = {
  color: "red",
  center: { x: 50, y: 50 },
  heading: 0, // land travelling +x
  length: 16,
  width: 5,
  threshold: { x: 43.5, y: 50 },
};

describe("checkLanding", () => {
  it("lands a matching plane crossing the threshold in the landing direction", () => {
    const plane = createPlane(1, "red", { x: 43, y: 50.5 }, 0.3);
    plane.path = [{ x: 60, y: 50 }];
    expect(checkLanding(plane, [runway])).toBe(runway);
    expect(plane.phase).toBe("landing");
    expect(plane.heading).toBe(runway.heading); // snapped
    expect(plane.path).toEqual([]);
  });

  it("rejects a plane approaching from the wrong direction", () => {
    const plane = createPlane(1, "red", { x: 44, y: 50 }, Math.PI);
    expect(checkLanding(plane, [runway])).toBeNull();
    expect(plane.phase).toBe("flying");
  });

  it("rejects a plane crossing at a steep angle (> tolerance)", () => {
    const plane = createPlane(1, "red", { x: 43.5, y: 50 }, Math.PI / 2);
    expect(checkLanding(plane, [runway])).toBeNull();
  });

  it("rejects a plane of a different colour", () => {
    const plane = createPlane(1, "blue", { x: 43.5, y: 50 }, 0);
    expect(checkLanding(plane, [runway])).toBeNull();
  });

  it("rejects a plane that is not over the threshold", () => {
    const plane = createPlane(1, "red", { x: 30, y: 50 }, 0);
    expect(checkLanding(plane, [runway])).toBeNull();
  });

  it("accepts headings across the ±PI seam", () => {
    const west: Runway = { ...runway, heading: Math.PI, threshold: { x: 56.5, y: 50 } };
    const plane = createPlane(1, "red", { x: 56.5, y: 50 }, -Math.PI + 0.2);
    expect(checkLanding(plane, [west])).toBe(west);
  });
});
