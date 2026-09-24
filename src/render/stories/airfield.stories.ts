/**
 * Static world pieces at real game scale: a single runway with its taxiway
 * and hangars, the whole airfield layout, and the landscape around it.
 *
 * Tuning loop: runway markings/lights live in runway.ts, taxiways and
 * hangars in airfield.ts, the layout and sizes in config.ts (RUNWAY_*,
 * TAXIWAY_*, STAND_*, HANGAR_*, STREAM_*, TREE_*, MAP_SCALE), colours in
 * landscape.ts. Save and the story rebuilds.
 */
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Meta, StoryObj } from "@storybook/html-vite";
import { COLOR_HEX, RUNWAY_LENGTH, RUNWAY_THRESHOLD_INSET, RUNWAY_WIDTH } from "../../config";
import { layoutAirfield } from "../../core/airfield";
import { layoutRunways } from "../../core/layout";
import { headingVector } from "../../core/math";
import type { Runway, RunwayColor } from "../../core/types";
import { AirfieldFactory } from "../airfield";
import { AirspaceBoundary } from "../boundary";
import { Landscape } from "../landscape";
import { MeshFactory } from "../meshes";
import { RunwayFactory, type RunwayView } from "../runway";
import { fitShadowsToWorld } from "../scene";
import { gameCamera, groundPad, mountStage, orbitCamera } from "./stage";

const DEG = Math.PI / 180;

interface AirfieldArgs {
  /** Camera heading on top of the default view (degrees). */
  rotationDeg: number;
  /** Camera zoom, as the "+" / "−" buttons set it (0.45–2.5). */
  zoom: number;
  /** Show the airspace edge (normally only visible while a drag pushes past it). */
  showBoundary: boolean;
}

const meta: Meta = { title: "Scene/Airfield" };
export default meta;

// ---------------------------------------------------------------------------
// Single runway
// ---------------------------------------------------------------------------

interface RunwayArgs {
  color: RunwayColor;
  /** Landing direction (degrees, sim convention: 0 = +x, 90 = down the screen). */
  headingDeg: number;
  length: number;
  width: number;
}

/**
 * One runway with its taxiway, apron and hangars on a grass pad, close up.
 * Drag to orbit, wheel to zoom. Length and width override RUNWAY_LENGTH /
 * RUNWAY_WIDTH for quick experiments (the taxiway layout doesn't follow).
 */
export const SingleRunway: StoryObj<RunwayArgs> = {
  argTypes: {
    color: { control: "inline-radio", options: Object.keys(COLOR_HEX) },
    headingDeg: { control: { type: "range", min: -180, max: 180, step: 5 } },
    length: { control: { type: "range", min: 10, max: 80, step: 1 } },
    width: { control: { type: "range", min: 2, max: 12, step: 0.5 } },
  },
  args: { color: "blue", headingDeg: 0, length: RUNWAY_LENGTH, width: RUNWAY_WIDTH },
  render: (args) =>
    mountStage((stage) => {
      const factory = new MeshFactory(stage.scene);
      const runways = new RunwayFactory(stage.scene, (c) => factory.material(c));
      groundPad(stage, args.length * 8);
      // A world centred on the runway, so toScene puts it at the origin.
      const world = { width: 100, height: 100 };
      const heading = args.headingDeg * DEG;
      const center = { x: 50, y: 50 };
      const dir = headingVector(heading);
      const back = args.length / 2 - RUNWAY_THRESHOLD_INSET;
      const runway: Runway = {
        color: args.color,
        center,
        heading,
        length: args.length,
        width: args.width,
        threshold: { x: center.x - dir.x * back, y: center.y - dir.y * back },
        airfield: layoutAirfield(args.color, center, heading, 1, 0),
      };
      const view = runways.create(runway, world);
      new AirfieldFactory(stage.scene, (c) => factory.material(c), stage.shadows).create(
        runway,
        world,
      );
      orbitCamera(stage, Vector3.Zero(), args.length * 0.9);
      // Approach "rabbit" lights sweep towards the threshold.
      return (_dt, time) => view.update(time);
    }),
};

// ---------------------------------------------------------------------------
// Whole field
// ---------------------------------------------------------------------------

const fieldArgTypes = {
  rotationDeg: { control: { type: "range", min: -180, max: 180, step: 15 } },
  zoom: { control: { type: "range", min: 0.45, max: 2.5, step: 0.05 } },
} as const;

/**
 * Runways, taxiways and hangars as laid out for this canvas's aspect ratio
 * (resize the preview or pick a Storybook viewport to see the 2- vs
 * 3-runway layouts), on bare grass.
 */
export const RunwayLayout: StoryObj<AirfieldArgs> = {
  argTypes: fieldArgTypes,
  args: { rotationDeg: 0, zoom: 1, showBoundary: true },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage, args.rotationDeg * DEG, args.zoom);
      const factory = new MeshFactory(stage.scene);
      const runwayFactory = new RunwayFactory(stage.scene, (c) => factory.material(c));
      groundPad(stage, cam.world.width * 3);
      fitShadowsToWorld(stage.shadows, cam.world);
      const runways = layoutRunways(cam.world);
      const views: RunwayView[] = runways.map((r) => runwayFactory.create(r, cam.world));
      const airfields = new AirfieldFactory(stage.scene, (c) => factory.material(c), stage.shadows);
      for (const r of runways) airfields.create(r, cam.world);
      const boundary = new AirspaceBoundary(stage.scene);
      boundary.setWorld(cam.world);
      boundary.setActive(args.showBoundary);
      return (dt, time) => {
        cam.frame(dt, time);
        boundary.update(dt);
        for (const view of views) view.update(time);
      };
    }),
};

/** The full decorative landscape (grass, stream, trees) with the airfield. */
export const FullLandscape: StoryObj<AirfieldArgs> = {
  argTypes: fieldArgTypes,
  args: { rotationDeg: 0, zoom: 1, showBoundary: true },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage, args.rotationDeg * DEG, args.zoom);
      const factory = new MeshFactory(stage.scene);
      const runwayFactory = new RunwayFactory(stage.scene, (c) => factory.material(c));
      fitShadowsToWorld(stage.shadows, cam.world);
      const runways = layoutRunways(cam.world);
      const landscape = new Landscape(stage.scene, stage.shadows);
      landscape.setWorld(cam.world, runways);
      const views = runways.map((r) => runwayFactory.create(r, cam.world));
      const airfields = new AirfieldFactory(stage.scene, (c) => factory.material(c), stage.shadows);
      for (const r of runways) airfields.create(r, cam.world);
      const boundary = new AirspaceBoundary(stage.scene);
      boundary.setWorld(cam.world);
      boundary.setActive(args.showBoundary);
      return (dt, time) => {
        cam.frame(dt, time);
        landscape.update(time);
        boundary.update(dt);
        for (const view of views) view.update(time);
      };
    }),
};
