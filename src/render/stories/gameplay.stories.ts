/**
 * Gameplay visuals through the real SceneSync, so everything draws exactly
 * as in the game:
 *
 *   - Markers:  a frozen moment staged by hand: drawn path lines, a pair of
 *               planes close enough for warning rings, a path anchored
 *               onto a runway threshold (green ring, re-anchored on a loop
 *               so its hold-and-fade replays), the free-path plane
 *               hovered by the pointer on a loop (white ring, slight
 *               swell; the `hover` arg holds it on), and two planes still
 *               off-screen on their way in, with their arrival arrows. The
 *               sim doesn't run, but the render clock does, so rings pulse
 *               and wind blows.
 *   - Crash:    two planes flown into each other by the real sim, on a
 *               loop: the crash cinematic (camera glide, zoom and slow
 *               orbit) with the fireball, falling wrecks, debris, fire and
 *               smoke, and the see-through game-over panel on its delay.
 *   - Landing:  one plane flown by the real sim down an anchored path from
 *               well outside the airspace, on a loop: it descends from
 *               OUTER_FLIGHT_ALTITUDE as it crosses the edge, glides down
 *               the approach, flares, taxis to a stand. Its model scales
 *               with height (ALTITUDE_SCALE_PER_UNIT), so it shrinks on
 *               the way down and is smallest on the ground.
 *   - LiveGame: the whole game (sim, input, HUD) in a story, with slow motion.
 *
 * Tuning loop: PATH_* / ANCHOR_RING_* / HOVER_* / YAW_EASE / BANK_EASE in sceneSync.ts, ring sizes and
 * colours in meshes.ts, arrow placement in arrivals.ts, arrow look in
 * ui/hudMarkup.ts, distances (AIRSPACE_MARGIN, ARRIVAL_WARNING…) in config.ts.
 * Crash: CRASH_ZOOM / CRASH_FRAME_LIFT / CRASH_ORBIT_* / CRASH_OVERLAY_DELAY in config.ts,
 * WRECK_* / DEBRIS_* / FLASH_* / SCORCH_* / SMOKE_DRIFT and the particle
 * set-ups in crash.ts, FOCUS_EASE_RATE in camera.ts, CRASH_BACKDROP in
 * ui/hud.ts.
 * Landing: FLIGHT_ALTITUDE / OUTER_FLIGHT_ALTITUDE / ALTITUDE_TRANSITION /
 * APPROACH_DISTANCE / THRESHOLD_ALTITUDE / ALTITUDE_SCALE_PER_UNIT and
 * FLARE_DISTANCE in config.ts, MAX_VERTICAL_SPEED in sceneSync.ts.
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  COLOR_HEX,
  CRASH_OVERLAY_DELAY,
  PATH_MIN_SPACING,
  PLANE_SPEED,
  ROTATE_STEP,
  WARNING_DISTANCE,
  ZOOM_MIN,
  ZOOM_STEP,
} from "../../config";
import { airspaceBounds, isInAirspace } from "../../core/layout";
import { headingVector, mulberry32 } from "../../core/math";
import { anchorPath, appendPathPoint } from "../../core/path";
import { createPlane } from "../../core/plane";
import { startGame, step, togglePause } from "../../core/simulation";
import { pickSpawn } from "../../core/spawner";
import { createGameState } from "../../core/state";
import type { GameState, Plane, Vec2 } from "../../core/types";
import { attachPointerInput } from "../../input/pointer";
import { createArrivalArrows } from "../../ui/arrivalArrows";
import { createHud } from "../../ui/hud";
import { arrivalLayerMarkup } from "../../ui/hudMarkup";
import { arrivalMarkers } from "../arrivals";
import { MeshFactory } from "../meshes";
import { ANCHOR_RING_FADE, ANCHOR_RING_HOLD, SceneSync } from "../sceneSync";
import { gameCamera, mountStage } from "./stage";

const DEG = Math.PI / 180;

const meta: Meta = { title: "Scene/Gameplay" };
export default meta;

// ---------------------------------------------------------------------------
// Markers (hand-staged state)
// ---------------------------------------------------------------------------

/** `steps` points along a quadratic Bézier from a to c (control point b), excluding a. */
function curve(a: Vec2, b: Vec2, c: Vec2, steps: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * a.x + 2 * u * t * b.x + t * t * c.x,
      y: u * u * a.y + 2 * u * t * b.y + t * t * c.y,
    });
  }
  return out;
}

