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
export const WORLD_HEIGHT = 80;

/** Minimum world width required before the third (yellow) runway is added. */
export const YELLOW_RUNWAY_MIN_WIDTH = 75;

// ---------------------------------------------------------------------------
// Planes
// ---------------------------------------------------------------------------

/** Collision/visual radius of a plane. */
export const PLANE_RADIUS = 2.2;

/** Cruise speed (units / second). */
export const PLANE_SPEED = 7;

/** Two flying planes closer than this crash. */
export const COLLISION_DISTANCE = PLANE_RADIUS * 2.2;

/** Two flying planes closer than this show a proximity warning. */
export const WARNING_DISTANCE = COLLISION_DISTANCE * 2.5;

/** Pointer must go down within this distance of a plane to grab it. */
export const PLANE_GRAB_RADIUS = PLANE_RADIUS * 3;

/** Height planes fly at in the 3D scene (purely visual). */
export const FLIGHT_ALTITUDE = 3;

// ---------------------------------------------------------------------------
// Steering (see core/plane.ts)
// ---------------------------------------------------------------------------

/**
 * Fastest a plane can change heading (rad / second, ~110°/s). Together with
 * `PLANE_SPEED` this sets the tightest possible turn radius:
 * `PLANE_SPEED / MAX_TURN_RATE` ≈ 3.7 units. A U-turn is a smooth arc, never
 * an instant flip.
 */
export const MAX_TURN_RATE = 1.9;

/**
 * How hard a plane steers towards its target heading: commanded turn rate
 * (rad/s) per radian of heading error, before `MAX_TURN_RATE` caps it.
 * Small errors get gentle corrections, so the plane eases onto its heading
 * instead of snapping.
 */
export const TURN_RESPONSE = 2.5;

/**
 * Time constant (seconds) for the actual turn rate to catch up with the
 * commanded one: the plane has to roll into and out of a bank. With
 * `TURN_RESPONSE` this gives a well-damped response (damping ratio ≈ 0.8),
 * so planes settle onto a heading without visible wobble.
 */
export const TURN_LAG = 0.15;

/** A waypoint within this distance of the plane counts as reached. */
export const WAYPOINT_CAPTURE_RADIUS = 1.5;

/**
 * Fixed sub-step (seconds) for flight integration. Steering is a feedback
 * loop, so a frame's dt is split into slices this size. That way 30, 60 and
 * 144 Hz displays fly the same curves.
 */
export const FLIGHT_SUBSTEP = 1 / 120;

/** Visual only: bank angle (radians, ~35°) when turning at `MAX_TURN_RATE`. */
export const MAX_BANK = 0.6;

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Minimum spacing between recorded path points (keeps arrays small). */
export const PATH_MIN_SPACING = 1.2;

// ---------------------------------------------------------------------------
// Runways & landing
// ---------------------------------------------------------------------------

/** Strip size. Long and narrow-ish so it reads as a real runway. */
export const RUNWAY_LENGTH = 40;
export const RUNWAY_WIDTH = 5;

/** Distance from the runway end to the threshold marker. */
export const RUNWAY_THRESHOLD_INSET = 1.5;

/** A plane within this distance of a threshold is "over" it. */
export const LANDING_RADIUS = PLANE_RADIUS * 2;

/** Max difference between plane heading and runway heading (±60°). */
export const LANDING_ANGLE_TOLERANCE = Math.PI / 3;

/**
 * A path dragged to within this distance of its runway's threshold snaps
 * onto it and locks ("anchors"), if it arrives from the landing direction.
 * Generous (a runway width) so the player doesn't have to be pixel-perfect.
 */
export const ANCHOR_RADIUS = RUNWAY_WIDTH;

/** Distance rolled along the runway before the plane disappears. */
export const LANDING_ROLL_DISTANCE = 14;

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
  // fy 0.72 (not 0.7) keeps the long diagonal strips clear of the stream.
  { color: "red", fx: 0.25, fy: 0.72, heading: (-3 * Math.PI) / 4 },
  { color: "blue", fx: 0.75, fy: 0.72, heading: -Math.PI / 4 },
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
// Progression (onboarding ramp — see core/progression.ts)
// ---------------------------------------------------------------------------

/** Hard ceiling on simultaneously flying planes, however far the shift goes. */
export const MAX_AIRBORNE = 8;

/** Each this-many landings allows one more plane in the air. */
export const LANDINGS_PER_EXTRA_PLANE = 2;

/** Each this-many seconds allows one more plane, so an idle player can't stall. */
export const SECONDS_PER_EXTRA_PLANE = 45;

/**
 * Score at which each runway colour starts receiving planes. Runways open in
 * `RUNWAY_LAYOUT` order; the first one must be 0 so a new shift has a target.
 */
export const COLOR_UNLOCK_SCORES: Record<RunwayColor, number> = {
  red: 0,
  blue: 3,
  yellow: 7,
};

// ---------------------------------------------------------------------------
// Landscape (purely decorative — the sim never reads any of this)
// ---------------------------------------------------------------------------

/**
 * The scenery map is a square `MAP_SCALE × max(width, height)` on a side,
 * centred on the playfield. Square (rather than matching the playfield's
 * aspect) so rotating the camera never reveals an edge on the short axis.
 */
export const MAP_SCALE = 5;

/** Fixed seed: the stream and trees look the same on every load and resize. */
export const SCENERY_SEED = 0x5eed_a1e;

/** Width of the water surface (world units). */
export const STREAM_WIDTH = 7;

/**
 * Peak deviation of the main meander from the base line. The centreline adds
 * a second, smaller sine (40% of this), so the total swing is ±1.4×.
 */
export const STREAM_AMPLITUDE = 4.5;

/** Wavelength of the main meander (world units). */
export const STREAM_WAVELENGTH = 60;

/**
 * Base line of the stream as a fraction of the world height. 0.5 threads it
 * between the yellow runway (fy 0.3) and the red/blue pair (fy 0.72).
 */
export const STREAM_BASE_FY = 0;

/** Candidate trees per 1000 units² (before rejection / density thinning). */
export const TREE_DENSITY = 0.8;

/** No tree closer than this to any runway edge. */
export const TREE_RUNWAY_CLEARANCE = 8;

/** No tree closer than this to the stream's water edge (≥ canopy radius). */
export const TREE_STREAM_CLEARANCE = 3;

/**
 * Tree size range. A scale-1 tree is ~3.5 units tall and ~2.5 wide (so up
 * to ~5.5 × 4 here, deliberately oversized to read at game zoom) — taller
 * than `FLIGHT_ALTITUDE`, which is fine: planes, paths and warning rings draw
 * in a later rendering group (see render/scene.ts), so they always show on
 * top of the scenery.
 */
export const TREE_SCALE_MIN = 1.0;
export const TREE_SCALE_MAX = 2.5;

/** Fraction of trees that are conifers; the rest are broadleaf. */
export const TREE_CONIFER_SHARE = 0.35;

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
