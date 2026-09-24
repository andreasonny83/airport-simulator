/**
 * Runway meshes: a paved strip with real-world style markings and lights.
 *
 * Built in the runway's local frame, then placed by a root node rotated so
 * local +x is the landing direction and local z runs across the strip:
 *
 *   approach lights → [threshold bar | piano keys | 32 | TDZ | aiming point | ... | end]
 *        (-x)                                                                        (+x)
 *
 * Gameplay cues stay in the runway's colour: the threshold bar plus a
 * "rabbit" of approach lights that sweeps towards the threshold, showing
 * which end to land on. Everything else is white paint on dark asphalt.
 *
 * Static white markings are merged into a single mesh per runway, and so are
 * the edge lights, so each runway costs a handful of draw calls.
 */
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { CreateGround } from "@babylonjs/core/Meshes/Builders/groundBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { Scene } from "@babylonjs/core/scene";
import { COLOR_HEX, RUNWAY_THRESHOLD_INSET } from "../config";
import { runwayDesignator } from "../core/layout";
import type { Runway, RunwayColor, WorldSize } from "../core/types";
import { headingToRotationY, toScene } from "./coords";

// Layer heights (scene y). Everything sits above the grass (0) and stream
// (≤ 0.05) and below planes on their rollout (0.35).
const SHOULDER_TOP = 0.06;
const ASPHALT_TOP = 0.08;
const PAINT_Y = 0.09;
const LIGHT_Y = 0.14;

/** Paved shoulder extends this far past the asphalt on every side. */
const SHOULDER_MARGIN = 0.6;

/** Spacing of the white edge lights along each side. */
const EDGE_LIGHT_SPACING = 2.4;

/** Approach light bars beyond the runway start, and their spacing. */
const APPROACH_LIGHT_COUNT = 5;
const APPROACH_LIGHT_SPACING = 1.2;
/** Seconds for one rabbit sweep from the farthest light to the threshold. */
const RABBIT_PERIOD = 1.1;

/** A built runway: its root node plus the lights `update` animates. */
export class RunwayView {
  constructor(
    readonly root: TransformNode,
    /** Ordered farthest → nearest to the threshold. */
    private readonly approachLights: Mesh[],
  ) {}

  /** Sweep the approach "rabbit" towards the threshold. `time` in seconds. */
  update(time: number): void {
    const n = this.approachLights.length;
    // Head of the sweep, in light indices; runs a little past the last light
    // so there's a short dark beat before the next sweep.
    const head = ((time % RABBIT_PERIOD) / RABBIT_PERIOD) * (n + 1.5);
    this.approachLights.forEach((light, i) => {
      const glow = Math.max(0, 1 - Math.abs(head - i) * 1.3);
      light.visibility = 0.5 + 0.5 * glow;
    });
  }

  dispose(): void {
    this.root.dispose();
  }
}

export class RunwayFactory {
  private readonly shoulder: StandardMaterial;
  private readonly asphalt: StandardMaterial;
  private readonly paint: StandardMaterial;
  private readonly edgeLight: StandardMaterial;
  private readonly approachMaterials = new Map<RunwayColor, StandardMaterial>();
  /** Number decals, cached by designator so resizes don't leak textures. */
  private readonly numberMaterials = new Map<string, StandardMaterial>();

  constructor(
    private readonly scene: Scene,
    /** Shared runway/plane colour material (lit, with a little glow). */
    private readonly colorMaterial: (color: RunwayColor) => StandardMaterial,
  ) {
    this.shoulder = matte("rwyShoulder", "#8a8f86", scene);
    this.asphalt = matte("rwyAsphalt", "#2e3238", scene);
    this.paint = matte("rwyPaint", "#f1f5f9", scene);
    // Keep paint crisp in shadow: a bit of self-illumination.
    this.paint.emissiveColor = new Color3(0.35, 0.35, 0.35);
    this.edgeLight = unlit("rwyEdgeLight", Color3.FromHexString("#fff3d0"), scene);
  }

