/**
 * Keeps Babylon meshes in step with the (read-only) game state.
 *
 * Meshes are matched to planes by id: new ids get meshes, missing ids have
 * theirs disposed. The simulation never touches Babylon objects.
 */
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateLines } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
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

/** Height of drawn path lines: on the ground, like a shadow of the route. */
const PATH_ALTITUDE = 0.15;
/** Height planes finish their rollout at (sitting on the runway). */
const RUNWAY_ALTITUDE = 0.35;

interface PlaneView {
  mesh: Mesh;
  ring: Mesh;
  path: LinesMesh | null;
  /** `plane.pathVersion` the current path line was built from. */
  pathVersion: number;
}

export class SceneSync {
  private readonly views = new Map<number, PlaneView>();
  private runwayViews: RunwayView[] = [];
  private readonly landscape: Landscape;
  private readonly runwayFactory: RunwayFactory;

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
      view.path?.dispose();
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
    toScene(plane.pos, world, altitude, view.mesh.position);
    view.mesh.rotation.y = headingToRotationY(plane.heading);
    // Fade out over the second half of the rollout.
    view.mesh.visibility = landing ? 1 - Math.max(0, (t - 0.5) * 2) : 1;

    // Proximity warning ring, pulsing.
    const warn = plane.warning && !landing;
    view.ring.setEnabled(warn);
    if (warn) {
      toScene(plane.pos, world, altitude, view.ring.position);
      view.ring.visibility = 0.55 + 0.45 * Math.sin(time * 12);
    }

    if (view.pathVersion !== plane.pathVersion) this.rebuildPath(view, plane, world);
  }

  /**
   * Rebuild the path line. Only runs when the path changes (point added or
   * waypoint consumed), not every frame. The line starts at the plane's
   * position at rebuild time, which is at most one path spacing stale.
   */
  private rebuildPath(view: PlaneView, plane: Plane, world: WorldSize): void {
    view.path?.dispose();
    view.path = null;
    view.pathVersion = plane.pathVersion;
    if (plane.path.length === 0 || plane.phase !== "flying") return;

    const points = [plane.pos, ...plane.path].map((p) => toScene(p, world, PATH_ALTITUDE));
    const line = CreateLines(`path-${plane.id}`, { points }, this.scene);
    line.color = Color3.FromHexString(COLOR_HEX[plane.color]);
    line.alpha = 0.8;
    line.isPickable = false;
    line.renderingGroupId = OVERLAY_GROUP; // stays visible over trees
    view.path = line;
  }
}
