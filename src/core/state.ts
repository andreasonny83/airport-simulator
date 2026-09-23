/**
 * Game state construction. The state object is plain data: the simulation
 * mutates it, the renderer and UI only read it.
 */
import { SPAWN_INTERVAL_START } from "../config";
import { computeWorldSize, layoutRunways } from "./layout";
import type { GameState } from "./types";

/** Fresh state for a viewport of the given aspect ratio, waiting on the start screen. */
export function createGameState(aspect: number): GameState {
  const world = computeWorldSize(aspect);
  return {
    phase: "start",
    score: 0,
    elapsed: 0,
    spawnTimer: 0,
    spawnInterval: SPAWN_INTERVAL_START,
    nextPlaneId: 1,
    world,
    runways: layoutRunways(world),
    planes: [],
  };
}

/** Clear planes/score/timers for a new shift. World and runways are kept. */
export function resetGameState(state: GameState): void {
  state.phase = "playing";
  state.score = 0;
  state.elapsed = 0;
  state.spawnTimer = 0;
  state.spawnInterval = SPAWN_INTERVAL_START;
  state.planes = [];
}

/** Recompute world size and runway layout after a viewport resize. */
export function resizeWorld(state: GameState, aspect: number): void {
  state.world = computeWorldSize(aspect);
  state.runways = layoutRunways(state.world);
}
