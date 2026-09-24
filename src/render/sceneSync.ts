/**
 * Keeps Babylon meshes in step with the (read-only) game state.
 *
 * Meshes are matched to planes by id: new ids get meshes, missing ids have
 * theirs disposed. The simulation never touches Babylon objects.
 */
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Material } from "@babylonjs/core/Materials/material";
import { Axis } from "@babylonjs/core/Maths/math.axis";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGreasedLine } from "@babylonjs/core/Meshes/Builders/greasedLineBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { COLOR_HEX, FLIGHT_ALTITUDE, MAX_BANK, MAX_TURN_RATE } from "../config";
import { angleDelta, lerp, normalizeAngle } from "../core/math";
import type { GameState, Plane, WorldSize } from "../core/types";
import { AirspaceBoundary } from "./boundary";
import { headingToRotationY, toScene } from "./coords";
import { Landscape } from "./landscape";
import type { MeshFactory } from "./meshes";
import { RunwayFactory, type RunwayView } from "./runway";
import { fitShadowsToWorld, OVERLAY_GROUP } from "./scene";
import { windEffect } from "./wind";

/**
 * Height of drawn path lines: just above the ground, where the pointer
 * projects to and the runways are. Planes are drawn over their ground track
 * (see `placeOverTrack`), so the line still runs right under each plane.
 */
const PATH_ALTITUDE = 0.15;
/**
 * Path line width in world units (not pixels: the line scales with zoom).
 * ~6 px at the default 720p view; thinner lines vanish against the grass.
 */
const PATH_WIDTH = 0.5;
/** Path line opacity: solid enough to read, still showing the ground below. */
const PATH_ALPHA = 0.85;
/** Height of the green anchor ring: on the ground, just over the runway paint. */
const ANCHOR_RING_ALTITUDE = 0.2;
/** Height planes finish their rollout at (sitting on the runway). */
const RUNWAY_ALTITUDE = 0.35;
/**
 * Easing time constants (seconds) for the displayed yaw and bank. The sim
 * heading is already smooth in flight; the yaw easing only hides the small
 * snap onto the runway heading at touchdown, so it stays short to avoid
 * visible lag in turns. Bank eases more slowly, so the wings level off
 * gracefully after landing.
 */
const YAW_EASE = 0.05;
const BANK_EASE = 0.2;

