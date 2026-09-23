/**
 * Mesh + material factory: low-poly planes, runways and warning rings.
 *
 * Plane meshes are built once per colour as a hidden template and then
 * cloned, so every plane of a colour shares geometry and material.
 */
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateDisc } from "@babylonjs/core/Meshes/Builders/discBuilder";
import { CreateTorus } from "@babylonjs/core/Meshes/Builders/torusBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { COLOR_HEX, PLANE_RADIUS, RUNWAY_THRESHOLD_INSET } from "../config";
import type { Runway, RunwayColor, WorldSize } from "../core/types";
import { headingToRotationY, toScene } from "./coords";

export class MeshFactory {
  private readonly colorMaterials = new Map<RunwayColor, StandardMaterial>();
  private readonly planeTemplates = new Map<RunwayColor, Mesh>();
  private readonly asphalt: StandardMaterial;
  private readonly paint: StandardMaterial;
  private readonly warning: StandardMaterial;

  constructor(private readonly scene: Scene) {
    this.asphalt = this.makeMaterial("asphalt", "#334155", 0.15);
    this.paint = this.makeMaterial("paint", "#e2e8f0", 0.6);

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
    return ring;
  }

  /**
   * Build a runway as a group of meshes under one node, rotated so local +x is
   * the landing direction: asphalt strip, coloured threshold bar, a white
   * arrow showing which way to land, and a dashed centreline.
   */
  createRunway(runway: Runway, world: WorldSize): TransformNode {
    const root = new TransformNode(`runway-${runway.color}`, this.scene);
    root.position = toScene(runway.center, world);
    root.rotation.y = headingToRotationY(runway.heading);

    const L = runway.length;
    const W = runway.width;
    const thresholdX = -(L / 2 - RUNWAY_THRESHOLD_INSET);

    const strip = CreateBox("strip", { width: L, height: 0.1, depth: W }, this.scene);
    strip.material = this.asphalt;
    strip.position.y = 0.05;

    const bar = CreateBox("threshold", { width: 1.2, height: 0.12, depth: W - 0.6 }, this.scene);
    bar.material = this.material(runway.color);
    bar.position.set(thresholdX, 0.06, 0);

    // A 3-sided disc is a triangle; its first vertex points along +x.
    const arrow = CreateDisc(
      "arrow",
      { radius: 0.9, tessellation: 3, sideOrientation: Mesh.DOUBLESIDE },
      this.scene,
    );
    arrow.material = this.paint;
    arrow.rotation.x = Math.PI / 2; // lay flat on the ground
    arrow.position.set(thresholdX + 1.8, 0.13, 0);

    const parts: Mesh[] = [strip, bar, arrow];
    for (let x = thresholdX + 3.5; x < L / 2 - 1; x += 2.2) {
      const dash = CreateBox("dash", { width: 1.1, height: 0.12, depth: 0.2 }, this.scene);
      dash.material = this.paint;
      dash.position.set(x, 0.06, 0);
      parts.push(dash);
    }

    for (const part of parts) {
      part.parent = root;
      part.isPickable = false;
    }
    return root;
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
