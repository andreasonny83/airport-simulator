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

/**
 * Tilt of the camera from straight down (radians). 0 = top-down radar view;
 * 0.9 ≈ 52°. Lives here (not in render/camera.ts) because the airspace is
 * sized from the camera's default view (see core/layout.ts `airspaceBounds`).
 */
export const CAMERA_TILT = 0.9;

/** Extra margin around the playfield's bounding circle when fitting the view. */
export const CAMERA_FIT_PADDING = 1.04;

/**
 * The airspace (where planes fly and paths can be drawn) fills the default
 * camera view, inset from every screen edge by this fraction of the view's
 * half-height. The same fraction on all four sides keeps an even on-screen
 * gap whatever the aspect ratio: ~12% ≈ 43 px on a 720 px tall window.
 */
export const AIRSPACE_SCREEN_INSET = 0.12;

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
 * When a drawn path runs out, look this far ahead along the heading: if that
 * point is off the field, the player was steering the plane out of the world
 * and it departs instead of turning back.
 */
export const EXIT_LOOKAHEAD = 8;

/**
 * Fixed sub-step (seconds) for flight integration. Steering is a feedback
 * loop, so a frame's dt is split into slices this size. That way 30, 60 and
 * 144 Hz displays fly the same curves.
 */
export const FLIGHT_SUBSTEP = 1 / 120;

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

/** Touchdown speed as a fraction of cruise. */
export const LANDING_SPEED_START = 0.8;

/**
 * Runway layout as fractions of the world size (CLAUDE.md responsiveness
 * rule). `heading` is the landing direction. `apronSide` puts the taxiway
 * and hangars on the runway's right (+1) or left (-1), looking along the
 * landing direction: red and blue face the middle of the field, yellow's
 * go north of its strip, clear of the red/blue hangars on narrow screens.
 */
export const RUNWAY_LAYOUT: ReadonlyArray<{
  color: RunwayColor;
  fx: number;
  fy: number;
  heading: number;
  apronSide: 1 | -1;
}> = [
  // fy 0.72 (not 0.7) keeps the long diagonal strips clear of the stream.
  { color: "red", fx: 0.25, fy: 0.72, heading: (-3 * Math.PI) / 4, apronSide: 1 },
  { color: "blue", fx: 0.75, fy: 0.72, heading: -Math.PI / 4, apronSide: -1 },
  { color: "yellow", fx: 0.5, fy: 0.3, heading: 0, apronSide: -1 },
];

// ---------------------------------------------------------------------------
// Airfield: taxiways, stands and hangars (see core/airfield.ts)
// ---------------------------------------------------------------------------
//
// Laid out in each runway's own frame: `u` runs along the landing direction
// from the runway centre (the far end is at +RUNWAY_LENGTH / 2), `v` runs
// sideways towards the apron (see `apronSide`).
//
//        hangar      hangar          v = HANGAR_DOOR_V … + HANGAR_DEPTH
//        [stand]     [stand]         v = STAND_V
//   ======H=====leadIn======leadIn=== v = TAXIWAY_OFFSET  (parallel taxiway)
//        /                            45° turnoff
//   ----X---------------------------  v = 0  (runway centreline)

/** `u` where the turnoff leaves the runway centreline. */
export const RUNWAY_EXIT_U = -3;

/** Distance from the runway centreline to the parallel taxiway. */
export const TAXIWAY_OFFSET = 6.5;

/** `u` of each stand (one hangar per stand), nearest the turnoff first. */
export const STAND_U: readonly number[] = [10, 18.5];

/** `v` of each stand, where a plane slows to hangar speed and rolls on in. */
export const STAND_V = 12;

/** `v` of the hangar doorway (its open front), and the hangar's size. */
export const HANGAR_DOOR_V = 14.8;
export const HANGAR_DEPTH = 6.2;
export const HANGAR_WIDTH = 7;

/** `u` of the hold point on the taxiway, where planes wait for a free stand. */
export const HOLD_U = 6.5;

/** Paved taxiway width. */
export const TAXIWAY_WIDTH = 3.2;

/**
 * Corner radius of taxi routes. The planner rounds every corner into an arc
 * (shrinking it where segments are short), so turns are always smooth.
 */
export const TAXI_TURN_RADIUS = 6;
/** Tighter radius for the 90° turn off the taxiway into a stand. */
export const STAND_TURN_RADIUS = 3;

/**
 * After touchdown the plane curves onto the runway centreline over this
 * distance, whatever its lateral offset or heading error at the threshold.
 */
export const CENTERLINE_MERGE_DISTANCE = 8;

// ---------------------------------------------------------------------------
// Ground movement (see core/ground.ts)
// ---------------------------------------------------------------------------

