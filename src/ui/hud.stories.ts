/**
 * HUD screens: the real `createHud` driven into each game phase.
 *
 * These stories mount the same module the game uses, so what you see here is
 * what ships. Buttons log their callbacks to the Actions panel instead of
 * driving a game. Tweak classes in hudMarkup.ts, the glow/button styles in
 * style.css, or `TOAST_MS` in hud.ts, and the story hot-reloads.
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import { fn } from "storybook/test";
import { COLOR_HEX } from "../config";
import type { GamePhase, RunwayColor } from "../core/types";
import { createHud, type Hud, type HudCallbacks } from "./hud";

interface HudArgs extends HudCallbacks {
  phase: GamePhase;
  score: number;
  /** Toast text; empty = no toast. */
  toast: string;
  /** Runway colour to tint the toast with, or "none" for the default white. */
  toastColor: RunwayColor | "none";
}

/** Full-window stage matching the game's `<body>`. */
function stage(): HTMLElement {
  const el = document.createElement("div");
  el.className = "relative h-full w-full overflow-hidden text-slate-100";
  return el;
}

/** Put a freshly mounted HUD into the state described by `args`. */
function applyArgs(hud: Hud, args: HudArgs): void {
  hud.setScore(args.score);
  if (args.phase === "gameover") hud.showGameOver(args.score);
  else if (args.phase !== "start") hud.hideOverlay();
  hud.setPhase(args.phase);
  if (args.toast) {
    hud.showToast(args.toast, args.toastColor === "none" ? undefined : COLOR_HEX[args.toastColor]);
  }
}

const meta: Meta<HudArgs> = {
  title: "HUD/Screens",
  render: (args) => {
    const root = stage();
    applyArgs(createHud(root, args), args);
    return root;
  },
  argTypes: {
    phase: { control: "inline-radio", options: ["start", "playing", "paused", "gameover"] },
    score: { control: { type: "number", min: 0, step: 1 } },
    toastColor: { control: "inline-radio", options: ["none", "red", "blue", "yellow"] },
    // Callbacks are wired to the Actions panel; no control needed.
    onStart: { table: { disable: true } },
    onTogglePause: { table: { disable: true } },
    onRotate: { table: { disable: true } },
    onZoom: { table: { disable: true } },
  },
  args: {
    phase: "start",
    score: 0,
    toast: "",
    toastColor: "none",
    onStart: fn(),
    onTogglePause: fn(),
    onRotate: fn(),
    onZoom: fn(),
  },
};
export default meta;

type Story = StoryObj<HudArgs>;

/** Title screen shown on load. */
export const StartScreen: Story = {};

/** Mid-shift: score, pause button and camera controls. */
export const Playing: Story = { args: { phase: "playing", score: 12 } };

/** Paused banner over the (frozen) game. */
export const Paused: Story = { args: { phase: "paused", score: 12 } };

/**
 * A runway-unlock toast. It fades after `TOAST_MS` (hud.ts); change any arg
 * to replay it.
 */
export const Toast: Story = {
  args: { phase: "playing", score: 3, toast: "BLUE runway open", toastColor: "blue" },
};

/** Edge-drag notice: the same toast, untinted. */
export const EdgeNotice: Story = {
  args: { phase: "playing", score: 5, toast: "Paths end at the edge — plane will fly off" },
};

/** Crash overlay with the final score. */
export const GameOver: Story = { args: { phase: "gameover", score: 27 } };
