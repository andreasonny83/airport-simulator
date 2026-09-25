/**
 * Pointer input: drag from a plane to draw its flight path; drag anywhere
 * else to grab and move the map.
 *
 * Uses DOM Pointer Events, which unify mouse, touch and pen — so this one
 * code path covers mousedown/move/up and touchstart/move/end. Each pointer is
 * tracked separately, so on touch screens several fingers can route several
 * planes at once. Grabbing a plane always wins over panning: a press only
 * pans when no plane is in grab range (or when paths can't be drawn, e.g.
 * while paused), so routing is never stolen by the camera.
 */
import type { Camera } from "@babylonjs/core/Cameras/camera";
import "@babylonjs/core/Culling/ray"; // side effect: adds scene.createPickingRay
import { Matrix } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { PLANE_GRAB_RADIUS } from "../config";
import { distance } from "../core/math";
import { anchorPath, appendPathPoint, clampPathPoint, startPath } from "../core/path";
import { isInAirspace } from "../core/layout";
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
 * Hooks out of pointer input. The edge hooks tell the player why a path
 * stopped growing: paths can't be drawn past the edge of the field (see
 * core/path.ts `clampPathPoint`), and without feedback a clipped line looks
 * like a bug.
 */
export interface PointerFeedback {
  /**
   * Empty ground was dragged by (dx, dy), in canvas heights with +y down.
   * Without this hook, drags that miss a plane do nothing.
   */
  onPan?: (dx: number, dy: number) => void;
  /** A drag pushed past the edge. Fires once per drag, on the first push. */
  onEdgeBlocked?: (plane: Plane) => void;
  /** Whether any drag currently has its pointer past the edge. */
  onEdgeHover?: (active: boolean) => void;
}

/**
 * Wire pointer events on `canvas` to path drawing and map panning.
 * @returns a function that removes all listeners.
 */
export function attachPointerInput(
  canvas: HTMLCanvasElement,
  scene: Scene,
  camera: Camera,
  getState: () => GameState,
  feedback: PointerFeedback = {},
): () => void {
  /** pointerId → id of the plane that pointer is routing. */
  const active = new Map<number, number>();
  /** Pointers whose drag has already hit the edge (warn once per drag). */
  const warned = new Set<number>();
  /** Pointers currently past the edge mid-drag. */
  const outside = new Set<number>();
  /**
   * The one pointer dragging the map, and where it was last seen (canvas
   * pixels). Only one at a time: two fingers panning together would move
   * the map twice as fast as either finger.
   */
  let pan: { pointerId: number; x: number; y: number } | null = null;

  /** Record whether `pointerId` is past the edge; report changes. */
  const setOutside = (pointerId: number, isOutside: boolean) => {
    const before = outside.size > 0;
    if (isOutside) outside.add(pointerId);
    else outside.delete(pointerId);
    if (before !== outside.size > 0) feedback.onEdgeHover?.(outside.size > 0);
  };

  /** Stop routing: forget the pointer and clear its edge state. */
  const release = (pointerId: number) => {
    active.delete(pointerId);
    warned.delete(pointerId);
    setOutside(pointerId, false);
  };

  const toCanvas = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: PointerEvent) => {
    // Only the primary (left) mouse button draws or pans; touch/pen report 0.
    if (e.button !== 0) return;
    const state = getState();
    const { x, y } = toCanvas(e);
    const hit = state.phase === "playing" ? screenToWorld(scene, camera, state, x, y) : null;
    const plane = hit && findPlaneNear(state.planes, hit);

    if (plane) {
      startPath(plane);
      active.set(e.pointerId, plane.id);
    } else if (feedback.onPan && pan === null) {
      pan = { pointerId: e.pointerId, x, y };
      canvas.style.cursor = "grabbing";
    } else {
      return;
    }
    // Keep receiving move/up for this pointer even if it leaves the canvas.
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onMove = (e: PointerEvent) => {
    if (pan && pan.pointerId === e.pointerId) {
      const { x, y } = toCanvas(e);
      const h = canvas.clientHeight || 1;
      feedback.onPan?.((x - pan.x) / h, (y - pan.y) / h);
      pan.x = x;
      pan.y = y;
      return;
    }
    const planeId = active.get(e.pointerId);
    if (planeId === undefined) return;
    const state = getState();
    const plane = state.planes.find((p) => p.id === planeId);
    // Plane landed/crashed/removed mid-drag: stop routing it.
    if (!plane || plane.phase !== "flying" || state.phase !== "playing") {
      release(e.pointerId);
      return;
    }
    const { x, y } = toCanvas(e);
    const hit = screenToWorld(scene, camera, state, x, y);
    if (!hit) return;

    // Paths stop at the edge of the field (see clampPathPoint). Tell the
    // player, once per drag, so the clipped line doesn't look broken.
    // An inbound plane grabbed before it has flown in starts outside, so the
    // pointer does too: that's not a path hitting the edge. The border still
    // shows (it's where the path can start), but hold the notice until the
    // path has begun.
    const pastEdge = !isInAirspace(hit, state.world);
    const flyingIn = plane.inbound && plane.path.length === 0;
    setOutside(e.pointerId, pastEdge);
    if (pastEdge && !flyingIn && !warned.has(e.pointerId)) {
      warned.add(e.pointerId);
      feedback.onEdgeBlocked?.(plane);
    }

    const point = clampPathPoint(plane, hit, state.world);
    if (!point || !appendPathPoint(plane, point)) return;
    // Reached the runway from the right direction: the path snaps onto the
    // threshold and is finished, so this pointer stops routing the plane.
    if (anchorPath(plane, state.runways)) release(e.pointerId);
  };

  const onUp = (e: PointerEvent) => {
    if (pan && pan.pointerId === e.pointerId) {
      pan = null;
      canvas.style.cursor = "";
    }
    release(e.pointerId);
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
