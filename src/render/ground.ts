/**
 * Ground plane and radar grid.
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { CreateLineSystem } from "@babylonjs/core/Meshes/Builders/linesBuilder";
import type { LinesMesh } from "@babylonjs/core/Meshes/linesMesh";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import type { WorldSize } from "../core/types";

/** Spacing between radar grid lines (world units). */
const GRID_SPACING = 6;

export class Ground {
  private field: Mesh | null = null;
  private grid: LinesMesh | null = null;
  private border: LinesMesh | null = null;
  private readonly fieldMaterial: StandardMaterial;

  constructor(private readonly scene: Scene) {
    this.fieldMaterial = new StandardMaterial("fieldMat", scene);
    this.fieldMaterial.diffuseColor = Color3.FromHexString("#0f172a"); // slate-900
    this.fieldMaterial.specularColor = Color3.Black();
    this.fieldMaterial.emissiveColor = Color3.FromHexString("#0b1222");
  }

  /** (Re)build the field, grid and border for the current world size. */
  setWorld(world: WorldSize): void {
    this.field?.dispose();
    this.grid?.dispose();
    this.border?.dispose();

    const hw = world.width / 2;
    const hh = world.height / 2;

    this.field = CreateGround("field", { width: world.width, height: world.height }, this.scene);
    this.field.material = this.fieldMaterial;
    this.field.isPickable = false;

    // Grid lines, centred so the pattern is symmetric around the origin.
    const lines: Vector3[][] = [];
    const y = 0.02; // just above the field to avoid z-fighting
    for (let x = 0; x <= hw; x += GRID_SPACING) {
      for (const sx of x === 0 ? [0] : [x, -x]) {
        lines.push([new Vector3(sx, y, -hh), new Vector3(sx, y, hh)]);
      }
    }
    for (let z = 0; z <= hh; z += GRID_SPACING) {
      for (const sz of z === 0 ? [0] : [z, -z]) {
        lines.push([new Vector3(-hw, y, sz), new Vector3(hw, y, sz)]);
      }
    }
    this.grid = CreateLineSystem("grid", { lines }, this.scene);
    this.grid.color = Color3.FromHexString("#1e293b"); // slate-800
    this.grid.isPickable = false;

    this.border = CreateLineSystem(
      "border",
      {
        lines: [
          [
            new Vector3(-hw, y, -hh),
            new Vector3(hw, y, -hh),
            new Vector3(hw, y, hh),
            new Vector3(-hw, y, hh),
            new Vector3(-hw, y, -hh),
          ],
        ],
      },
      this.scene,
    );
    this.border.color = Color3.FromHexString("#334155"); // slate-700
    this.border.isPickable = false;
  }
}
