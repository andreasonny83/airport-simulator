/**
 * Babylon engine + scene bootstrap: renderer, clear colour and lights.
 */
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";

/** Background colour (Tailwind slate-950), also used by the page body. */
export const CLEAR_COLOR = "#020617";

export interface SceneContext {
  engine: Engine;
  scene: Scene;
}

export function createScene(canvas: HTMLCanvasElement): SceneContext {
  // antialias = true; adaptToDeviceRatio = true for crisp lines on HiDPI screens.
  const engine = new Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false }, true);
  const scene = new Scene(engine);
  scene.clearColor = Color4.FromHexString(`${CLEAR_COLOR}ff`);

  // Input is handled with plain DOM pointer events (see input/pointer.ts), so
  // skip Babylon's per-event mesh picking entirely.
  scene.skipPointerMovePicking = true;
  scene.skipPointerDownPicking = true;
  scene.skipPointerUpPicking = true;

  // Soft sky/ground fill plus a key light so the low-poly planes read in 3D.
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.7;
  fill.groundColor = new Color3(0.15, 0.18, 0.25);

  const key = new DirectionalLight("key", new Vector3(-0.5, -1, 0.3), scene);
  key.intensity = 0.8;

  return { engine, scene };
}
