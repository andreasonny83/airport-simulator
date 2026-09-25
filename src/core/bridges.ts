/**
 * Drawbridges: the bridges where roads cross the river (see
 * `Countryside.bridges`) are low enough for motorboats to pass under, but
 * sailboats' masts need them open. Each bridge's two leaves lift when a
 * sailboat is on its way (see `bridgeDemand` in core/boats.ts).
 *
 * The sequence, like a real one:
 *   1. a sailboat approaches: the bridge closes to cars (barriers down) and
 *      waits until no car is left on the span;
 *   2. the leaves lift (`lift` 0 → 1); the sailboat waits short of the
 *      bridge until they're fully up;
 *   3. once the sailboat is through, the leaves come down and the bridge
 *      reopens to traffic.
 *
 * Decoration only, like the cars and boats: pure and deterministic.
 */
import { BRIDGE_LIFT_TIME } from "../config";
import type { Bridge } from "./countryside";

export interface BridgeState {
  bridge: Bridge;
  /** 0 = down (open to cars), 1 = fully up (open to boats). */
  lift: number;
  /** A sailboat wants through. */
  wanted: boolean;
}

export function createBridgeStates(bridges: readonly Bridge[]): BridgeState[] {
  return bridges.map((bridge) => ({ bridge, lift: 0, wanted: false }));
}

/** True while cars must not drive onto the bridge (barriers down). */
export function closedToCars(state: BridgeState): boolean {
  return state.wanted || state.lift > 0;
}

/** True once the leaves are up far enough for a mast to pass. */
export function openToBoats(state: BridgeState): boolean {
  return state.lift >= 0.98;
}

/**
 * Advance every bridge by `dt` seconds.
 * @param demand      per bridge: a sailboat wants through
 * @param carsOnSpan  per bridge: a car is still on it
 */
export function stepBridges(
  states: readonly BridgeState[],
  dt: number,
  demand: readonly boolean[],
  carsOnSpan: readonly boolean[],
): void {
  states.forEach((state, i) => {
    state.wanted = demand[i] ?? false;
    const rate = dt / BRIDGE_LIFT_TIME;
    // Lifts only with the span clear; lowers again if a car is ever on it.
    if (state.wanted && !carsOnSpan[i]) state.lift = Math.min(1, state.lift + rate);
    else state.lift = Math.max(0, state.lift - rate);
  });
}
