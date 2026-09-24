/**
 * Gameplay visuals through the real SceneSync, so everything draws exactly
 * as in the game:
 *
 *   - Markers:  a frozen moment staged by hand: drawn path lines, a pair of
 *               planes close enough for warning rings, and a path anchored
 *               onto a runway threshold (green ring). The sim doesn't run,
 *               but the render clock does, so rings pulse and wind blows.
 *   - LiveGame: the whole game (sim, input, HUD) in a story, with slow motion.
 *
 * Tuning loop: PATH_* / YAW_EASE / BANK_EASE in sceneSync.ts, ring sizes and
 * colours in meshes.ts, distances in config.ts.
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import { COLOR_HEX, ROTATE_STEP, WARNING_DISTANCE, ZOOM_STEP } from "../../config";
import { headingVector } from "../../core/math";
import { createPlane } from "../../core/plane";
import { startGame, step, togglePause } from "../../core/simulation";
import { createGameState } from "../../core/state";
import type { GameState, Plane, Vec2 } from "../../core/types";
import { attachPointerInput } from "../../input/pointer";
import { createHud } from "../../ui/hud";
import { MeshFactory } from "../meshes";
import { SceneSync } from "../sceneSync";
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

  state.planes = planes;
}

export const Markers: StoryObj<{ rotationDeg: number; zoom: number }> = {
  argTypes: {
    rotationDeg: { control: { type: "range", min: -180, max: 180, step: 15 } },
    zoom: { control: { type: "range", min: 0.45, max: 2.5, step: 0.05 } },
  },
  args: { rotationDeg: 0, zoom: 1 },
  render: (args) =>
    mountStage((stage) => {
      const cam = gameCamera(stage, args.rotationDeg * DEG, args.zoom);
      const state = createGameState(stage.aspect());
      const sync = new SceneSync(stage.scene, new MeshFactory(stage.scene), stage.shadows);
      sync.rebuildWorld(state);
      stageMarkers(state);
      return (dt, time) => {
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
      };
    }),
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

      const begin = () => {
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
      attachPointerInput(stage.canvas, stage.scene, cam.controller.camera, () => state, {
        onEdgeHover: (active) => sync.setEdgeHighlight(active),
        onEdgeBlocked: (plane) =>
          hud.showToast(
            plane.canDepart
              ? "Paths end at the edge — plane will fly off"
              : "Land this one — it can't leave",
          ),
      });
      if (args.autoStart) begin();

      let time = 0;
      return (dt) => {
        if (state.phase !== "paused") time += dt;
        for (const event of step(state, dt)) {
          if (event.type === "landed") hud.setScore(state.score);
          else if (event.type === "crash") {
            hud.showGameOver(state.score);
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
        cam.frame(dt, time);
        sync.syncPlanes(state, time);
      };
    }, args.timeScale),
};
