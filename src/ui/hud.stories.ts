/**
 * HUD screens: the real `createHud` driven into each game phase.
 *
 * These stories mount the same module the game uses, so what you see here is
 * what ships. Buttons log their callbacks to the Actions panel instead of
 * driving a game. Tweak classes in hudMarkup.ts, the glow/button/arrow
 * styles in style.css, `TOAST_MS` in hud.ts or `AVOID_RADIUS` in
 * arrivalArrows.ts, and the story hot-reloads.
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
  /** Show sample arrival arrows round the screen edge. */
  arrivals: boolean;
}

/**
 * Sample arrival arrows, one per edge, as fractions of the screen. The
 * top-left and bottom-right ones land under the score panel and camera
 * buttons, so they show arrows sliding out from under the HUD.
 */
const SAMPLE_ARRIVALS: ReadonlyArray<{ color: RunwayColor; fx: number; fy: number; deg: number }> =
  [
    { color: "red", fx: 0.04, fy: 0, deg: 70 },
    { color: "blue", fx: 0.55, fy: 0, deg: 100 },
    { color: "yellow", fx: 1, fy: 0.45, deg: 170 },
    { color: "blue", fx: 0, fy: 0.6, deg: -10 },
    { color: "red", fx: 0.95, fy: 1, deg: -120 },
  ];

/** Arrow inset from the screen edge, matching render/arrivals.ts EDGE_INSET. */
const ARROW_INSET = 34;

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

/** Place the sample arrows once `root` is on the page and has a size. */
function showSampleArrivals(hud: Hud, root: HTMLElement): void {
  requestAnimationFrame(() => {
    const w = root.clientWidth;
    const h = root.clientHeight;
    const pin = (v: number, max: number) => Math.min(max - ARROW_INSET, Math.max(ARROW_INSET, v));
    hud.setArrivals(
      SAMPLE_ARRIVALS.map((a, i) => ({
        id: i,
        color: COLOR_HEX[a.color],
        x: pin(a.fx * w, w),
        y: pin(a.fy * h, h),
        angle: (a.deg * Math.PI) / 180,
      })),
    );
  });
}

const meta: Meta<HudArgs> = {
  title: "HUD/Screens",
  render: (args) => {
    const root = stage();
    const hud = createHud(root, args);
    applyArgs(hud, args);
    if (args.arrivals) showSampleArrivals(hud, root);
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
    arrivals: false,
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

/**
 * Arrival arrows on the screen edge, as planes are about to fly in. Arrows
 * that would sit under the score panel or camera buttons slide clear of them
 * (`data-arrow-avoid` in hudMarkup.ts).
 */
export const Arrivals: Story = { args: { phase: "playing", score: 8, arrivals: true } };

/** Paused banner over the (frozen) game. */
export const Paused: Story = { args: { phase: "paused", score: 12 } };

/**
 * A runway-unlock toast. It fades after `TOAST_MS` (hud.ts); change any arg
 * to replay it.
 */
export const Toast: Story = {
  args: { phase: "playing", score: 3, toast: "BLUE runway open", toastColor: "blue" },
};

/** Crash overlay with the final score. */
export const GameOver: Story = { args: { phase: "gameover", score: 27 } };
