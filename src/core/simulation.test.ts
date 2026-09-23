import { describe, expect, it } from "vitest";
import { createPlane } from "./plane";
import { startGame, step } from "./simulation";
import { createGameState } from "./state";

/** Deterministic rng for reproducible spawns. */
const rng = () => 0.5;

describe("step", () => {
  it("does nothing before the shift starts", () => {
    const state = createGameState(16 / 9);
    expect(step(state, 1, rng)).toEqual([]);
    expect(state.planes).toEqual([]);
  });

  it("startGame spawns one plane and enters the playing phase", () => {
    const state = createGameState(16 / 9);
    startGame(state, rng);
    expect(state.phase).toBe("playing");
    expect(state.planes).toHaveLength(1);
  });

  it("scores and prunes a plane that lands", () => {
    const state = createGameState(16 / 9);
    startGame(state, rng);
    const runway = state.runways[0]!;
    state.planes = [createPlane(99, runway.color, { ...runway.threshold }, runway.heading)];
    const events = step(state, 0.01, rng);
    expect(events).toContainEqual({ type: "landed", planeId: 99, color: runway.color });
    expect(state.score).toBe(1);
    // Roll out completely: the plane is pruned.
    for (let i = 0; i < 300; i++) step(state, 1 / 60, rng);
    expect(state.planes.find((p) => p.id === 99)).toBeUndefined();
  });

  it("ends the game on collision", () => {
    const state = createGameState(16 / 9);
    startGame(state, rng);
    state.planes = [
      createPlane(1, "red", { x: 40, y: 20 }, 0),
      createPlane(2, "blue", { x: 41, y: 20 }, Math.PI),
    ];
    const events = step(state, 0.01, rng);
    expect(events.some((e) => e.type === "crash")).toBe(true);
    expect(state.phase).toBe("gameover");
    // Frozen after game over.
    expect(step(state, 1, rng)).toEqual([]);
  });

  it("spawns a new plane once spawnInterval elapses", () => {
    const state = createGameState(16 / 9);
    startGame(state, rng);
    state.planes = [];
    step(state, state.spawnInterval + 0.001, rng);
    expect(state.planes).toHaveLength(1);
  });
});
