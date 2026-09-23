/**
 * The simulation step: the only place game state advances in time.
 *
 * Order matters:
 *   1. spawn   – new planes appear at the edges
 *   2. move    – every plane advances by dt
 *   3. land    – planes over a matching threshold start their rollout
 *   4. collide – any remaining flying planes that overlap end the game
 *   5. prune   – planes that finished rolling out are removed
 */
import { checkLanding } from "./landing";
import { detectCollisions } from "./collision";
import { updatePlane } from "./plane";
import { nextSpawnInterval, spawnPlane } from "./spawner";
import { resetGameState } from "./state";
import type { GameState, Rng, SimEvent } from "./types";

/** Begin a new shift: reset state and put the first plane in the air. */
export function startGame(state: GameState, rng: Rng = Math.random): void {
  resetGameState(state);
  spawnPlane(state, rng);
}

/**
 * Pause a running shift, or continue a paused one. No-op on the start and
 * game-over screens, so a stray key press can't resurrect a finished game.
 * @returns true if the phase changed.
 */
export function togglePause(state: GameState): boolean {
  if (state.phase === "playing") state.phase = "paused";
  else if (state.phase === "paused") state.phase = "playing";
  else return false;
  return true;
}

/**
 * Advance the game by `dt` seconds.
 * @returns what happened this step, for the UI and renderer to react to.
 */
export function step(state: GameState, dt: number, rng: Rng = Math.random): SimEvent[] {
  if (state.phase !== "playing" || dt <= 0) return [];
  const events: SimEvent[] = [];

  state.elapsed += dt;

  // 1. Spawn. Subtract (rather than zero) the timer so leftover time carries over.
  state.spawnTimer += dt;
  if (state.spawnTimer >= state.spawnInterval) {
    state.spawnTimer -= state.spawnInterval;
    const plane = spawnPlane(state, rng);
    if (plane) events.push({ type: "spawned", planeId: plane.id });
    state.spawnInterval = nextSpawnInterval(state.spawnInterval, state.score, state.elapsed);
  }

  // 2. Move.
  for (const plane of state.planes) updatePlane(plane, dt, state.world);

  // 3. Land.
  for (const plane of state.planes) {
    const runway = checkLanding(plane, state.runways);
    if (runway) {
      state.score++;
      events.push({ type: "landed", planeId: plane.id, color: runway.color });
    }
  }

  // 4. Collide.
  const { crash, warnings } = detectCollisions(state.planes);
  for (const plane of state.planes) plane.warning = warnings.has(plane.id);
  if (crash) {
    const [a, b] = crash;
    state.phase = "gameover";
    events.push({
      type: "crash",
      planeIds: [a.id, b.id],
      at: { x: (a.pos.x + b.pos.x) / 2, y: (a.pos.y + b.pos.y) / 2 },
    });
    // Leave the planes in place so the crash stays visible behind the overlay.
    return events;
  }

  // 5. Prune.
  state.planes = state.planes.filter((p) => p.phase !== "landed");
  return events;
}
