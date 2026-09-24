/**
 * Babylon engine + scene bootstrap: renderer, clear colour, daytime lights
 * and the shared shadow generator.
 */
import { Engine } from "@babylonjs/core/Engines/engine";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent"; // side effect: shadow rendering
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scene } from "@babylonjs/core/scene";
import { airspaceBounds } from "../core/layout";
import type { WorldSize } from "../core/types";

/**
 * Background colour: the darkened grass at the map edge, so any sliver of
 * clear colour past the landscape blends in. Mirrored by the page body in
 * `style.css`.
 */
export const CLEAR_COLOR = "#2f5222";

/**
 * Rendering group for gameplay objects (planes, paths, warning rings).
 * Babylon draws groups in order and clears depth between them, so anything
 * in this group always shows on top of the scenery — trees can be taller
 * than the flight altitude without ever hiding a plane or its route.
 */
export const OVERLAY_GROUP = 1;

/** Direction the sun shines (towards the ground, slightly from the side). */
const SUN_DIRECTION = new Vector3(-0.5, -1, 0.3).normalize();

/** How far back along the sun ray the light sits; must clear every caster. */
const SUN_DISTANCE = 150;

/**
 * Shadow map covers this multiple of the playfield diagonal. Trees beyond it
 * cast no shadow, which only shows at the far edge of a full zoom-out, and
 * keeping it tight keeps plane shadows crisp.
 */
const SHADOW_COVERAGE = 1.6;

export interface SceneContext {
  engine: Engine;
  scene: Scene;
  /** Shared generator: register anything that should cast a shadow. */
  shadows: ShadowGenerator;
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

  // Daytime lighting: a sky fill that bounces green off the grass, plus a
  // warm key "sun" that casts the shadows.
  const fill = new HemisphericLight("fill", new Vector3(0, 1, 0), scene);
  fill.intensity = 0.65;
  fill.diffuse = new Color3(0.95, 0.97, 1);
  fill.groundColor = new Color3(0.25, 0.35, 0.2);

  const key = new DirectionalLight("key", SUN_DIRECTION.clone(), scene);
  key.intensity = 0.75;
  key.diffuse = new Color3(1, 0.95, 0.85);
  // Directional lights need a position for shadows: it is the eye point of
  // the shadow camera, which looks along the light direction.
  key.position = SUN_DIRECTION.scale(-SUN_DISTANCE);
  key.shadowMinZ = 1;
  key.shadowMaxZ = SUN_DISTANCE * 2;

  const shadows = new ShadowGenerator(2048, key);
  // PCF gives soft-edged shadows for a single texture lookup budget (WebGL2).
  shadows.usePercentageCloserFiltering = true;
  shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  shadows.bias = 0.002;
  shadows.darkness = 0.35;

  return { engine, scene, shadows };
}

/**
 * Size the (fixed, square) shadow frustum to the playfield. A fixed frustum
 * instead of Babylon's auto-extend, because the thousands of trees across
 * the whole map would otherwise stretch the shadow map until plane shadows
 * were a few blurry texels.
 */
export function fitShadowsToWorld(shadows: ShadowGenerator, world: WorldSize): void {
  const light = shadows.getLight() as DirectionalLight;
  // Planes fly anywhere in the airspace, which on tall screens reaches well
  // past the field's diagonal: stretch to cover it so they keep a shadow.
  const a = airspaceBounds(world);
  const airspaceDiagonal = Math.hypot(a.maxX - a.minX, a.maxY - a.minY);
  light.shadowFrustumSize = Math.max(
    Math.hypot(world.width, world.height) * SHADOW_COVERAGE,
    airspaceDiagonal,
  );
}