/** Speed through the runway turnoff (units / second). */
export const TURNOFF_SPEED = 3.5;

/** Cruising speed along the taxiway. */
export const TAXI_SPEED = 3;

/** Speed rolling from the stand into the hangar. */
export const STOW_SPEED = 1.4;

/** Gentle braking along the runway, from touchdown down to `TURNOFF_SPEED`. */
export const ROLLOUT_BRAKE = 0.6;

/** Braking used to stop at the end of a route (stand, hold point, hangar). */
export const TAXI_BRAKE = 0.9;

/** Braking used to stop behind another plane. */
export const TRAFFIC_BRAKE = 1.6;

/** Firmest braking ever applied, when a stop is needed sooner than planned. */
export const MAX_GROUND_BRAKE = 4;

/** Acceleration when pulling away (units / second²). */
export const GROUND_ACCEL = 1.2;

/**
 * A plane on the ground won't move onto a point of its route that is closer
 * than this to another plane on the ground. It stops `GROUND_STOP_BUFFER`
 * short of the first such point, so queued planes sit nose to tail with a
 * small gap and never overlap.
 */
export const GROUND_SEPARATION = PLANE_RADIUS * 1.9;
export const GROUND_STOP_BUFFER = 1;

/** How far ahead along its route each plane looks for traffic. */
export const GROUND_LOOKAHEAD = 18;

/** Distance rolled after touchdown while the plane settles onto its wheels. */
export const FLARE_DISTANCE = 4.5;

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

/** Average width of the water surface (world units). */
export const STREAM_WIDTH = 7;

/** Water width wanders ±this fraction around `STREAM_WIDTH` along the river. */
export const STREAM_WIDTH_VARIATION = 0.15;

/**
 * Peak angle (radians) between the river's flow and its general direction.
 * The direction is steered by smooth noise, so most of the river swings
 * less than this; ~0.6 gives lazy curves, past ~1.3 bends loop back.
 */
export const STREAM_MEANDER_ANGLE = 1.1;

/** Typical river length of one meander (two opposite bends). */
export const STREAM_WAVELENGTH = 90;

/**
 * Preferred base line of the stream as a fraction of the world height:
 * 0.05 is just inside the top of the field. `placeStream` then pushes the
 * river away from it only as far as `STREAM_AIRFIELD_CLEARANCE` requires,
 * so it ends up skirting the yellow airfield (0.5 would thread it between
 * the yellow runway and the red/blue pair, if there's room).
 */
export const STREAM_BASE_FY = 0.05;

/** Minimum gap between the river's outer bank and any airfield footprint. */
export const STREAM_AIRFIELD_CLEARANCE = 6;

/** Sandy bank either side of the water, beyond the water's edge. */
export const STREAM_BANK_WIDTH = 1.2;

/** Candidate trees per 1000 units² (before rejection / density thinning). */
export const TREE_DENSITY = 0.8;

/** No tree closer than this to any runway edge, taxiway or hangar. */
export const TREE_RUNWAY_CLEARANCE = 8;

/** No tree closer than this to the stream's outer bank (≥ canopy radius). */
export const TREE_STREAM_CLEARANCE = 3.5;

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
// River boats (decorative, see core/boats.ts)
// ---------------------------------------------------------------------------

/**
 * Per boat type: cruising `speed` (units / second; planes fly at 7) and
 * `lane`, the sideways offset from the river's centre as a fraction of its
 * half-width. Different lanes let a fast motorboat overtake a sailboat.
 */
export const BOAT_TYPES = {
  sailboat: { speed: 1.8, lane: 0.3 },
  motorboat: { speed: 3.4, lane: 0.55 },
} as const;

/** Seconds between boat launches, picked at random in this range. */
export const BOAT_SPAWN_MIN = 8;
export const BOAT_SPAWN_MAX = 18;

/** Most boats on the river at once. */
export const BOAT_MAX = 3;

/**
 * Boats sail the river from this far (× world height) off one side of the
 * playfield to the same distance off the other.
 */
export const BOAT_ROUTE_MARGIN = 0.4;

/** Boats fade in/out over this distance at either end of their route. */
export const BOAT_FADE_DISTANCE = 8;

// ---------------------------------------------------------------------------
// Camera buttons
// ---------------------------------------------------------------------------

/** One press of a rotate button turns the view by 15°; presses accumulate. */
export const ROTATE_STEP = Math.PI / 12;

/** One press of a zoom button scales the view by 25%. */
export const ZOOM_STEP = 1.25;

/**
 * Arrow-key pan speed, in view half-heights per second. Scaling by the view
 * (not world units) keeps the on-screen speed the same at every zoom level.
 */
export const PAN_SPEED = 1.2;

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
