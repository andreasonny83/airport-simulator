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
import {
  COLOR_HEX,
  FLARE_DISTANCE,
  FLIGHT_ALTITUDE,
  LANDING_SPEED_START,
  MAX_TURN_RATE,
  PLANE_SPEED,
} from "../config";
import { angleDelta, lerp, normalizeAngle } from "../core/math";
import type { GameState, Plane, WorldSize } from "../core/types";
import { aircraftKindFor, animateAircraft, type AircraftRig } from "./aircraft";
import { AirfieldFactory, type AirfieldView } from "./airfield";
import { AirspaceBoundary } from "./boundary";
import { flightTuning } from "./flightTuning";
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
/**
 * The anchor ring confirms a locked path, then gets out of the way: fully
 * visible for `ANCHOR_RING_HOLD` seconds, then fading out over
 * `ANCHOR_RING_FADE` seconds. Redrawing and re-anchoring shows it again.
 */
export const ANCHOR_RING_HOLD = 2;
export const ANCHOR_RING_FADE = 0.8;
/** Height of a plane on the ground (sitting on its wheels on the runway). */
const RUNWAY_ALTITUDE = 0.35;

/** Fraction of the way to a target that exponential easing covers in `dt`. */
function ease(dt: number, tau: number): number {
  return 1 - Math.exp(-dt / tau);
}

interface PlaneView {
  /** The plane's model: root mesh plus its animated parts. */
  aircraft: AircraftRig;
  ring: Mesh;
  /** Green ring on the threshold, briefly, once this plane's path anchors. */
  anchorRing: Mesh;
  /** Seconds since the path anchored (ring's age), or null while unanchored. */
  anchorAge: number | null;
  path: Mesh | null;
  /** `plane.pathVersion` the current path line was built from. */
  pathVersion: number;
  /** Displayed yaw, eased towards heading + wind crab (null until first sync). */
  yaw: number | null;
  /** Displayed bank angle (radians, positive = right wing down). */
  bank: number;
  /** True once moved to the default rendering group on touchdown. */
  grounded: boolean;
}

