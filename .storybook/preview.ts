/**
 * Global story setup: game stylesheet (Tailwind + HUD components) and a
 * full-screen canvas, since every element is designed to sit over the game.
 */
import type { Preview } from "@storybook/html-vite";
import "../src/style.css";

const preview: Preview = {
  parameters: {
    // Stories fill the preview like the game fills the window.
    layout: "fullscreen",
    controls: { expanded: true },
  },
};

export default preview;
