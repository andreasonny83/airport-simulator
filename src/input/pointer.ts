/**
 * Pointer input: drag from a plane to draw its flight path.
 *
 * Uses DOM Pointer Events, which unify mouse, touch and pen — so this one
 * code path covers mousedown/move/up and touchstart/move/end. Each pointer is
 * tracked separately, so on touch screens several fingers can route several
 * planes at once. Camera controls never consume drags (see render/camera.ts).
 */
import type { Camera } from "@babylonjs/core/Cameras/camera";
import "@babylonjs/core/Culling/ray"; // side effect: adds scene.createPickingRay
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { PLANE_GRAB_RADIUS } from "../config";
import { distance } from "../core/math";
import { appendPathPoint, startPath } from "../core/path";
import type { GameState, Plane, Vec2 } from "../core/types";
import { fromScene } from "../render/coords";

/**
 * Cast a ray from a screen point and intersect it with the ground (y = 0).
 * Returns the hit in sim coordinates, or null if the ray is parallel to it.
 *
 * Everything the player aims at shares this one mapping: planes are drawn
 * over their ground track (see render/sceneSync.ts), and paths and runways
 * lie on the ground. So the plane under the finger is the one grabbed, and
 * the path point lands exactly under the finger.
 *
 * Analytic plane intersection is cheaper than mesh picking and works even
 * when the pointer is off the playfield.
 */
function screenToWorld(
  scene: Scene,
  camera: Camera,
  state: GameState,
  screenX: number,
  screenY: number,
): Vec2 | null {
  const ray = scene.createPickingRay(screenX, screenY, Matrix.Identity(), camera);
  if (Math.abs(ray.direction.y) < 1e-6) return null;
  const t = -ray.origin.y / ray.direction.y;
  return fromScene(ray.origin.add(ray.direction.scale(t)), state.world);
}

/** Closest flying plane within grab range of `point`, if any. */
function findPlaneNear(planes: readonly Plane[], point: Vec2): Plane | null {
  let best: Plane | null = null;
  let bestDist = PLANE_GRAB_RADIUS;
  for (const plane of planes) {
    if (plane.phase !== "flying") continue;
    const d = distance(plane.pos, point);
    if (d < bestDist) {
      best = plane;
      bestDist = d;
    }
  }
  return best;
}

/**
 * Wire pointer events on `canvas` to path drawing.
 * @returns a function that removes all listeners.
 */
export function attachPointerInput(
  canvas: HTMLCanvasElement,
  scene: Scene,
  camera: Camera,
  getState: () => GameState,
): () => void {
  /** pointerId → id of the plane that pointer is routing. */
  const active = new Map<number, number>();

  const toCanvas = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: PointerEvent) => {
    const state = getState();
    if (state.phase !== "playing") return;
    const { x, y } = toCanvas(e);
    const hit = screenToWorld(scene, camera, state, x, y);
    const plane = hit && findPlaneNear(state.planes, hit);
    if (!plane) return;

    startPath(plane);
    active.set(e.pointerId, plane.id);
    // Keep receiving move/up for this pointer even if it leaves the canvas.
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onMove = (e: PointerEvent) => {
    const planeId = active.get(e.pointerId);
    if (planeId === undefined) return;
    const state = getState();
    const plane = state.planes.find((p) => p.id === planeId);
    // Plane landed/crashed/removed mid-drag: stop routing it.
    if (!plane || plane.phase !== "flying" || state.phase !== "playing") {
      active.delete(e.pointerId);
      return;
    }
    const { x, y } = toCanvas(e);
    const point = screenToWorld(scene, camera, state, x, y);
    if (point) appendPathPoint(plane, point);
  };

  const onUp = (e: PointerEvent) => {
    active.delete(e.pointerId);
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  return () => {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp);
    canvas.removeEventListener("pointercancel", onUp);
  };
}
