/**
 * Cars: the little low-poly car model (shared by the car parks and the road
 * traffic) and `CarFleet`, which draws core/cars.ts traffic.
 *
 * The fleet is one thin-instanced mesh (parked cars included): each frame
 * writes every car's matrix and colour and sets the instance count, so all
 * the traffic costs a single draw call.
 */
import type { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Matrix, Quaternion, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { CreateBox } from "@babylonjs/core/Meshes/Builders/boxBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh"; // side effect: mesh.thinInstance* API
import type { Scene } from "@babylonjs/core/scene";
import { carPose, type CarTraffic } from "../core/cars";
import type { Bridge } from "../core/countryside";
import { horizonFade, type Bounds } from "../core/scenery";
import type { WorldSize } from "../core/types";
import { headingToRotationY, toScene } from "./coords";
import { roadSurfaceHeight } from "./bridges";

/** Car paint colours: mostly everyday greys and whites, a few brights. */
export const CAR_COLORS = [
  "#e5e7eb",
  "#1f2937",
  "#9ca3af",
  "#b91c1c",
  "#1d4ed8",
  "#f5f5f4",
  "#475569",
  "#15803d",
];

/**
 * A small low-poly car (body plus cabin), nose along +x, wheels at y = 0.
 * Colour it with a per-instance "color" buffer and a white `material`.
 */
export function createCarMesh(name: string, material: StandardMaterial, scene: Scene): Mesh {
  const body = CreateBox("carBody", { width: 1.0, height: 0.3, depth: 0.5 }, scene);
  body.bakeTransformIntoVertices(Matrix.Translation(0, 0.22, 0));
  const cabin = CreateBox("carCabin", { width: 0.55, height: 0.24, depth: 0.44 }, scene);
  cabin.bakeTransformIntoVertices(Matrix.Translation(-0.05, 0.49, 0));
  const car = Mesh.MergeMeshes([body, cabin], true);
  if (!car) throw new Error("Failed to build car model");
  car.name = name;
  car.material = material;
  car.receiveShadows = true;
  car.isPickable = false;
  return car;
}

/** Road traffic, drawn as thin instances of one car mesh. */
export class CarFleet {
  private readonly mesh: Mesh;
  private capacity = 0;
  private matrices = new Float32Array(0);
  private colors = new Float32Array(0);
  private readonly palette = CAR_COLORS.map((hex) => Color3.FromHexString(hex));
  private readonly m = new Matrix();
  private readonly rot = new Quaternion();
  private readonly scale = new Vector3();
  private readonly pos = new Vector3();

  constructor(scene: Scene, shadows: ShadowGenerator | null) {
    const paint = new StandardMaterial("trafficCar", scene);
    paint.diffuseColor = Color3.White();
    paint.specularColor = new Color3(0.2, 0.2, 0.2);
    this.mesh = createCarMesh("traffic", paint, scene);
    this.ensureCapacity(48);
    this.mesh.thinInstanceCount = 0;
    // Cars drive all over the map: never cull them against a stale box.
    this.mesh.alwaysSelectAsActiveMesh = true;
    shadows?.addShadowCaster(this.mesh, false);
  }

  /** Grow the instance buffers to hold at least `n` cars. */
  private ensureCapacity(n: number): void {
    if (n <= this.capacity) return;
    this.capacity = Math.max(n, this.capacity * 2);
    this.matrices = new Float32Array(this.capacity * 16);
    this.colors = new Float32Array(this.capacity * 4);
    this.mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    this.mesh.thinInstanceSetBuffer("color", this.colors, 4, false);
  }

  /**
   * Write every car's pose into the instance buffers. Cars sit on the road
   * surface (up the bridge ramps, tilting with them) and shrink away as they
   * drive into the horizon haze (`bounds` is the scenery map).
   */
  sync(traffic: CarTraffic, bridges: readonly Bridge[], world: WorldSize, bounds: Bounds): void {
    const cars = traffic.cars;
    this.ensureCapacity(cars.length);
    cars.forEach((car, i) => {
      const pose = carPose(traffic, car);
      this.scale.setAll(1 - horizonFade(pose.pos, bounds));
      // Height under the car, and its slope along the heading (for the tilt).
      const y = roadSurfaceHeight(pose.pos, bridges);
      const hx = Math.cos(pose.heading) * 0.5;
      const hy = Math.sin(pose.heading) * 0.5;
      const front = roadSurfaceHeight({ x: pose.pos.x + hx, y: pose.pos.y + hy }, bridges);
      const back = roadSurfaceHeight({ x: pose.pos.x - hx, y: pose.pos.y - hy }, bridges);
      const tilt = Math.atan2(front - back, 1);
      Quaternion.RotationYawPitchRollToRef(headingToRotationY(pose.heading), 0, tilt, this.rot);
      toScene(pose.pos, world, y, this.pos);
      Matrix.ComposeToRef(this.scale, this.rot, this.pos, this.m);
      this.m.copyToArray(this.matrices, i * 16);
      const c = this.palette[car.id % this.palette.length]!;
      this.colors.set([c.r, c.g, c.b, 1], i * 4);
    });
    this.mesh.thinInstanceCount = cars.length;
    this.mesh.thinInstanceBufferUpdated("matrix");
    this.mesh.thinInstanceBufferUpdated("color");
  }

  dispose(): void {
    this.mesh.dispose();
  }
}