  create(runway: Runway, world: WorldSize): RunwayView {
    const root = new TransformNode(`runway-${runway.color}`, this.scene);
    root.position = toScene(runway.center, world);
    root.rotation.y = headingToRotationY(runway.heading);

    const L = runway.length;
    const W = runway.width;
    const thresholdX = -(L / 2 - RUNWAY_THRESHOLD_INSET);

    const shoulder = this.slab(
      "shoulder",
      L + SHOULDER_MARGIN * 2,
      W + SHOULDER_MARGIN * 2,
      0,
      SHOULDER_TOP,
    );
    shoulder.material = this.shoulder;

    const asphalt = this.slab("asphalt", L, W, SHOULDER_TOP, ASPHALT_TOP);
    asphalt.material = this.asphalt;

    // The coloured threshold bar is the landing line (and the colour cue).
    const bar = this.mark(0.9, W - 0.3, thresholdX, 0, 0.012);
    bar.material = this.colorMaterial(runway.color);

    const paint = this.buildPaint(L, W, thresholdX);
    const number = this.buildNumber(runwayDesignator(runway.heading), thresholdX + 4.5);
    const edgeLights = this.buildEdgeLights(L, W);
    const approach = this.buildApproachLights(runway.color, L, W);

    const parts = [shoulder, asphalt, bar, paint, number, edgeLights, ...approach];
    for (const part of parts) {
      part.parent = root;
      part.isPickable = false;
    }
    // Planes on approach shade the pavement.
    for (const part of [shoulder, asphalt, bar, paint, number]) part.receiveShadows = true;

    return new RunwayView(root, approach);
  }

  // -------------------------------------------------------------------------
  // Markings
  // -------------------------------------------------------------------------

  /**
   * All static white paint, merged into one mesh: piano keys, touchdown
   * zone bars, aiming points, centreline dashes, edge lines and end bar.
   */
  private buildPaint(L: number, W: number, thresholdX: number): Mesh {
    const marks: Mesh[] = [];
    const end = L / 2;
    /** Add a mark if it fits before the far end of the runway. */
    const add = (length: number, width: number, x: number, z: number) => {
      if (x + length / 2 < end - 0.3) marks.push(this.mark(length, width, x, z));
    };
    /** Same mark on both sides of the centreline. */
    const pair = (length: number, width: number, x: number, z: number) => {
      add(length, width, x, z);
      add(length, width, x, -z);
    };

    // Piano keys: 4 stripes each side of a centre gap, just past the threshold.
    const keysX = thresholdX + 1.7;
    for (let i = 0; i < 4; i++) pair(2, 0.28, keysX, 0.35 + 0.14 + i * 0.48);

    // Touchdown zone: 3 bars each side, then 2 further along.
    for (const z of [0.85, 1.2, 1.55]) pair(1.2, 0.16, thresholdX + 7.5, z);
    for (const z of [1.0, 1.35]) pair(1.2, 0.16, thresholdX + 13.5, z);

    // Aiming point: the two big blocks pilots aim for.
    pair(2.4, 0.45, thresholdX + 10.2, 1.25);

    // Centreline dashes, starting after the runway number.
    for (let x = thresholdX + 6.6; x < end - 1; x += 2.1) add(1.2, 0.14, x, 0);

    // Edge lines along the full paved length, plus an end bar.
    const edgeLen = end - (thresholdX - 0.45) - 0.2;
    const edgeX = thresholdX - 0.45 + edgeLen / 2;
    // (Pushed directly: they run right to the end, past `add`'s cutoff.)
    for (const side of [1, -1]) marks.push(this.mark(edgeLen, 0.1, edgeX, side * (W / 2 - 0.25)));
    marks.push(this.mark(0.25, W - 0.4, end - 0.35, 0));

    const merged = Mesh.MergeMeshes(marks, true);
    if (!merged) throw new Error("Failed to build runway markings");
    merged.name = "paint";
    merged.material = this.paint;
    return merged;
  }

  /** Runway number decal, reading upright for a plane on approach. */
  private buildNumber(designator: string, x: number): Mesh {
    // With the ground builder's UVs and DynamicTexture's flipped Y, text drawn
    // upright ends up with its "up" along local +x and its "right" along -z:
    // exactly the view of a pilot landing towards +x. So no extra rotation;
    // width (x) is the text's height, height (z) its width.
    const decal = CreateGround("number", { width: 2.6, height: 2.8 }, this.scene);
    decal.rotation.y = Math.PI / 2;
    decal.position.set(x, PAINT_Y + 0.015, 0);
    decal.material = this.numberMaterial(designator);
    return decal;
  }

