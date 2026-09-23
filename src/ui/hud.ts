/**
 * HTML HUD layered over the canvas: score, start/game-over overlay, pause
 * button and the camera buttons. Markup lives in index.html; this module
 * only wires it up.
 */
import type { GamePhase } from "../core/types";

export interface HudCallbacks {
  onStart: () => void;
  /** Pause button pressed (pause while playing, continue while paused). */
  onTogglePause: () => void;
  /** -1 = rotate counter-clockwise, +1 = clockwise. */
  onRotate: (direction: -1 | 1) => void;
  /** +1 = zoom in, -1 = zoom out. */
  onZoom: (direction: -1 | 1) => void;
}

export interface Hud {
  setScore(score: number): void;
  hideOverlay(): void;
  showGameOver(score: number): void;
  /** Sync the pause button and banner with the current game phase. */
  setPhase(phase: GamePhase): void;
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} in index.html`);
  return el as T;
}

export function createHud(callbacks: HudCallbacks): Hud {
  const score = byId("scoreDisplay");
  const overlay = byId("overlay");
  const title = byId("overlayTitle");
  const message = byId("overlayMessage");
  const startBtn = byId<HTMLButtonElement>("startBtn");
  const pauseBtn = byId<HTMLButtonElement>("pauseBtn");
  const pausedBanner = byId("pausedBanner");

  startBtn.addEventListener("click", callbacks.onStart);
  pauseBtn.addEventListener("click", () => {
    callbacks.onTogglePause();
    // Drop focus so a later Space/Enter doesn't re-press the button by accident.
    pauseBtn.blur();
  });
  byId("rotateLeftBtn").addEventListener("click", () => callbacks.onRotate(-1));
  byId("rotateRightBtn").addEventListener("click", () => callbacks.onRotate(1));
  byId("zoomInBtn").addEventListener("click", () => callbacks.onZoom(1));
  byId("zoomOutBtn").addEventListener("click", () => callbacks.onZoom(-1));

  return {
    setScore(value) {
      score.textContent = String(value);
    },
    hideOverlay() {
      overlay.classList.add("opacity-0", "pointer-events-none");
    },
    showGameOver(value) {
      title.textContent = "CRASH!";
      title.classList.replace("text-sky-400", "text-red-500");
      title.classList.replace("glow-text", "glow-text-red");
      message.textContent = `You safely landed ${value} aircraft.`;
      startBtn.textContent = "TRY AGAIN";
      overlay.classList.remove("opacity-0", "pointer-events-none");
    },
    setPhase(phase) {
      const inShift = phase === "playing" || phase === "paused";
      const paused = phase === "paused";
      pauseBtn.classList.toggle("hidden", !inShift);
      pauseBtn.textContent = paused ? "▶" : "⏸";
      pauseBtn.title = paused ? "Continue (P / Esc)" : "Pause (P / Esc)";
      pauseBtn.setAttribute("aria-label", paused ? "Continue" : "Pause");
      pauseBtn.setAttribute("aria-pressed", String(paused));
      // `hidden` and `flex` both set `display`, so swap them rather than stack.
      pausedBanner.classList.toggle("hidden", !paused);
      pausedBanner.classList.toggle("flex", paused);
    },
  };
}
