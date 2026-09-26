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
 *
 * Crash cinematic: `focusOn` takes the camera over a crash site, zooms in and
 * starts a slow 360° orbit round it; `release` eases back to the default
 * view for the next shift. While focused, the cinematic owns heading and pan
 * (rotate buttons, arrow keys and map drags are ignored); wheel/button zoom
 * still works, but never out past the default view.
 */
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";
import {
  CAMERA_TILT,
  CRASH_FRAME_LIFT,
  CRASH_ORBIT_PERIOD,
  CRASH_ORBIT_RAMP,
  CRASH_ZOOM,
  PAN_SPEED,
  ZOOM_MAX,
  ZOOM_MIN,
} from "../config";
import { panFraction, safeViewAspect, viewHalfHeight } from "../core/layout";
import { angleDelta, normalizeAngle } from "../core/math";
import type { Vec2, WorldSize } from "../core/types";

/** Distance from target; with ortho it only needs to clear the scene. */
const CAMERA_RADIUS = 400;
/** How quickly zoom eases towards its target (1 / seconds). */
const EASE_RATE = 10;
/** Slower ease for rotation so heading changes glide rather than snap. */
const ROTATE_EASE_RATE = 5;
/** Default heading: camera on the -z side looking towards +z (sim "up"). */
const DEFAULT_ALPHA = -Math.PI / 2;
/**
 * Ease rate for panning onto a crash site: slower than `EASE_RATE`, so the
 * glide over reads as a deliberate camera move rather than a jump cut.
 */
const FOCUS_EASE_RATE = 3;

export class CameraController {
  readonly camera: ArcRotateCamera;

  private world: WorldSize = { width: 1, height: 1 };
  private targetAlpha: number;
  private zoom = 1;
  private targetZoom = 1;
  /** Where the camera target is easing towards, in scene XZ (x, z). */
  private targetPan = { x: 0, z: 0 };
  /** Seconds since `focusOn`, while a crash cinematic runs; null otherwise. */
  private focusAge: number | null = null;
  /** The crash site being orbited (scene XZ), read live every frame. */
  private focusSite: { readonly x: number; readonly z: number } | null = null;
  /**
   * True from `focusOn` until the view is back inside the playfield after
   * `release`. A crash site can sit in the view frame's margin, past the pan
   * limit: skipping the hard clamp meanwhile lets the view glide back
   * instead of snapping to the limit on release.
   */
  private unclamped = false;

