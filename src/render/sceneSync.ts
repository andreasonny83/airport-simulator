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
import { COLOR_HEX, FLIGHT_ALTITUDE } from "../config";
import { lerp } from "../core/math";
import type { GameState, Plane, WorldSize } from "../core/types";
import { headingToRotationY, toScene } from "./coords";
import { Landscape } from "./landscape";
import type { MeshFactory } from "./meshes";
import { RunwayFactory, type RunwayView } from "./runway";
import { fitShadowsToWorld, OVERLAY_GROUP } from "./scene";

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
/** Height planes finish their rollout at (sitting on the runway). */
const RUNWAY_ALTITUDE = 0.35;

interface PlaneView {
  mesh: Mesh;
  ring: Mesh;
  path: Mesh | null;
  /** `plane.pathVersion` the current path line was built from. */
  pathVersion: number;
}

export class SceneSync {
  private readonly views = new Map<number, PlaneView>();
  private runwayViews: RunwayView[] = [];
  private readonly landscape: Landscape;
  private readonly runwayFactory: RunwayFactory;
  /** Camera view direction, refreshed every sync (see `placeOverTrack`). */
  private readonly viewDir = new Vector3(0, -1, 0);

  constructor(
    private readonly scene: Scene,
    private readonly factory: MeshFactory,
    private readonly shadows: ShadowGenerator,
  ) {
    this.landscape = new Landscape(scene, shadows);
    this.runwayFactory = new RunwayFactory(scene, (color) => factory.material(color));
  }

  /** Rebuild static geometry (landscape, runways) after a resize. */
  rebuildWorld(state: GameState): void {
    fitShadowsToWorld(this.shadows, state.world);
    this.landscape.setWorld(state.world, state.runways);
    for (const view of this.runwayViews) view.dispose();
    this.runwayViews = state.runways.map((r) => this.runwayFactory.create(r, state.world));
    // Path lines were built with the old world→scene mapping; force a rebuild.
    for (const view of this.views.values()) view.pathVersion = -1;
  }

  /** Create/update/dispose plane meshes to match `state.planes`. */
  syncPlanes(state: GameState, time: number): void {
    this.landscape.update(time);
    for (const runway of this.runwayViews) runway.update(time);
    this.scene.activeCamera?.getDirectionToRef(Axis.Z, this.viewDir);
    const alive = new Set<number>();
    for (const plane of state.planes) {
      alive.add(plane.id);
      let view = this.views.get(plane.id);
      if (!view) {
        view = {
          mesh: this.factory.createPlane(plane.color, `plane-${plane.id}`),
          ring: this.factory.createWarningRing(`ring-${plane.id}`),
          path: null,
          pathVersion: -1,
        };
        this.views.set(plane.id, view);
        this.shadows.addShadowCaster(view.mesh);
      }
      this.updateView(view, plane, state.world, time);
    }

    for (const [id, view] of this.views) {
      if (alive.has(id)) continue;
      this.shadows.removeShadowCaster(view.mesh);
      view.mesh.dispose();
      view.ring.dispose();
      view.path?.dispose(false, true);
      this.views.delete(id);
    }
  }

  private updateView(view: PlaneView, plane: Plane, world: WorldSize, time: number): void {
    const landing = plane.phase !== "flying";
    const t = plane.landingProgress;

    // Altitude: cruise, then descend onto the runway during the first third
    // of the rollout.
    const altitude = landing
      ? lerp(FLIGHT_ALTITUDE, RUNWAY_ALTITUDE, Math.min(1, t * 3))
      : FLIGHT_ALTITUDE;
    this.placeOverTrack(plane, world, altitude, view.mesh.position);
    view.mesh.rotation.y = headingToRotationY(plane.heading);
    // Fade out over the second half of the rollout.
    view.mesh.visibility = landing ? 1 - Math.max(0, (t - 0.5) * 2) : 1;

    // Proximity warning ring, pulsing.
    const warn = plane.warning && !landing;
    view.ring.setEnabled(warn);
    if (warn) {
      this.placeOverTrack(plane, world, altitude, view.ring.position);
      view.ring.visibility = 0.55 + 0.45 * Math.sin(time * 12);
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
