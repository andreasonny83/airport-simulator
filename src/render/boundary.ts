/**
 * Airspace boundary: a dashed outline along the airspace edge (see
 * `airspaceBounds` in core/layout.ts). A development aid only: players
 * never see the edge, since what happens outside it takes care of itself.
 * The game draws it when `DEBUG_SHOW_AIRSPACE` is on, to help decide where
 * the edge should go (tune `AIRSPACE_MARGIN`); the airfield stories can
 * toggle it too.
 */
import { Material } from "@babylonjs/core/Materials/material";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateGreasedLine } from "@babylonjs/core/Meshes/Builders/greasedLineBuilder";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { airspaceBounds } from "../core/layout";
import type { WorldSize } from "../core/types";
import { toScene } from "./coords";
import { OVERLAY_GROUP } from "./scene";

/** Just above the path lines, so the border reads on top where they meet. */
const BOUNDARY_ALTITUDE = 0.2;
/** Line width in world units (slightly thinner than a path line). */
const BOUNDARY_WIDTH = 0.4;
/** Magenta: a debug colour nothing else in the scene uses. */
const BOUNDARY_COLOR = "#f0abfc";
const BOUNDARY_ALPHA = 0.9;
/** One dash + gap every this many world units along the border. */
const DASH_SPACING = 3;

export class AirspaceBoundary {
  private line: Mesh | null = null;
  private visible = false;

  constructor(private readonly scene: Scene) {}

  /** (Re)build the outline for a new world size. */
  setWorld(world: WorldSize): void {
    this.line?.dispose(false, true);
    const b = airspaceBounds(world);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const corners = [
      { x: b.minX, y: b.minY },
      { x: b.maxX, y: b.minY },
      { x: b.maxX, y: b.maxY },
      { x: b.minX, y: b.maxY },
      { x: b.minX, y: b.minY },
    ];
    const line = CreateGreasedLine(
      "airspaceBoundary",
      { points: corners.map((p) => toScene(p, world, BOUNDARY_ALTITUDE)) },
      {
        color: Color3.FromHexString(BOUNDARY_COLOR),
        width: BOUNDARY_WIDTH,
        useDash: true,
        dashCount: Math.round((2 * (w + h)) / DASH_SPACING),
        dashRatio: 0.5,
      },
      this.scene,
    );
    line.material!.transparencyMode = Material.MATERIAL_ALPHABLEND;
    line.material!.alpha = BOUNDARY_ALPHA;
    line.isPickable = false;
    line.renderingGroupId = OVERLAY_GROUP; // over trees, like the paths
    this.line = line;
    this.line.setEnabled(this.visible);
  }

  /** Show or hide the outline. Hidden (and not drawn at all) by default. */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.line?.setEnabled(visible);
  }
}
