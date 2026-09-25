/**
 * Tilted orthographic camera with button-driven rotate/zoom and arrow-key pan.
 *
 * The camera is deliberately NOT attached to pointer input: every drag on the
 * canvas draws a flight path. Rotation and zoom come from HUD buttons and the
 * mouse wheel; panning comes from the arrow keys (see input/keyboard.ts) and
 * from dragging empty ground (see input/pointer.ts).
 *
 * Tilt (beta) is fixed at ~52° off vertical for a strong 3D read of runways,
 * trees and planes; only alpha (heading) and zoom change at runtime.
 */
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { CAMERA_TILT, PAN_SPEED, ZOOM_MAX, ZOOM_MIN } from "../config";
import { panFraction, viewHalfHeight } from "../core/layout";
import type { Vec2, WorldSize } from "../core/types";

/** Distance from target; with ortho it only needs to clear the scene. */
const CAMERA_RADIUS = 400;
/** How quickly zoom eases towards its target (1 / seconds). */
const EASE_RATE = 10;
/** Slower ease for rotation so heading changes glide rather than snap. */
const ROTATE_EASE_RATE = 5;

export class CameraController {
  readonly camera: ArcRotateCamera;

  private world: WorldSize = { width: 1, height: 1 };
  private targetAlpha: number;
  private zoom = 1;
  private targetZoom = 1;
  /** Where the camera target is easing towards, in scene XZ (x, z). */
  private targetPan = { x: 0, z: 0 };

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    // alpha = -PI/2 puts the camera on the -z side looking towards +z.
    this.camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 2,
      CAMERA_TILT,
      CAMERA_RADIUS,
      Vector3.Zero(),
      scene,
    );
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 1;
    this.camera.maxZ = CAMERA_RADIUS * 2;
    // Lock the tilt: rotation only ever changes alpha, never beta.
    this.camera.lowerBetaLimit = CAMERA_TILT;
    this.camera.upperBetaLimit = CAMERA_TILT;
    this.targetAlpha = this.camera.alpha;

    // Mouse wheel zoom. passive:false so we can stop the page from scrolling.
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false },
    );
  }

  setWorld(world: WorldSize): void {
    this.world = world;
    // A resize can shrink the field under the current pan: pull it back in.
    clampToField(this.targetPan, this.world, this.zoom);
  }

  /** Queue a rotation around the vertical axis (radians, eased). */
  rotateBy(radians: number): void {
    this.targetAlpha += radians;
  }

  /** Multiply the zoom level (>1 zooms in), clamped to a sane range. */
  zoomBy(factor: number): void {
    this.targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.targetZoom * factor));
  }

  /**
   * Move the view for `dt` seconds in a screen-space direction (+x right,
   * +y up the screen, each in [-1, 1]), e.g. from held arrow keys. Eased.
   */
  panBy(direction: Vec2, dt: number): void {
    if (direction.x === 0 && direction.y === 0) return;
    // Speed in view half-heights per second: same on-screen speed at any zoom.
    const step = this.orthoHalfHeight() * PAN_SPEED * dt;
    const d = this.screenToGround(direction.x * step, direction.y * step);
    this.targetPan.x += d.x;
    this.targetPan.z += d.z;
    clampToField(this.targetPan, this.world, this.zoom);
  }

  /**
   * Grab-and-drag the map: the pointer moved by (dx, dy), measured in canvas
   * heights with +y DOWN the screen (DOM convention). Applied immediately,
   * not eased, so the ground stays pinned under the cursor.
   */
  dragBy(dx: number, dy: number): void {
    // The visible height spans 2 × the ortho half-height in world units.
    const scale = 2 * this.orthoHalfHeight();
    // Dragging the map right moves the camera left; dragging down (DOM +y)
    // moves the camera up the screen.
    const d = this.screenToGround(-dx * scale, dy * scale);
    const target = this.camera.target;
    target.x += d.x;
    target.z += d.z;
    clampToField(target, this.world, this.zoom);
    // Keep the eased goal in lockstep so nothing drifts after release.
    this.targetPan.x = target.x;
    this.targetPan.z = target.z;
  }

  /** Ease towards the target rotation/zoom/pan and refit the ortho frustum. */
  update(dt: number, aspect: number): void {
    // Exponential smoothing: frame-rate independent, unlike a fixed lerp factor.
    const kRotate = 1 - Math.exp(-ROTATE_EASE_RATE * dt);
    const kZoom = 1 - Math.exp(-EASE_RATE * dt);
    this.camera.alpha += (this.targetAlpha - this.camera.alpha) * kRotate;
    this.zoom += (this.targetZoom - this.zoom) * kZoom;
    // Zooming out shrinks how far the view may sit off-centre (see
    // `panFraction`): pull the pan back in as the zoom eases out.
    clampToField(this.targetPan, this.world, this.zoom);
    // Mutate the target in place: assigning `camera.target` calls setTarget,
    // which rebuilds alpha/beta from the old position and breaks the tilt lock.
    const target = this.camera.target;
    target.x += (this.targetPan.x - target.x) * kZoom;
    target.z += (this.targetPan.z - target.z) * kZoom;
    // Hard limit too, so the eased pan never lags outside the scenery map.
    clampToField(target, this.world, this.zoom);
    this.fit(aspect);
  }

  /** Current ortho half-height in world units (reflects the eased zoom). */
  private orthoHalfHeight(): number {
    return this.camera.orthoTop ?? 1;
  }

  /**
   * Convert a screen-space offset (world units as seen on screen, +x right,
   * +y up) into a ground (scene XZ) offset, using the CURRENT heading so "up"
   * always means away from the player however the view has been rotated.
   */
  private screenToGround(right: number, up: number): { x: number; z: number } {
    // The camera sits at (cos α, sin α) from its target on the ground plane,
    // looking back at it: "up the screen" is the opposite way, and screen
    // right is that rotated a quarter turn (Babylon is left-handed).
    const a = this.camera.alpha;
    // Ground depth is foreshortened by cos(tilt) on screen, so a given screen
    // distance up covers more ground than the same distance sideways.
    const forward = up / Math.cos(this.camera.beta);
    return {
      x: -Math.sin(a) * right - Math.cos(a) * forward,
      z: Math.cos(a) * right - Math.sin(a) * forward,
    };
  }

  /**
   * Size the orthographic frustum from `viewHalfHeight`, which frames the
   * airspace at the default heading. The scale depends on the world only,
   * never on alpha, so rotating never reads as a zoom. The sim sizes the
   * airspace independently of the view, so the dashed edge always sits
   * inside it at zoom 1.
   */
  private fit(aspect: number): void {
    const safeAspect = aspect > 0 ? aspect : 1;
    const halfH = viewHalfHeight(this.world, safeAspect) / this.zoom;
    const halfW = halfH * safeAspect;
    this.camera.orthoTop = halfH;
    this.camera.orthoBottom = -halfH;
    this.camera.orthoLeft = -halfW;
    this.camera.orthoRight = halfW;
  }
}

/**
 * Keep the centre of the view over the playfield (scene XZ is centred on the
 * field), within `panFraction(zoom)` of its half-size: the full field from
 * zoom 1 in, nothing at all fully zoomed out. The scenery map is sized for
 * exactly this (core/scenery.ts `mapBounds`), so its edge stays off screen.
 */
function clampToField(p: { x: number; z: number }, world: WorldSize, zoom: number): void {
  const f = panFraction(zoom);
  const halfW = (world.width / 2) * f;
  const halfH = (world.height / 2) * f;
  p.x = Math.min(halfW, Math.max(-halfW, p.x));
  p.z = Math.min(halfH, Math.max(-halfH, p.z));
}
