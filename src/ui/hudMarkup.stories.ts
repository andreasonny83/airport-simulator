/**
 * HUD elements one at a time, straight from their hudMarkup.ts templates.
 *
 * Useful for styling a single piece without the rest of the HUD on top.
 * Elements that start hidden in the game (pause button, paused banner,
 * toast) are forced visible here.
 */
import type { Meta, StoryObj } from "@storybook/html-vite";
import {
  cameraControlsMarkup,
  overlayMarkup,
  pauseButtonMarkup,
  pausedBannerMarkup,
  scorePanelMarkup,
  toastMarkup,
} from "./hudMarkup";

/** Full-window stage matching the game's `<body>`, holding one template. */
function stage(markup: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "relative h-full w-full overflow-hidden text-slate-100";
  el.innerHTML = markup;
  return el;
}

/** Fetch an element the template is known to contain. */
function part(root: HTMLElement, id: string): HTMLElement {
  const el = root.querySelector<HTMLElement>(`#${id}`);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
}

const meta: Meta = { title: "HUD/Elements" };
export default meta;

type Story = StoryObj;

export const ScorePanel: StoryObj<{ score: number }> = {
  args: { score: 42 },
  argTypes: { score: { control: { type: "number", min: 0, step: 1 } } },
  render: ({ score }) => {
    const root = stage(scorePanelMarkup());
    part(root, "scoreDisplay").textContent = String(score);
    return root;
  },
};

export const PauseButton: StoryObj<{ paused: boolean }> = {
  args: { paused: false },
  render: ({ paused }) => {
    const root = stage(pauseButtonMarkup());
    const btn = part(root, "pauseBtn");
    btn.classList.remove("hidden");
    btn.textContent = paused ? "▶" : "⏸";
    return root;
  },
};

export const PausedBanner: Story = {
  render: () => {
    const root = stage(pausedBannerMarkup());
    part(root, "pausedBanner").classList.replace("hidden", "flex");
    return root;
  },
};

export const Toast: StoryObj<{ text: string; color: string }> = {
  args: { text: "YELLOW runway open", color: "#eab308" },
  argTypes: { color: { control: "color" } },
  render: ({ text, color }) => {
    const root = stage(toastMarkup());
    const toast = part(root, "toast");
    toast.textContent = text;
    toast.style.color = color;
    toast.classList.remove("opacity-0");
    return root;
  },
};

export const CameraControls: Story = { render: () => stage(cameraControlsMarkup()) };

export const Overlay: Story = { render: () => stage(overlayMarkup()) };
