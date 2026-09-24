/**
 * Flight animation tuning: how planes *look* in flight. Covers banking, wing
 * flex, props, lights and the visual wind.
 *
 * Purely visual, like everything in src/render: the sim never reads any of
 * this, so no preset can change where a plane actually goes, when it lands
 * or when it crashes.
 *
 * Values are grouped into named presets. The game plays `ACTIVE_PRESET`.
 * Storybook ("Tuning/Flight") shows one story per preset with a control for
 * every value, and a panel that turns the tweaked values into a preset
 * block to paste into `FLIGHT_PRESETS` below. To ship a variation:
 *
 *   1. tweak it in Storybook, copy the snippet;
 *   2. paste it into `FLIGHT_PRESETS` (new name, or over an existing one);
 *   3. point `ACTIVE_PRESET` at it.
 *
 * Angles are radians, times seconds, distances world units.
 */
import type { AircraftKind } from "./aircraft";

export interface FlightTuning {
  // --- Banking (sceneSync.ts) -----------------------------------------------
  /** Bank angle when turning at MAX_TURN_RATE (radians; 0.6 ≈ 35°). */
  maxBank: number;
  /**
   * Easing time constant for the displayed yaw. The sim heading is already
   * smooth; this only hides the snap onto the runway heading at touchdown,
   * so keep it short or turns visibly lag.
   */
  yawEase: number;
  /** Easing time constant for the bank: higher = lazier roll in and out. */
  bankEase: number;

  // --- Aircraft animation (aircraft.ts) --------------------------------------
  /** Resting dihedral of the flexible wing tips (radians). */
  flexBase: number;
  /** Extra flex per unit of extra load factor (1/cos(bank) − 1) in a turn. */
  flexLoad: number;
  /** Extra flex per unit of turbulence chop (−1..1). */
  flexBump: number;
  /** Wing flex multiplier per model: long swept jet wings bend most. */
  flexAirliner: number;
  flexTurboprop: number;
  flexLight: number;
  /** Prop speed (rad/s). Keep below ~40 so 60 Hz frames don't alias badly. */
  spinTurboprop: number;
  spinLight: number;
  /** Props wind down to this share of full speed by the end of the rollout. */
  rolloutSpin: number;
  /** White strobe double-flash cycle (seconds). */
  strobePeriod: number;
  /** Red beacon blink cycle (seconds). */
  beaconPeriod: number;

  // --- Wind (wind.ts) --------------------------------------------------------
  /** Largest drift offset along the wind (world units). */
  driftAmplitude: number;
  /** Largest sideways wander across the wind, as a fraction of the drift. */
  wanderShare: number;
  /** Largest crab angle into a full-strength crosswind (radians). */
  maxCrab: number;
  /** Largest turbulence roll wobble (radians); pitch uses half. */
  bumpAmplitude: number;
  /** Largest altitude bob (scene units). */
  liftAmplitude: number;
  /** Prevailing wind direction (sim radians: 0 = +x, π/2 = down the screen). */
  windDirection: number;
  /** How far the wind slowly veers either side of `windDirection` (radians). */
  windVeer: number;
}

/** Named variations. `default` is the original hand-tuned look. */
export const FLIGHT_PRESETS = {
  default: {
    maxBank: 0.6,
    yawEase: 0.05,
    bankEase: 0.2,
    flexBase: 0.02,
    flexLoad: 0.12,
    flexBump: 0.035,
    flexAirliner: 1,
    flexTurboprop: 0.6,
    flexLight: 0.3,
    spinTurboprop: 28,
    spinLight: 34,
    rolloutSpin: 0.3,
    strobePeriod: 1.3,
    beaconPeriod: 1,
    driftAmplitude: 0.1,
    wanderShare: 0.1,
    maxCrab: 0.1,
    bumpAmplitude: 0.1,
    liftAmplitude: 0.1,
    windDirection: Math.PI * 0.15,
    windVeer: 0.5,
  },
  /** Still air: planes glide, barely any wobble. */
  calm: {
    maxBank: 0.5,
    yawEase: 0.05,
    bankEase: 0.3,
    flexBase: 0.02,
    flexLoad: 0.1,
    flexBump: 0.01,
    flexAirliner: 1,
    flexTurboprop: 0.6,
    flexLight: 0.3,
    spinTurboprop: 28,
    spinLight: 34,
    rolloutSpin: 0.3,
    strobePeriod: 1.3,
    beaconPeriod: 1,
    driftAmplitude: 0.03,
    wanderShare: 0.05,
    maxCrab: 0.03,
    bumpAmplitude: 0.02,
    liftAmplitude: 0.03,
    windDirection: Math.PI * 0.15,
    windVeer: 0.2,
  },
  /** Blustery day: visible crab, drift and bumps, still inside the grab radius. */
  gusty: {
    maxBank: 0.6,
    yawEase: 0.05,
    bankEase: 0.2,
    flexBase: 0.02,
    flexLoad: 0.12,
    flexBump: 0.08,
    flexAirliner: 1,
    flexTurboprop: 0.6,
    flexLight: 0.3,
    spinTurboprop: 28,
    spinLight: 34,
    rolloutSpin: 0.3,
    strobePeriod: 1.3,
    beaconPeriod: 1,
    driftAmplitude: 0.6,
    wanderShare: 0.4,
    maxCrab: 0.18,
    bumpAmplitude: 0.18,
    liftAmplitude: 0.35,
    windDirection: Math.PI * 0.15,
    windVeer: 0.8,
  },
  /** Arcade feel: steep, snappy banking and bendy wings. */
  aerobatic: {
    maxBank: 1,
    yawEase: 0.04,
    bankEase: 0.1,
    flexBase: 0.03,
    flexLoad: 0.2,
    flexBump: 0.035,
    flexAirliner: 1,
    flexTurboprop: 0.7,
    flexLight: 0.4,
    spinTurboprop: 32,
    spinLight: 38,
    rolloutSpin: 0.3,
    strobePeriod: 1.3,
    beaconPeriod: 1,
    driftAmplitude: 0.1,
    wanderShare: 0.1,
    maxCrab: 0.1,
    bumpAmplitude: 0.1,
    liftAmplitude: 0.1,
    windDirection: Math.PI * 0.15,
    windVeer: 0.5,
  },
} satisfies Record<string, FlightTuning>;

export type FlightPresetName = keyof typeof FLIGHT_PRESETS;

/** The preset the game plays. */
export const ACTIVE_PRESET: FlightPresetName = "default";

/**
 * Live values, read by the render code every frame. Mutable only so
 * Storybook can swap presets and apply control tweaks without a reload; the
 * game never writes to it.
 */
export const flightTuning: FlightTuning = { ...FLIGHT_PRESETS[ACTIVE_PRESET] };

/** Replace the live values (Storybook), or reset them with no argument. */
export function setFlightTuning(values: FlightTuning = FLIGHT_PRESETS[ACTIVE_PRESET]): void {
  Object.assign(flightTuning, values);
}

/** Wing flex multiplier for a model. */
export function kindFlex(kind: AircraftKind): number {
  const t = flightTuning;
  return kind === "airliner"
    ? t.flexAirliner
    : kind === "turboprop"
      ? t.flexTurboprop
      : t.flexLight;
}

/** Prop speed (rad/s) for a model; jets have none. */
export function kindSpin(kind: AircraftKind): number {
  const t = flightTuning;
  return kind === "turboprop" ? t.spinTurboprop : kind === "light" ? t.spinLight : 0;
}
