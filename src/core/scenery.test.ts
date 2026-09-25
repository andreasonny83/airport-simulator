import { describe, expect, it } from "vitest";
import { STREAM_WIDTH, TREE_RUNWAY_CLEARANCE, TREE_STREAM_CLEARANCE } from "../config";
import { layoutRunways } from "./layout";
import { mulberry32 } from "./math";
import {
  buildScenery,
  distanceToPolyline,
  distanceToRunway,
  mapBounds,
  valueNoise,
} from "./scenery";
import type { OrientedRect } from "./types";

const ASPECTS = [0.5, 1, 1.78, 2.4];

describe("mulberry32", () => {
  it("is deterministic for a seed and stays in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("valueNoise", () => {
  it("is deterministic and in [0, 1)", () => {
    for (let i = 0; i < 50; i++) {
      const v = valueNoise(i * 0.37, i * 0.91);
      expect(v).toBe(valueNoise(i * 0.37, i * 0.91));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("distanceToRunway", () => {
  const runway: OrientedRect = {
    center: { x: 0, y: 0 },
    heading: Math.PI / 2, // long axis along y
    length: 10,
    width: 4,
  };

  it("is zero inside and measures from the rotated edges outside", () => {
    expect(distanceToRunway({ x: 1, y: 4 }, runway)).toBe(0);
    expect(distanceToRunway({ x: 5, y: 0 }, runway)).toBeCloseTo(3); // past the half-width
    expect(distanceToRunway({ x: 0, y: 8 }, runway)).toBeCloseTo(3); // past the half-length
    expect(distanceToRunway({ x: 5, y: 9 }, runway)).toBeCloseTo(5); // corner: 3-4-5
  });
});

describe("distanceToPolyline", () => {
  it("finds the nearest segment", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(distanceToPolyline({ x: 5, y: 2 }, line)).toBeCloseTo(2);
    expect(distanceToPolyline({ x: 13, y: 5 }, line)).toBeCloseTo(3);
    expect(distanceToPolyline({ x: -3, y: -4 }, line)).toBeCloseTo(5);
  });
});

describe("buildScenery", () => {
  it("is the same on every call", () => {
    const world = { width: 178, height: 100 };
    const runways = layoutRunways(world);
    expect(buildScenery(world, runways)).toEqual(buildScenery(world, runways));
  });

  for (const aspect of ASPECTS) {
    describe(`at aspect ${aspect}`, () => {
      const world = { width: 100 * aspect, height: 100 };
      const runways = layoutRunways(world);
      const scenery = buildScenery(world, runways);

      it("covers the playfield with a larger map", () => {
        const b = mapBounds(world);
        expect(b.minX).toBeLessThan(0);
        expect(b.minY).toBeLessThan(0);
        expect(b.maxX).toBeGreaterThan(world.width);
        expect(b.maxY).toBeGreaterThan(world.height);
        expect(scenery.trees.length).toBeGreaterThan(0);
      });

      it("mixes both tree species", () => {
        const kinds = new Set(scenery.trees.map((t) => t.kind));
        expect(kinds).toEqual(new Set(["conifer", "broadleaf"]));
      });

      it("keeps every tree inside the map bounds", () => {
        const b = scenery.bounds;
        for (const t of scenery.trees) {
          expect(t.pos.x).toBeGreaterThanOrEqual(b.minX);
          expect(t.pos.x).toBeLessThanOrEqual(b.maxX);
          expect(t.pos.y).toBeGreaterThanOrEqual(b.minY);
          expect(t.pos.y).toBeLessThanOrEqual(b.maxY);
        }
      });

      it("keeps trees clear of runways and the stream", () => {
        for (const t of scenery.trees) {
          for (const r of runways) {
            expect(distanceToRunway(t.pos, r)).toBeGreaterThanOrEqual(TREE_RUNWAY_CLEARANCE);
          }
          expect(distanceToPolyline(t.pos, scenery.stream)).toBeGreaterThanOrEqual(
            STREAM_WIDTH / 2 + TREE_STREAM_CLEARANCE,
          );
        }
      });

      it("never lets the stream touch a runway", () => {
        for (const r of runways) {
          // No centreline sample may come within half the water width of a runway.
          for (const p of scenery.stream) {
            expect(distanceToRunway(p, r)).toBeGreaterThan(STREAM_WIDTH / 2);
          }
        }
      });

      it("spans the full map width", () => {
        expect(scenery.stream[0]!.x).toBeLessThanOrEqual(scenery.bounds.minX);
        expect(scenery.stream[scenery.stream.length - 1]!.x).toBeGreaterThanOrEqual(
          scenery.bounds.maxX,
        );
      });
    });
  }
});