/** Give `plane` a drawn path (and bump its version so SceneSync draws it). */
function setPath(plane: Plane, path: Vec2[], anchored = false): void {
  plane.path = path;
  plane.pathAnchored = anchored;
  plane.pathVersion++;
}

/**
 * Stage a scene: one plane on an anchored approach to the first runway, one
 * with a free path, and two converging planes inside `WARNING_DISTANCE`.
 */
function stageMarkers(state: GameState): void {
  const { world, runways } = state;
  const planes: Plane[] = [];
  const target = runways[0];

  if (target) {
    // Approach from well behind the threshold, curving in along the heading.
    const dir = headingVector(target.heading);
    const start = { x: target.threshold.x - dir.x * 30 + 12, y: target.threshold.y - dir.y * 30 };
    const bend = { x: target.threshold.x - dir.x * 12, y: target.threshold.y - dir.y * 12 };
    const approach = createPlane(1, target.color, start, target.heading);
    setPath(approach, curve(start, bend, target.threshold, 16), true);
    planes.push(approach);
  }

  // A free path wandering across the field.
  const wanderer = createPlane(2, "blue", { x: world.width * 0.15, y: world.height * 0.2 }, 0);
  setPath(
    wanderer,
    curve(
      wanderer.pos,
      { x: world.width * 0.5, y: world.height * 0.05 },
      { x: world.width * 0.6, y: world.height * 0.4 },
      20,
    ),
  );
  planes.push(wanderer);

  // Two planes converging: close enough to warn, not to crash.
  const mid = { x: world.width * 0.55, y: world.height * 0.55 };
  const gap = WARNING_DISTANCE * 0.35;
  const a = createPlane(3, "yellow", { x: mid.x - gap, y: mid.y }, 20 * DEG);
  const b = createPlane(4, "red", { x: mid.x + gap, y: mid.y }, 160 * DEG);
  a.warning = b.warning = true;
  planes.push(a, b);

  // Two arrivals, placed exactly as the spawner would (seeded, so the story
  // is the same every time): still off-screen, so they show as arrows.
  const rng = mulberry32(11);
  for (const id of [5, 6]) {
    const spec = pickSpawn(world, state.viewAspect, ["red", "blue", "yellow"], rng);
    const inbound = createPlane(id, spec.color, spec.pos, spec.heading);
    inbound.inbound = true;
    planes.push(inbound);
  }

  state.planes = planes;
}

interface MarkersArgs {
  rotationDeg: number;
  zoom: number;
  /** Keep the hover highlight on, instead of toggling it on a loop. */
  hover: boolean;
}

export const Markers: StoryObj<MarkersArgs> = {
  argTypes: {
    rotationDeg: { control: { type: "range", min: -180, max: 180, step: 15 } },
    zoom: { control: { type: "range", min: ZOOM_MIN, max: 2.5, step: 0.05 } },
  },
  args: { rotationDeg: 0, zoom: 1, hover: false },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage, args.rotationDeg * DEG, args.zoom);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      sync.rebuildWorld(state);
      stageMarkers(state);
      stage.root.insertAdjacentHTML("beforeend", arrivalLayerMarkup());
      const arrows = createArrivalArrows(stage.root.querySelector<HTMLElement>("#arrivals")!);
      // Re-anchor the approach every so often (unanchored for one frame), so
      // the anchor ring's hold-and-fade plays again with a pause between.
      const approach = state.planes.find((p) => p.pathAnchored);
      const replayEvery = ANCHOR_RING_HOLD + ANCHOR_RING_FADE + 1.5;
      let sinceAnchor = 0;
      // The free-path plane (id 2) is "hovered": 1.5 s on, 1.5 s off, so the
      // ring's ease in and out shows too (see HOVER_EASE in sceneSync.ts).
      const hovered = new Set([2]);
      const none = new Set<number>();
      return (dt, time) => {
        if (approach) {
          sinceAnchor += dt;
          approach.pathAnchored = sinceAnchor < replayEvery;
          if (!approach.pathAnchored) sinceAnchor = 0;
        }
        sync.setHighlighted(args.hover || time % 3 < 1.5 ? hovered : none);
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
        arrows.update(arrivalMarkers(state, stage.scene, stage.canvas));
      };
    }),
};

