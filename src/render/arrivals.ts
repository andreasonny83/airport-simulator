/**
 * Screen placement for arrival arrows (drawn by ui/arrivalArrows.ts).
 *
 * Every inbound plane (see `Plane.inbound`) that is still off-screen gets an
 * arrow: its projected position pinned just inside the screen edge, pointing
 * along its projected direction of travel. Working in screen space means the
 * arrows stay right at any zoom, pan or rotation. Once the plane itself is
 * on screen the arrow goes, since the plane now speaks for itself.
 */
import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { COLOR_HEX, FLIGHT_ALTITUDE } from "../config";
import { headingVector } from "../core/math";
import type { GameState, Vec2 } from "../core/types";
import type { ArrivalMarker } from "../ui/arrivalArrows";
import { toScene } from "./coords";

/** Arrow centre's distance from the screen edge (CSS px): half an arrow plus a gap. */
const EDGE_INSET = 34;
/**
 * A plane counts as on screen once its centre is this far inside the edge
 * (CSS px), i.e. most of the model is visible.
 */
const VISIBLE_INSET = 12;
/** Look-ahead (world units) used to find the on-screen direction of travel. */
const DIRECTION_PROBE = 5;

const scratchWorld = new Vector3();
const scratchA = new Vector3();
const scratchB = new Vector3();

/**
 * Arrows for the current frame. Call after `scene.render()`, so the view
 * matrices match what's on screen. `canvas` sizes the CSS pixel space.
 */
export function arrivalMarkers(
  state: GameState,
  scene: Scene,
  canvas: HTMLCanvasElement,
): ArrivalMarker[] {
  const camera = scene.activeCamera;
  if (!camera) return [];
  const engine = scene.getEngine();
  const renderW = engine.getRenderWidth();
  const renderH = engine.getRenderHeight();
  if (renderW === 0 || renderH === 0) return [];
  const viewport = camera.viewport.toGlobal(renderW, renderH);
  const transform = scene.getTransformMatrix();
  // Render pixels → CSS pixels (they differ with devicePixelRatio / hardware scaling).
  const cssW = canvas.clientWidth;
  const cssH = canvas.clientHeight;
  const sx = cssW / renderW;
  const sy = cssH / renderH;

  const project = (p: Vec2, out: Vector3): Vector3 => {
    toScene(p, state.world, FLIGHT_ALTITUDE, scratchWorld);
    Vector3.ProjectToRef(scratchWorld, Matrix.IdentityReadOnly, transform, viewport, out);
    out.x *= sx;
    out.y *= sy;
    return out;
  };

  const markers: ArrivalMarker[] = [];
  for (const plane of state.planes) {
    if (!plane.inbound || plane.phase !== "flying") continue;
    const at = project(plane.pos, scratchA);
    const onScreen =
      at.x >= VISIBLE_INSET &&
      at.x <= cssW - VISIBLE_INSET &&
      at.y >= VISIBLE_INSET &&
      at.y <= cssH - VISIBLE_INSET;
    if (onScreen) continue;

    const dir = headingVector(plane.heading);
    const ahead = project(
      { x: plane.pos.x + dir.x * DIRECTION_PROBE, y: plane.pos.y + dir.y * DIRECTION_PROBE },
      scratchB,
    );
    markers.push({
      id: plane.id,
      color: COLOR_HEX[plane.color],
      x: clamp(at.x, EDGE_INSET, cssW - EDGE_INSET),
      y: clamp(at.y, EDGE_INSET, cssH - EDGE_INSET),
      angle: Math.atan2(ahead.y - at.y, ahead.x - at.x),
    });
  }
  return markers;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