/** Fraction of the way to a target that exponential easing covers in `dt`. */
function ease(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

interface PlaneView {
  mesh: Mesh;
  ring: Mesh;
  /** Green ring on the threshold while this plane's path is anchored. */
  anchorRing: Mesh;
  path: Mesh | null;
  /** `plane.pathVersion` the current path line was built from. */
  pathVersion: number;
  /** Displayed yaw, eased towards heading + wind crab (null until first sync). */
  yaw: number | null;
  /** Displayed bank angle (radians, positive = right wing down). */
  bank: number;
}

export class SceneSync {
  private readonly views = new Map<number, PlaneView>();
  private runwayViews: RunwayView[] = [];
  private readonly landscape: Landscape;
  private readonly runwayFactory: RunwayFactory;
  private readonly boundary: AirspaceBoundary;
  /** Camera view direction, refreshed every sync (see `placeOverTrack`). */
  private readonly viewDir = new Vector3(0, -1, 0);
  /** `time` of the previous sync, for frame-to-frame easing. */
  private lastTime: number | null = null;

  constructor(
    private readonly scene: Scene,
    private readonly factory: MeshFactory,
    private readonly shadows: ShadowGenerator,
  ) {
    this.landscape = new Landscape(scene, shadows);
    this.runwayFactory = new RunwayFactory(scene, (color) => factory.material(color));
    this.boundary = new AirspaceBoundary(scene);
  }

  /** Show the airspace border while a drag is pressing past it. */
  setEdgeHighlight(active: boolean): void {
    this.boundary.setActive(active);
  }

  /** Rebuild static geometry (landscape, runways) after a resize. */
  rebuildWorld(state: GameState): void {
    fitShadowsToWorld(this.shadows, state.world);
    this.landscape.setWorld(state.world, state.runways);
    for (const view of this.runwayViews) view.dispose();
    this.runwayViews = state.runways.map((r) => this.runwayFactory.create(r, state.world));
    this.boundary.setWorld(state.world);
    // Path lines were built with the old world→scene mapping; force a rebuild.
    for (const view of this.views.values()) view.pathVersion = -1;
  }

  /** Create/update/dispose plane meshes to match `state.planes`. */
  syncPlanes(state: GameState, time: number): void {
    this.landscape.update(time);
    for (const runway of this.runwayViews) runway.update(time);
    this.scene.activeCamera?.getDirectionToRef(Axis.Z, this.viewDir);
    // `time` stands still while paused, so the easing freezes along with it.
    const dt = this.lastTime === null ? 0 : Math.max(0, time - this.lastTime);
    this.lastTime = time;
    this.boundary.update(dt);
    const alive = new Set<number>();
    for (const plane of state.planes) {
      alive.add(plane.id);
      let view = this.views.get(plane.id);
      if (!view) {
        view = {
          mesh: this.factory.createPlane(plane.color, `plane-${plane.id}`),
          ring: this.factory.createWarningRing(`ring-${plane.id}`),
          anchorRing: this.factory.createAnchorRing(`anchor-${plane.id}`),
          path: null,
          pathVersion: -1,
          yaw: null,
          bank: 0,
        };
        this.views.set(plane.id, view);
        this.shadows.addShadowCaster(view.mesh);
      }
      this.updateView(view, plane, state.world, time, dt);
    }

    for (const [id, view] of this.views) {
      if (alive.has(id)) continue;
      this.shadows.removeShadowCaster(view.mesh);
      view.mesh.dispose();
      view.ring.dispose();
      view.anchorRing.dispose();
      view.path?.dispose(false, true);
      this.views.delete(id);
    }
  }

  private updateView(
    view: PlaneView,
    plane: Plane,
    world: WorldSize,
    time: number,
    dt: number,
  ): void {
    const landing = plane.phase === "landing" || plane.phase === "landed";
    const t = plane.landingProgress;

    // Altitude: cruise, then descend onto the runway during the first third
    // of the rollout.
    const descent = landing ? Math.min(1, t * 3) : 0;
    const altitude = lerp(FLIGHT_ALTITUDE, RUNWAY_ALTITUDE, descent);

    // Visual-only wind, fading out as the wheels touch the runway. The
    // offset is applied to the mesh only: the sim position never moves.
    const wind = windEffect(time, plane.id, plane.heading, 1 - descent);
    this.placeOverTrack(plane, world, altitude, view.mesh.position);
    view.mesh.position.x += wind.drift.x;
    view.mesh.position.z -= wind.drift.y; // sim +y is scene -z (see coords.ts)
    view.mesh.position.y += wind.lift;

    // Yaw: heading plus crab into the wind, eased the short way round.
    const targetYaw = plane.heading + wind.crab;
    view.yaw =
      view.yaw === null
        ? targetYaw
        : normalizeAngle(view.yaw + angleDelta(view.yaw, targetYaw) * ease(dt, YAW_EASE));
    // Bank into turns in proportion to the sim turn rate. A positive turn
    // rate turns the nose to the plane's right, and rolling the right wing
    // down is a negative rotation about the nose (+x) axis.
    const targetBank = (plane.turnRate / MAX_TURN_RATE) * MAX_BANK;
    view.bank += (targetBank - view.bank) * ease(dt, BANK_EASE);
    view.mesh.rotation.set(
      -(view.bank + wind.roll), // roll about the nose
      headingToRotationY(view.yaw),
      wind.pitch,
    );
    // Fade out over the second half of the rollout. Departing planes stay
    // opaque: they simply fly out of view.
    view.mesh.visibility = landing ? 1 - Math.max(0, (t - 0.5) * 2) : 1;

    // Proximity warning ring, pulsing.
    const warn = plane.warning && plane.phase === "flying";
    view.ring.setEnabled(warn);
    if (warn) {
      this.placeOverTrack(plane, world, altitude, view.ring.position);
      // Follow the plane's wind drift, so the ring stays centred on it.
      view.ring.position.x += wind.drift.x;
      view.ring.position.z -= wind.drift.y;
      view.ring.visibility = 0.55 + 0.45 * Math.sin(time * 12);
    }

    // Anchor ring: sits on the threshold (the anchored path's last point)
    // until the plane lands or the player redraws the path.
    const anchorEnd = plane.pathAnchored ? plane.path[plane.path.length - 1] : undefined;
    view.anchorRing.setEnabled(anchorEnd !== undefined);
    if (anchorEnd) {
      toScene(anchorEnd, world, ANCHOR_RING_ALTITUDE, view.anchorRing.position);
      // Gentle breathing so it reads as "live" without competing with warnings.
      const s = 1 + 0.06 * Math.sin(time * 4);
      view.anchorRing.scaling.set(s, 1, s);
    }

    if (view.pathVersion !== plane.pathVersion) this.rebuildPath(view, plane, world);
  }

  /**
   * Scene position for something flying `altitude` above `plane.pos` that
   * still appears on screen exactly over its ground track.
   *
   * The camera is orthographic and tilted, so a mesh straight above its sim
   * position would show up `altitude · sin(tilt)` further up the screen than
   * the ground point: away from the finger drawing its path and from the
   * path line itself. In an orthographic view, sliding a point along the view
   * direction doesn't move it on screen, so we start on the ground and slide
   * towards the camera until we reach `altitude`. The plane keeps its height
   * (shadows and depth still read as airborne) but lines up with the ground,
   * where input, paths and runway thresholds all live.
   */
  private placeOverTrack(plane: Plane, world: WorldSize, altitude: number, ref: Vector3): void {
    toScene(plane.pos, world, 0, ref);
    const dir = this.viewDir;
    // A camera looking at the ground has dir.y < 0; guard against a
    // horizontal view (no ground intersection) just in case.
    if (dir.y > -1e-3) {
      ref.y = altitude;
      return;
    }
    const t = altitude / dir.y; // negative: back towards the camera
    ref.set(ref.x + dir.x * t, altitude, ref.z + dir.z * t);
  }

  /**
   * Rebuild the path line. Only runs when the path changes (point added or
   * waypoint consumed), not every frame. The line starts at the plane's
   * position at rebuild time, which is at most one path spacing stale.
   */
  private rebuildPath(view: PlaneView, plane: Plane, world: WorldSize): void {
    // Each greased line gets its own material: dispose it too, or every
    // path point drawn leaks one.
    view.path?.dispose(false, true);
    view.path = null;
    view.pathVersion = plane.pathVersion;
    if (plane.path.length === 0 || plane.phase !== "flying") return;

    const points = [plane.pos, ...plane.path].map((p) => toScene(p, world, PATH_ALTITUDE));
    const line = CreateGreasedLine(
      `path-${plane.id}`,
      { points, updatable: true },
      {
        color: Color3.FromHexString(COLOR_HEX[plane.color]),
        width: PATH_WIDTH,
        dashCount: 1,
        dashRatio: 0.5,
      },
      this.scene,
    );
    line.material!.alpha = PATH_ALPHA;
    line.material!.transparencyMode = Material.MATERIAL_ALPHABLEND;

    line.isPickable = false;
    line.renderingGroupId = OVERLAY_GROUP; // stays visible over trees
    view.path = line;
  }
}