  private numberMaterial(designator: string): StandardMaterial {
    let mat = this.numberMaterials.get(designator);
    if (mat) return mat;

    const size = 256;
    const tex = new DynamicTexture(`rwyNum-${designator}`, size, this.scene, true);
    tex.hasAlpha = true; // transparent background: only the digits are drawn
    // Condensed, tall digits like real runway numbers. x = null centres it.
    tex.drawText(
      designator,
      null,
      size * 0.84,
      "bold 210px 'Arial Narrow', sans-serif",
      "#ffffff",
      null,
    );

    mat = new StandardMaterial(`rwyNumMat-${designator}`, this.scene);
    mat.diffuseTexture = tex;
    mat.specularColor = Color3.Black();
    mat.emissiveColor = new Color3(0.35, 0.35, 0.35);
    this.numberMaterials.set(designator, mat);
    return mat;
  }

  // -------------------------------------------------------------------------
  // Lights
  // -------------------------------------------------------------------------

  /** Small warm-white lights just outside both edges, merged into one mesh. */
  private buildEdgeLights(L: number, W: number): Mesh {
    const lights: Mesh[] = [];
    const count = Math.floor(L / EDGE_LIGHT_SPACING);
    const start = -((count * EDGE_LIGHT_SPACING) / 2);
    for (let i = 0; i <= count; i++) {
      for (const side of [1, -1]) {
        const light = CreateBox("edgeLight", { size: 0.16 }, this.scene);
        light.position.set(start + i * EDGE_LIGHT_SPACING, LIGHT_Y, side * (W / 2 + 0.3));
        lights.push(light);
      }
    }
    const merged = Mesh.MergeMeshes(lights, true);
    if (!merged) throw new Error("Failed to build runway edge lights");
    merged.name = "edgeLights";
    merged.material = this.edgeLight;
    return merged;
  }

  /**
   * Approach lights on the grass before the runway start, in the runway's
   * colour. The middle bar is a wide crossbar, like a real approach system.
   * Returned farthest-first so the rabbit sweeps towards the threshold.
   */
  private buildApproachLights(color: RunwayColor, L: number, W: number): Mesh[] {
    const mat = this.approachMaterial(color);
    const lights: Mesh[] = [];
    for (let k = APPROACH_LIGHT_COUNT; k >= 1; k--) {
      const crossbar = k === 3;
      const light = CreateBox(
        "approachLight",
        { width: 0.45, height: 0.14, depth: crossbar ? W + 1 : 2 },
        this.scene,
      );
      light.position.set(-L / 2 - SHOULDER_MARGIN - k * APPROACH_LIGHT_SPACING, LIGHT_Y, 0);
      light.material = mat;
      lights.push(light);
    }
    return lights;
  }

  private approachMaterial(color: RunwayColor): StandardMaterial {
    let mat = this.approachMaterials.get(color);
    if (!mat) {
      mat = unlit(`rwyApproach-${color}`, Color3.FromHexString(COLOR_HEX[color]), this.scene);
      this.approachMaterials.set(color, mat);
    }
    return mat;
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /** A flat box from `bottom` to `top`, `length` along x and `width` across. */
  private slab(name: string, length: number, width: number, bottom: number, top: number): Mesh {
    const box = CreateBox(name, { width: length, height: top - bottom, depth: width }, this.scene);
    box.position.y = (bottom + top) / 2;
    return box;
  }

  /** A thin painted rectangle centred at local (x, z). */
  private mark(length: number, width: number, x: number, z: number, lift = 0): Mesh {
    const box = CreateBox("mark", { width: length, height: 0.02, depth: width }, this.scene);
    box.position.set(x, PAINT_Y + lift, z);
    return box;
  }
}

/** Lit material with no specular highlight. */
function matte(name: string, hex: string, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = Color3.FromHexString(hex);
  mat.specularColor = Color3.Black();
  return mat;
}

/** Unlit, self-coloured material for lights (ignores scene lighting). */
function unlit(name: string, color: Color3, scene: Scene): StandardMaterial {
  const mat = new StandardMaterial(name, scene);
  mat.disableLighting = true;
  mat.emissiveColor = color;
  return mat;
}
