/**
 * Entry point: wires the pure simulation (core) to the Babylon renderer,
 * pointer input and HTML HUD, then runs the game loop.
 *
 *   core  (state + rules, no DOM)  ←  render / input / ui  ←  main.ts
 */
import "./style.css";
import { COLOR_HEX, CRASH_OVERLAY_DELAY, MAX_DT, ROTATE_STEP, ZOOM_STEP } from "./config";
import { startGame, step, togglePause } from "./core/simulation";
import { createGameState, setViewAspect } from "./core/state";
import type { SimEvent } from "./core/types";
import { attachPanKeys } from "./input/keyboard";
import { attachPointerInput } from "./input/pointer";
import { arrivalMarkers } from "./render/arrivals";
import { CameraController } from "./render/camera";
import { MeshFactory } from "./render/meshes";
import { createScene } from "./render/scene";
import { SceneSync } from "./render/sceneSync";
import { createHud } from "./ui/hud";

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const { engine, scene, shadows } = createScene(canvas);
const aspect = () => engine.getRenderWidth() / engine.getRenderHeight();

// --- State (pure data, advanced only by `step`) ----------------------------
const state = createGameState(aspect());

// --- Rendering ---------------------------------------------------------------
const cameraController = new CameraController(scene, canvas);
const sceneSync = new SceneSync(scene, new MeshFactory(scene), shadows);

// The world is fixed-size, so the static scene is built once. Resizing the
// window only refits the camera (every frame, from `aspect()`).
cameraController.setWorld(state.world);
sceneSync.rebuildWorld(state);

/**
 * Seconds until the game-over panel appears, while a crash cinematic plays
 * without it (see `CRASH_OVERLAY_DELAY`); null otherwise.
 */
let gameOverIn: number | null = null;

// --- UI + input ----------------------------------------------------------------
function setPaused(paused: boolean): void {
  if ((state.phase === "paused") !== paused && togglePause(state)) hud.setPhase(state.phase);
}

const hud = createHud(document.body, {
  onStart: () => {
    // Leave the crash site: the camera glides back to the default view.
    gameOverIn = null;
    cameraController.release();
    startGame(state);
    hud.setScore(state.score);
    hud.hideOverlay();
    hud.setPhase(state.phase);
  },
  onTogglePause: () => setPaused(state.phase !== "paused"),
  onRotate: (dir) => cameraController.rotateBy(dir * ROTATE_STEP),
  onZoom: (dir) => cameraController.zoomBy(dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP),
});

attachPointerInput(canvas, scene, cameraController.camera, () => state, {
  // Dragging empty ground grabs the map.
  onPan: (dx, dy) => cameraController.dragBy(dx, dy),
  // Paths may run past the airspace edge: show the border (outside it
  // planes can't collide) while a drag is beyond it.
  onEdgeHover: (active) => sceneSync.setEdgeHighlight(active),
});

// Arrow keys pan the map (held keys are polled in the render loop).
const panKeys = attachPanKeys();

// Keyboard shortcut: P or Esc toggles pause.
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.key === "p" || e.key === "P" || e.key === "Escape") setPaused(state.phase !== "paused");
});

// Auto-pause when the tab is hidden, so switching away never costs a crash.
// Stays paused on return: the player continues when they're ready.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) setPaused(true);
});

// Resize: new canvas size and camera frustum only. The map stays put.
window.addEventListener("resize", () => {
  engine.resize();
  setViewAspect(state, aspect());
});

function handleEvent(event: SimEvent): void {
  switch (event.type) {
    case "landed":
      hud.setScore(state.score);
      break;
    case "crash": {
      // Wreck the planes, fly the camera over and start the slow orbit. The
      // game-over panel waits, so nothing covers the fireball.
      const site = sceneSync.crash(event.planeIds);
      if (site) cameraController.focusOn(site);
      gameOverIn = CRASH_OVERLAY_DELAY;
      hud.setPhase(state.phase);
      break;
    }
    case "unlocked":
      hud.showToast(`${event.color.toUpperCase()} runway open`, COLOR_HEX[event.color]);
      break;
    case "goAround":
      hud.showToast(`${event.color.toUpperCase()} runway busy — go around`, COLOR_HEX[event.color]);
      break;
    case "spawned":
      break;
  }
}

// --- Game loop -------------------------------------------------------------------
let time = 0;
engine.runRenderLoop(() => {
  // Seconds since last frame, clamped so a backgrounded tab doesn't make
  // planes teleport (and tunnel through each other) when it resumes.
  const dt = Math.min(engine.getDeltaTime() / 1000, MAX_DT);
  // Animation clock (warning pulse, water shimmer) stops while paused too, so
  // the whole scene freezes. The camera below still eases on real dt.
  if (state.phase !== "paused") time += dt;

  for (const event of step(state, dt)) handleEvent(event);
  if (gameOverIn !== null && (gameOverIn -= dt) <= 0) {
    gameOverIn = null;
    hud.showGameOver(state.score);
  }

  cameraController.panBy(panKeys.direction(), dt);
  cameraController.update(dt, aspect());
  sceneSync.syncPlanes(state, time);
  scene.render();
  // After render, so the arrows use this frame's camera matrices.
  hud.setArrivals(arrivalMarkers(state, scene, canvas));
});

// Expose state for debugging / automated browser checks in dev builds only.
if (import.meta.env.DEV) {
  (window as unknown as { __game: unknown }).__game = { state, cameraController };
}
