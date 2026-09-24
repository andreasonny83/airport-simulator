/**
 * Tilted orthographic camera with button-driven rotate/zoom.
 *
 * The camera is deliberately NOT attached to pointer input: every drag on the
 * canvas draws a flight path. Rotation and zoom come from HUD buttons and the
 * mouse wheel only.
 *
 * Tilt (beta) is fixed at ~52° off vertical for a strong 3D read of runways,
 * trees and planes; only alpha (heading) and zoom change at runtime.
 */
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import { FLIGHT_ALTITUDE } from "../config";
import type { WorldSize } from "../core/types";

/** Tilt from straight-down (radians). 0 = top-down radar view; 0.9 ≈ 52°. */
const TILT = 0.9;
/** Distance from target; with ortho it only needs to clear the scene. */
const CAMERA_RADIUS = 400;
/** Extra margin around the playfield when fitting the view. */
const FIT_PADDING = 1.04;
/** Lowest zoom shows ~2× the playfield; the landscape map is sized to cover it. */
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 2.5;
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

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    // alpha = -PI/2 puts the camera on the -z side looking towards +z.
    this.camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 2,
      TILT,
      CAMERA_RADIUS,
      Vector3.Zero(),
      scene,
    );
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    this.camera.minZ = 1;
    this.camera.maxZ = CAMERA_RADIUS * 2;
    // Lock the tilt: rotation only ever changes alpha, never beta.
    this.camera.lowerBetaLimit = TILT;
    this.camera.upperBetaLimit = TILT;
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
  }

  /** Queue a rotation around the vertical axis (radians, eased). */
  rotateBy(radians: number): void {
    this.targetAlpha += radians;
  }

  /** Multiply the zoom level (>1 zooms in), clamped to a sane range. */
  zoomBy(factor: number): void {
    this.targetZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.targetZoom * factor));
  }

  /** Ease towards the target rotation/zoom and refit the ortho frustum. */
  update(dt: number, aspect: number): void {
    // Exponential smoothing: frame-rate independent, unlike a fixed lerp factor.
    const kRotate = 1 - Math.exp(-ROTATE_EASE_RATE * dt);
    const kZoom = 1 - Math.exp(-EASE_RATE * dt);
    this.camera.alpha += (this.targetAlpha - this.camera.alpha) * kRotate;
    this.zoom += (this.targetZoom - this.zoom) * kZoom;
    this.fit(aspect);
  }

  /**
   * Size the orthographic frustum so the whole playfield stays visible at
   * EVERY heading, with a scale that never changes while rotating.
   *
   * Fitting the field's rectangle at the current alpha would make the frustum
   * grow and shrink mid-spin (the rotated rectangle's screen bounding box
   * changes with heading), which reads as an unwanted zoom. Instead we fit the
   * field's bounding circle, which projects identically at any alpha:
   * - screen X: a ground point `r` from the centre spans at most ±r;
   * - screen Y: ground distance is foreshortened by cos(tilt), and altitude
   *   adds up to FLIGHT_ALTITUDE · sin(tilt).
   * Alpha therefore never appears here: only tilt, world size, aspect, zoom.
   */
  private fit(aspect: number): void {
    const r = Math.hypot(this.world.width / 2, this.world.height / 2);
    const maxX = r;
    const maxY = r * Math.cos(TILT) + FLIGHT_ALTITUDE * Math.sin(TILT);

    const safeAspect = aspect > 0 ? aspect : 1;
    const halfH = (Math.max(maxY, maxX / safeAspect) * FIT_PADDING) / this.zoom;
    const halfW = halfH * safeAspect;
    this.camera.orthoTop = halfH;
    this.camera.orthoBottom = -halfH;
    this.camera.orthoLeft = -halfW;
    this.camera.orthoRight = halfW;
  }
}