// ---------------------------------------------------------------------------
// Crash
// ---------------------------------------------------------------------------

interface CrashArgs {
  /** Angle between the two planes' headings (180 = head-on). */
  angleDeg: number;
  /** Seconds after the crash before the whole thing replays. */
  replayAfter: number;
  /** Show the game-over panel (on its CRASH_OVERLAY_DELAY), as in the game. */
  overlay: boolean;
  timeScale: number;
}

/**
 * Put two planes on a collision course over the middle of the field, about
 * a second apart, and nothing else in the sky (spawning held off).
 */
function stageCrash(state: GameState, angleDeg: number): void {
  const { world } = state;
  const meet = { x: world.width * 0.46, y: world.height * 0.34 };
  // Each plane starts ~1.2 s of flight back along its own course.
  const back = PLANE_SPEED * 1.2;
  const half = (angleDeg * DEG) / 2;
  const headings = [-half, Math.PI + half];
  const colors = ["red", "blue"] as const;
  state.planes = headings.map((h, i) => {
    const dir = headingVector(h);
    const start = { x: meet.x - dir.x * back, y: meet.y - dir.y * back };
    return createPlane(state.nextPlaneId++, colors[i]!, start, h);
  });
  state.phase = "playing";
  state.spawnTimer = -1e9; // no other traffic
}

export const Crash: StoryObj<CrashArgs> = {
  argTypes: {
    angleDeg: { control: { type: "range", min: 30, max: 180, step: 5 } },
    replayAfter: { control: { type: "range", min: 4, max: 40, step: 1 } },
    timeScale: { control: { type: "range", min: 0.1, max: 2, step: 0.05 } },
  },
  args: { angleDeg: 150, replayAfter: 14, overlay: true, timeScale: 1 },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      sync.rebuildWorld(state);
      const hud = createHud(stage.root, {
        onStart: () => (sinceCrash = args.replayAfter), // "TRY AGAIN" replays now
        onTogglePause: () => undefined,
        onRotate: (dir) => cam.controller.rotateBy(dir * ROTATE_STEP),
        onZoom: (dir) => cam.controller.zoomBy(dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP),
      });
      hud.hideOverlay();
      stageCrash(state, args.angleDeg);

      let time = 0;
      /** Seconds since the crash, or null before it. */
      let sinceCrash: number | null = null;
      return (dt) => {
        time += dt;
        for (const event of step(state, dt)) {
          if (event.type !== "crash") continue;
          const site = sync.crash(event.planeIds);
          if (site) cam.controller.focusOn(site);
          sinceCrash = 0;
        }
        if (sinceCrash !== null) {
          const before = sinceCrash;
          sinceCrash += dt;
          if (args.overlay && before < CRASH_OVERLAY_DELAY && sinceCrash >= CRASH_OVERLAY_DELAY) {
            hud.showGameOver(state.score);
          }
          if (sinceCrash >= args.replayAfter) {
            // Clear the wreckage (new plane ids) and fly it all again.
            sinceCrash = null;
            hud.hideOverlay();
            cam.controller.release();
            stageCrash(state, args.angleDeg);
          }
        }
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
      };
    }, args.timeScale),
};

// ---------------------------------------------------------------------------
// Landing (real sim, one plane)
// ---------------------------------------------------------------------------

interface LandingArgs {
  /** How far outside the airspace the plane starts (world units). */
  startOutside: number;
  /** Seconds before the approach replays (the plane may still be taxiing). */
  replayAfter: number;
  timeScale: number;
}

/**
 * One red plane on the red runway's extended centreline, `startOutside`
 * units beyond the airspace edge, with a straight path drawn to the
 * threshold and anchored exactly as the pointer input would. Nothing else
 * flies (spawning held off).
 */
