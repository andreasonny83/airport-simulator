/**
 * Airspace boundary: a dashed outline around the airspace that fades in
 * while the player drags a path past the edge. Paths may run anywhere on the
 * map, but only planes inside the border can collide (see
 * core/collision.ts), so showing where it is tells the player where the
 * no-collision holding area begins.
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
const BOUNDARY_COLOR = "#f8fafc";
/** Peak opacity while highlighted. */
const BOUNDARY_ALPHA = 0.9;
/** One dash + gap every this many world units along the border. */
const DASH_SPACING = 3;
/** Fade time constants (seconds): appear quickly, linger a little. */
const FADE_IN = 0.08;
const FADE_OUT = 0.5;

export class AirspaceBoundary {
  private line: Mesh | null = null;
  private alpha = 0;
  private active = false;

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
    line.isPickable = false;
    line.renderingGroupId = OVERLAY_GROUP; // over trees, like the paths
    this.line = line;
    this.apply();
  }

  /** Highlight the border (true while a drag is pressing past it). */
  setActive(active: boolean): void {
    this.active = active;
  }

  /** Ease the opacity towards its target; `dt` in seconds. */
  update(dt: number): void {
    const target = this.active ? BOUNDARY_ALPHA : 0;
    const tau = this.active ? FADE_IN : FADE_OUT;
    this.alpha += (target - this.alpha) * (1 - Math.exp(-dt / tau));
    this.apply();
  }

  private apply(): void {
    if (!this.line) return;
    this.line.material!.alpha = this.alpha;
    // Skip the draw call entirely once faded out.
    this.line.setEnabled(this.alpha > 0.01);
  }
}