  constructor(scene: Scene, canvas: HTMLCanvasElement) {
    // alpha = -PI/2 puts the camera on the -z side looking towards +z.
    this.camera = new ArcRotateCamera(
      "camera",
      DEFAULT_ALPHA,
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
    // A new world can be smaller than the current pan: pull it back in.
    clampToField(this.targetPan, this.world, this.zoom);
  }

  /** True while a crash cinematic holds the camera (see `focusOn`). */
  get focused(): boolean {
    return this.focusAge !== null;
  }

  /**
   * Start the crash cinematic: glide over `site` (scene XZ; y is ignored),
   * zoom in to `CRASH_ZOOM` and orbit it slowly until `release`. `site` is
   * read every frame, so a moving point (wreckage still sliding) is tracked.
   */
  focusOn(site: { readonly x: number; readonly z: number }): void {
    this.focusAge = 0;
    this.focusSite = site;
    this.unclamped = true;
    // Never zoom *out* to reach the crash: a player already zoomed in
    // closer keeps their zoom.
    this.targetZoom = Math.min(ZOOM_MAX, Math.max(CRASH_ZOOM, this.targetZoom));
    // Settle any rotation still queued from the buttons: the orbit takes over
    // from wherever the heading is now.
    this.targetAlpha = this.camera.alpha;
  }

  /** End the crash cinematic and ease back to the default view. */
  release(): void {
    if (this.focusAge === null) return;
    this.focusAge = null;
    this.focusSite = null;
    this.targetZoom = 1;
    this.targetPan = { x: 0, z: 0 };
    // The orbit may have wound alpha up by several turns: unwind it to the
    // equivalent angle, then turn back to the default heading the short way.
    this.camera.alpha = normalizeAngle(this.camera.alpha);
    this.targetAlpha = this.camera.alpha + angleDelta(this.camera.alpha, DEFAULT_ALPHA);
  }

  /** Queue a rotation around the vertical axis (radians, eased). */
  rotateBy(radians: number): void {
    if (this.focused) return; // the orbit owns the heading
    this.targetAlpha += radians;
  }

  /**
   * Multiply the zoom level (>1 zooms in), clamped to a sane range. While
   * focused on a crash, never out past the default view: the site may sit
   * off-centre, where a wide view would reach the scenery map's edge.
   */
  zoomBy(factor: number): void {
    const min = this.focused ? 1 : ZOOM_MIN;
    this.targetZoom = Math.min(ZOOM_MAX, Math.max(min, this.targetZoom * factor));
  }

  /**
   * Move the view for `dt` seconds in a screen-space direction (+x right,
   * +y up the screen, each in [-1, 1]), e.g. from held arrow keys. Eased.
   */
  panBy(direction: Vec2, dt: number): void {
    if (this.focused || (direction.x === 0 && direction.y === 0)) return;
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
    if (this.focused) return; // the crash site stays centred
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
    if (this.focusAge !== null) this.orbit(dt);
    // Exponential smoothing: frame-rate independent, unlike a fixed lerp factor.
    const kRotate = 1 - Math.exp(-ROTATE_EASE_RATE * dt);
    const kZoom = 1 - Math.exp(-EASE_RATE * dt);
    // Gliding to or from a crash site pans at the slower focus rate.
    const kPan = this.unclamped ? 1 - Math.exp(-FOCUS_EASE_RATE * dt) : kZoom;
    this.camera.alpha += (this.targetAlpha - this.camera.alpha) * kRotate;
    this.zoom += (this.targetZoom - this.zoom) * kZoom;
    // Zooming out shrinks how far the view may sit off-centre (see
    // `panFraction`): pull the pan back in as the zoom eases out. Not while
    // focused: the crash site is the goal, wherever it is.
    if (!this.focused) clampToField(this.targetPan, this.world, this.zoom);
    // Mutate the target in place: assigning `camera.target` calls setTarget,
    // which rebuilds alpha/beta from the old position and breaks the tilt lock.
    const target = this.camera.target;
    target.x += (this.targetPan.x - target.x) * kPan;
    target.z += (this.targetPan.z - target.z) * kPan;
    // Back inside the pan limit after a cinematic: normal rules resume.
    if (this.unclamped && !this.focused && isInField(target, this.world, this.zoom)) {
      this.unclamped = false;
    }
    // Hard limit too, so the eased pan never lags outside the scenery map.
    if (!this.unclamped) clampToField(target, this.world, this.zoom);
    this.fit(aspect);
  }

  /**
   * Advance the crash orbit: spin the target heading at an angular speed
   * that ramps smoothly (smoothstep) from 0 to one turn per
   * `CRASH_ORBIT_PERIOD`. The alpha ease in `update` smooths it further.
   *
   * The pan goal follows the site, offset down the screen by
   * `CRASH_FRAME_LIFT` so the site itself shows above the centre. The offset
   * uses the current heading, so it turns with the orbit.
   */
  private orbit(dt: number): void {
    const age = (this.focusAge ?? 0) + dt;
    this.focusAge = age;
    const r = Math.min(1, age / CRASH_ORBIT_RAMP);
    const ramp = r * r * (3 - 2 * r);
    this.targetAlpha += ((2 * Math.PI) / CRASH_ORBIT_PERIOD) * ramp * dt;
    if (this.focusSite) {
      // Measured against the zoom being eased to, so the framing is right
      // once the zoom-in lands rather than drifting while it does.
      const halfH = (this.orthoHalfHeight() * this.zoom) / this.targetZoom;
      const lift = this.screenToGround(0, -CRASH_FRAME_LIFT * halfH);
      this.targetPan.x = this.focusSite.x + lift.x;
      this.targetPan.z = this.focusSite.z + lift.z;
    }
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
   * whole world (see `viewFrameBounds`) at the default heading. The scale
   * depends on the world only, never on alpha, so rotating never reads as a
   * zoom. The world never changes on a window resize: only the frustum's
   * shape follows the window, showing more ground round it.
   */
  private fit(aspect: number): void {
    const safeAspect = safeViewAspect(aspect);
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

/** True if `clampToField` would leave `p` where it is. */
function isInField(p: { x: number; z: number }, world: WorldSize, zoom: number): boolean {
  const q = { x: p.x, z: p.z };
  clampToField(q, world, zoom);
  return q.x === p.x && q.z === p.z;
}
