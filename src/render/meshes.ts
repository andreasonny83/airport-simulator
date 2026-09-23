/**
 * Mesh + material factory: low-poly planes and warning rings (runways live
 * in runway.ts).
 *
 * Plane meshes are built once per colour as a hidden template and then
 * cloned, so every plane of a colour shares geometry and material.
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { Scene } from "@babylonjs/core/scene";
import { COLOR_HEX, PLANE_RADIUS } from "../config";
import type { RunwayColor } from "../core/types";
import { OVERLAY_GROUP } from "./scene";

export class MeshFactory {
  private readonly colorMaterials = new Map<RunwayColor, StandardMaterial>();
  private readonly planeTemplates = new Map<RunwayColor, Mesh>();
  private readonly warning: StandardMaterial;

  constructor(private readonly scene: Scene) {
    // Warning ring: unlit, translucent red that the sync layer pulses.
    this.warning = new StandardMaterial("warning", scene);
    this.warning.disableLighting = true;
    this.warning.emissiveColor = Color3.FromHexString("#ef4444");
    this.warning.alpha = 0.5;
  }

  /** Shared material for a runway/plane colour. */
  material(color: RunwayColor): StandardMaterial {
    let mat = this.colorMaterials.get(color);
    if (!mat) {
      mat = this.makeMaterial(`color-${color}`, COLOR_HEX[color], 0.35);
      this.colorMaterials.set(color, mat);
    }
    return mat;
  }

  /** New plane mesh (nose along +x, centred on the origin). */
  createPlane(color: RunwayColor, name: string): Mesh {
    let template = this.planeTemplates.get(color);
    if (!template) {
      template = this.buildPlaneTemplate(color);
      this.planeTemplates.set(color, template);
    }
    const mesh = template.clone(name);
    mesh.setEnabled(true);
    mesh.renderingGroupId = OVERLAY_GROUP; // set per clone: not copied from the template
    return mesh;
  }

  /** Flat red ring shown around planes on a collision course. */
  createWarningRing(name: string): Mesh {
    const ring = CreateTorus(
      name,
      { diameter: PLANE_RADIUS * 3.6, thickness: 0.35, tessellation: 32 },
      this.scene,
    );
    ring.material = this.warning;
    ring.isPickable = false;
    ring.renderingGroupId = OVERLAY_GROUP;
    return ring;
  }

  /** Merge a few boxes into a simple airliner silhouette. */
  private buildPlaneTemplate(color: RunwayColor): Mesh {
    const r = PLANE_RADIUS;
    const box = (w: number, h: number, d: number, x: number, y: number) => {
      const m = CreateBox("part", { width: w, height: h, depth: d }, this.scene);
      m.position.set(x, y, 0);
      return m;
    };
    const parts = [
      box(r * 2, r * 0.36, r * 0.36, 0, 0), // fuselage
      box(r * 0.6, r * 0.08, r * 2, r * 0.1, 0), // main wings
      box(r * 0.35, r * 0.06, r * 0.85, -r * 0.8, 0.05), // tailplane
      box(r * 0.4, r * 0.5, r * 0.06, -r * 0.8, r * 0.25), // fin
    ];
    const merged = Mesh.MergeMeshes(parts, true);
    if (!merged) throw new Error("Failed to build plane mesh");
    merged.name = `plane-template-${color}`;
    merged.material = this.material(color);
    merged.isPickable = false;
    merged.setEnabled(false);
    return merged;
  }

  private makeMaterial(name: string, hex: string, glow: number): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    const color = Color3.FromHexString(hex);
    mat.diffuseColor = color;
    // A little self-illumination keeps colours readable on the dark field.
    mat.emissiveColor = color.scale(glow);
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    return mat;
  }
}
