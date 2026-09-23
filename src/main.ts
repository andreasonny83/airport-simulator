/**
 * Entry point: wires the pure simulation (core) to the Babylon renderer,
 * pointer input and HTML HUD, then runs the game loop.
 *
 *   core  (state + rules, no DOM)  ←  render / input / ui  ←  main.ts
 */
import "./style.css";
import { MAX_DT } from "./config";
import { startGame, step } from "./core/simulation";
import { createGameState, resizeWorld } from "./core/state";
import type { SimEvent } from "./core/types";
import { attachPointerInput } from "./input/pointer";
import { CameraController } from "./render/camera";
import { MeshFactory } from "./render/meshes";
import { createScene } from "./render/scene";
import { SceneSync } from "./render/sceneSync";
import { createHud } from "./ui/hud";

/** One press of a rotate button turns the view by 30°. */
const ROTATE_STEP = Math.PI / 6;
/** One press of a zoom button scales the view by 25%. */
const ZOOM_STEP = 1.25;

const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const { engine, scene } = createScene(canvas);
const aspect = () => engine.getRenderWidth() / engine.getRenderHeight();

// --- State (pure data, advanced only by `step`) ----------------------------
const state = createGameState(aspect());

// --- Rendering ---------------------------------------------------------------
const cameraController = new CameraController(scene, canvas);
const sceneSync = new SceneSync(scene, new MeshFactory(scene));

function applyWorldSize(): void {
  resizeWorld(state, aspect());
  cameraController.setWorld(state.world);
  sceneSync.rebuildWorld(state);
}
applyWorldSize();

// --- UI + input ----------------------------------------------------------------
const hud = createHud({
  onStart: () => {
    startGame(state);
    hud.setScore(state.score);
    hud.hideOverlay();
  },
  onRotate: (dir) => cameraController.rotateBy(dir * ROTATE_STEP),
  onZoom: (dir) => cameraController.zoomBy(dir > 0 ? ZOOM_STEP : 1 / ZOOM_STEP),
});

attachPointerInput(canvas, scene, cameraController.camera, () => state);

window.addEventListener("resize", () => {
  engine.resize();
  applyWorldSize();
});

function handleEvent(event: SimEvent): void {
  switch (event.type) {
    case "landed":
      hud.setScore(state.score);
      break;
    case "crash":
      hud.showGameOver(state.score);
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
  time += dt;

  for (const event of step(state, dt)) handleEvent(event);

  cameraController.update(dt, aspect());
  sceneSync.syncPlanes(state, time);
  scene.render();
});

// Expose state for debugging / automated browser checks in dev builds only.
if (import.meta.env.DEV) {
  (window as unknown as { __game: unknown }).__game = { state, cameraController };
}