function stageLanding(state: GameState, startOutside: number): void {
  const runway = state.runways.find((r) => r.color === "red") ?? state.runways[0]!;
  const dir = headingVector(runway.heading);
  // Walk back along the approach until clear of the airspace, then further.
  const bounds = airspaceBounds(state.world);
  const reach = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  let back = 0;
  const at = (d: number): Vec2 => ({
    x: runway.threshold.x - dir.x * d,
    y: runway.threshold.y - dir.y * d,
  });
  while (back < reach && isInAirspace(at(back), state.world)) back += 1;
  back += startOutside;

  const plane = createPlane(state.nextPlaneId++, runway.color, at(back), runway.heading);
  state.planes = [plane];
  // Draw the path point by point, trying to anchor after each (as input does).
  for (let d = back - PATH_MIN_SPACING; d > -PATH_MIN_SPACING; d -= PATH_MIN_SPACING) {
    appendPathPoint(plane, at(Math.max(0, d)));
    if (anchorPath(plane, state.runways, state.world)) break;
  }
  state.phase = "playing";
  state.spawnTimer = -1e9; // no other traffic
}

export const Landing: StoryObj<LandingArgs> = {
  argTypes: {
    startOutside: { control: { type: "range", min: 0, max: 40, step: 1 } },
    replayAfter: { control: { type: "range", min: 10, max: 60, step: 1 } },
    timeScale: { control: { type: "range", min: 0.1, max: 3, step: 0.05 } },
  },
  args: { startOutside: 18, replayAfter: 34, timeScale: 1 },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      sync.rebuildWorld(state);
      stageLanding(state, args.startOutside);

      let time = 0;
      let sinceStart = 0;
      return (dt) => {
        time += dt;
        sinceStart += dt;
        step(state, dt);
        if (sinceStart >= args.replayAfter) {
          sinceStart = 0;
          stageLanding(state, args.startOutside); // new plane id: fresh mesh
        }
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
      };
    }, args.timeScale),
};

// ---------------------------------------------------------------------------
// Live game
// ---------------------------------------------------------------------------

interface LiveArgs {
  /** Skip the start overlay and begin a shift straight away. */
  autoStart: boolean;
  /** Game speed: 0.25 = slow motion for watching turns, banking and landings. */
  timeScale: number;
}

/**
 * The full game: draw paths with the mouse, land planes, crash. Uses the
 * same modules as main.ts, minus window-level listeners (keyboard, resize).
 */
export const LiveGame: StoryObj<LiveArgs> = {
  argTypes: { timeScale: { control: { type: "range", min: 0.1, max: 2, step: 0.05 } } },
  args: { autoStart: true, timeScale: 1 },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      sync.rebuildWorld(state);

      /** Seconds until the game-over panel shows (see main.ts), or null. */
      let gameOverIn: number | null = null;
      const begin = () => {
        gameOverIn = null;
        cam.controller.release();
        startGame(state);
        hud.setScore(state.score);
        hud.hideOverlay();
        hud.setPhase(state.phase);
      };
      const hud = createHud(stage.root, {
        onStart: begin,
        onTogglePause: () => togglePause(state) && hud.setPhase(state.phase),
        onRotate: (dir) => cam.controller.rotateBy(dir * ROTATE_STEP),
        onZoom: (dir) => cam.controller.zoomBy(dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP),
      });
      const pointer = attachPointerInput(
        stage.canvas,
        stage.scene,
        cam.controller.camera,
        () => state,
        { onEdgeHover: (active) => sync.setEdgeHighlight(active) },
      );
      if (args.autoStart) begin();

      let time = 0;
      return (dt) => {
        if (state.phase !== "paused") time += dt;
        for (const event of step(state, dt)) {
          if (event.type === "landed") hud.setScore(state.score);
          else if (event.type === "crash") {
            const site = sync.crash(event.planeIds);
            if (site) cam.controller.focusOn(site);
            gameOverIn = CRASH_OVERLAY_DELAY;
            hud.setPhase(state.phase);
          } else if (event.type === "unlocked") {
            hud.showToast(`${event.color.toUpperCase()} runway open`, COLOR_HEX[event.color]);
          } else if (event.type === "goAround") {
            hud.showToast(
              `${event.color.toUpperCase()} runway busy — go around`,
              COLOR_HEX[event.color],
            );
          }
        }
        if (gameOverIn !== null && (gameOverIn -= dt) <= 0) {
          gameOverIn = null;
          hud.showGameOver(state.score);
        }
        cam.frame(dt, time);
        sync.setHighlighted(pointer.refreshHover());
        sync.syncPlanes(state, time);
        hud.setArrivals(arrivalMarkers(state, stage.scene, stage.canvas));
      };
    }, args.timeScale),
};