export class SceneSync {
  private readonly views = new Map<number, PlaneView>();
  private runwayViews: RunwayView[] = [];
  private airfieldViews: AirfieldView[] = [];
  private readonly landscape: Landscape;
  private readonly runwayFactory: RunwayFactory;
  private readonly airfieldFactory: AirfieldFactory;
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
    this.airfieldFactory = new AirfieldFactory(scene, (color) => factory.material(color), shadows);
    this.boundary = new AirspaceBoundary(scene);
  }

  /** Show the airspace border while a path drag is past it (the no-collision zone). */
  setEdgeHighlight(active: boolean): void {
    this.boundary.setActive(active);
  }

  /** Build static geometry (landscape, runways, taxiways, hangars) for the world. */
  rebuildWorld(state: GameState): void {
    fitShadowsToWorld(this.shadows, state.world);
    this.landscape.setWorld(state.world, state.runways);
    for (const view of this.runwayViews) view.dispose();
    this.runwayViews = state.runways.map((r) =>
      this.runwayFactory.create(r, state.world, state.runways),
    );
    for (const view of this.airfieldViews) view.dispose();
    this.airfieldViews = state.runways.map((r) => this.airfieldFactory.create(r, state.world));
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
        const aircraft = this.factory.createAircraft(
          aircraftKindFor(plane.id),
          plane.color,
          plane.id,
          `plane-${plane.id}`,
        );
        view = {
          aircraft,
          ring: this.factory.createWarningRing(`ring-${plane.id}`),
          anchorRing: this.factory.createAnchorRing(`anchor-${plane.id}`),
          anchorAge: null,
          path: null,
          pathVersion: -1,
          yaw: null,
          bank: 0,
          grounded: false,
        };
        this.views.set(plane.id, view);
        // Solid parts only: prop blur discs and lights cast no shadow.
        for (const mesh of aircraft.shadowCasters) this.shadows.addShadowCaster(mesh, false);
      }
      this.updateView(view, plane, state.world, time, dt);
    }

    for (const [id, view] of this.views) {
      if (alive.has(id)) continue;
      for (const mesh of view.aircraft.shadowCasters) this.shadows.removeShadowCaster(mesh, false);
      this.factory.disposeAircraft(view.aircraft);
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
    const ground = plane.ground;

    // Altitude: cruise, then settle onto the runway over the first few units
    // rolled after touchdown.
    const descent = ground ? Math.min(1, ground.travelled / FLARE_DISTANCE) : 0;
    const altitude = lerp(FLIGHT_ALTITUDE, RUNWAY_ALTITUDE, descent);

    // On the ground, draw with the scenery (depth-tested) rather than on top
    // of it, so a plane rolling into its hangar disappears behind the walls.
    if (ground && !view.grounded) {
      view.grounded = true;
      for (const mesh of view.aircraft.all) mesh.renderingGroupId = 0;
    }

    // Visual-only wind, fading out as the wheels touch the runway. The
    // offset is applied to the mesh only: the sim position never moves.
    const wind = windEffect(time, plane.id, plane.heading, 1 - descent);
    const root = view.aircraft.root;
    this.placeOverTrack(plane, world, altitude, root.position);
    root.position.x += wind.drift.x;
    root.position.z -= wind.drift.y; // sim +y is scene -z (see coords.ts)
    root.position.y += wind.lift;

    // Yaw: heading plus crab into the wind, eased the short way round.
    const targetYaw = plane.heading + wind.crab;
    view.yaw =
      view.yaw === null
        ? targetYaw
        : normalizeAngle(
            view.yaw + angleDelta(view.yaw, targetYaw) * ease(dt, flightTuning.yawEase),
          );
    // Bank into turns in proportion to the sim turn rate. A positive turn
    // rate turns the nose to the plane's right, and rolling the right wing
    // down is a negative rotation about the nose (+x) axis.
    const targetBank = (plane.turnRate / MAX_TURN_RATE) * flightTuning.maxBank;
    view.bank += (targetBank - view.bank) * ease(dt, flightTuning.bankEase);
    root.rotation.set(
      -(view.bank + wind.roll), // roll about the nose
      headingToRotationY(view.yaw),
      wind.pitch,
    );
    // Moving parts: wing flex, prop spin, strobes. Props wind down as the
    // plane slows, to an idle on the stand.
    const touchdownSpeed = PLANE_SPEED * LANDING_SPEED_START;
    animateAircraft(view.aircraft, {
      time,
      dt,
      bank: view.bank,
      chop: wind.chop,
      rollout: ground ? 1 - Math.min(1, ground.speed / touchdownSpeed) : 0,
    });

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
    // as a short-lived confirmation, see ANCHOR_RING_HOLD. The age restarts
    // whenever the path (re-)anchors; `dt` is 0 while paused, so a paused
    // ring holds its fade.
    const anchorEnd = plane.pathAnchored ? plane.path[plane.path.length - 1] : undefined;
    view.anchorAge = anchorEnd ? (view.anchorAge ?? -dt) + dt : null;
    const fade =
      view.anchorAge === null
        ? 0
        : 1 - Math.min(1, Math.max(0, view.anchorAge - ANCHOR_RING_HOLD) / ANCHOR_RING_FADE);
    view.anchorRing.setEnabled(anchorEnd !== undefined && fade > 0);
    if (anchorEnd && fade > 0) {
      toScene(anchorEnd, world, ANCHOR_RING_ALTITUDE, view.anchorRing.position);
      // Gentle breathing so it reads as "live" without competing with warnings.
      const s = 1 + 0.06 * Math.sin(time * 4);
      view.anchorRing.scaling.set(s, 1, s);
      // Ease out (quadratic): the ring dims quickly at first, then lingers.
      view.anchorRing.visibility = fade * fade;
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
