/**
 * Mapping between simulation space and Babylon scene space.
 *
 * The sim is 2D with the origin at the playfield's top-left corner and +y
 * pointing "towards the player". The scene centres the playfield on the
 * origin and lays it on Babylon's ground (XZ) plane:
 *
 *   sim x  →  scene x = x - width / 2
 *   sim y  →  scene z = height / 2 - y   (flipped: far side of the field is +z)
 *
 * With the camera looking from -z towards +z, sim "up the screen" stays up the
 * screen, just like the 2D prototype.
 */
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Vec2, WorldSize } from "../core/types";

/** Sim point → scene position at the given altitude (scene y). */
export function toScene(p: Vec2, world: WorldSize, altitude = 0, ref = new Vector3()): Vector3 {
  return ref.set(p.x - world.width / 2, altitude, world.height / 2 - p.y);
}

/** Scene position → sim point (altitude is dropped). */
export function fromScene(v: Vector3, world: WorldSize): Vec2 {
  return { x: v.x + world.width / 2, y: world.height / 2 - v.z };
}

/**
 * Sim heading → Babylon `rotation.y`.
 *
 * A mesh modelled nose-along-+x, rotated by `r` about Babylon's (left-handed)
 * y axis, points along (cos r, 0, -sin r). A sim heading `h` points along
 * (cos h, sin h), which `toScene` maps to (cos h, 0, -sin h). So the two
 * angles are identical — no conversion needed, but keep it explicit.
 */
export function headingToRotationY(heading: number): number {
  return heading;
}
