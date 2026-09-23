/**
 * Game tuning constants.
 *
 * All distances are in world units and all times in seconds. The world is a
 * fixed 100 units tall (see `WORLD_HEIGHT`), so e.g. a speed of 8 means a
 * plane crosses the full height of the screen in ~12.5 seconds regardless of
 * the device resolution.
 */
import type { RunwayColor } from "./core/types";

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

/** Fixed playfield height; width is `WORLD_HEIGHT * aspectRatio`. */
export const WORLD_HEIGHT = 100;

/** Minimum world width required before the third (yellow) runway is added. */
export const YELLOW_RUNWAY_MIN_WIDTH = 75;

// ---------------------------------------------------------------------------
// Planes
// ---------------------------------------------------------------------------

/** Collision/visual radius of a plane. */
export const PLANE_RADIUS = 2.2;

/** Cruise speed (units / second). */
export const PLANE_SPEED = 8;

/** Two flying planes closer than this crash. */
export const COLLISION_DISTANCE = PLANE_RADIUS * 2.2;

/** Two flying planes closer than this show a proximity warning. */
export const WARNING_DISTANCE = COLLISION_DISTANCE * 2.5;

/** Pointer must go down within this distance of a plane to grab it. */
export const PLANE_GRAB_RADIUS = PLANE_RADIUS * 3;

/** Height planes fly at in the 3D scene (purely visual). */
export const FLIGHT_ALTITUDE = 1.5;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Minimum spacing between recorded path points (keeps arrays small). */
export const PATH_MIN_SPACING = 1.2;

// ---------------------------------------------------------------------------
// Runways & landing
// ---------------------------------------------------------------------------

export const RUNWAY_LENGTH = 16;
export const RUNWAY_WIDTH = 5;

/** Distance from the runway end to the threshold marker. */
export const RUNWAY_THRESHOLD_INSET = 1.5;

/** A plane within this distance of a threshold is "over" it. */
export const LANDING_RADIUS = PLANE_RADIUS * 2;

/** Max difference between plane heading and runway heading (±60°). */
export const LANDING_ANGLE_TOLERANCE = Math.PI / 3;

/** Distance rolled along the runway before the plane disappears. */
export const LANDING_ROLL_DISTANCE = 8;

/** Rollout speed as a fraction of cruise: starts fast, ends slow. */
export const LANDING_SPEED_START = 0.8;
export const LANDING_SPEED_END = 0.3;

/**
 * Runway layout as fractions of the world size (CLAUDE.md responsiveness
 * rule). `heading` is the landing direction.
 */
export const RUNWAY_LAYOUT: ReadonlyArray<{
  color: RunwayColor;
  fx: number;
  fy: number;
  heading: number;
}> = [
  { color: "red", fx: 0.25, fy: 0.7, heading: (-3 * Math.PI) / 4 },
  { color: "blue", fx: 0.75, fy: 0.7, heading: -Math.PI / 4 },
  { color: "yellow", fx: 0.5, fy: 0.3, heading: 0 },
];

// ---------------------------------------------------------------------------
// Spawning & difficulty
// ---------------------------------------------------------------------------

/** Seconds between spawns at the start of a shift. */
export const SPAWN_INTERVAL_START = 4;

/** Spawns never get more frequent than this. */
export const SPAWN_INTERVAL_MIN = 1;

/** Max random deviation from "straight inward" for a spawn heading (±0.5 rad). */
export const SPAWN_HEADING_JITTER = 0.5;

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

/** Largest dt fed to the sim; avoids tunnelling after a tab switch. */
export const MAX_DT = 0.1;

// ---------------------------------------------------------------------------
// Colours (render + UI)
// ---------------------------------------------------------------------------

export const COLOR_HEX: Record<RunwayColor, string> = {
  red: "#ef4444",
  blue: "#3b82f6",
  yellow: "#eab308",
};
