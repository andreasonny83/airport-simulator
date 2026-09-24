/**
 * Keyboard pan input: tracks which arrow keys are held and exposes them as a
 * screen-space direction the camera turns into ground movement each frame.
 *
 * Polling held keys (rather than moving on each `keydown`) gives smooth,
 * frame-rate independent panning: the OS key-repeat rate never matters.
 */
import type { Vec2 } from "../core/types";

/** Arrow key → screen direction (+x right, +y up the screen). */
const ARROW_DIRECTIONS: Record<string, Vec2> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowDown: { x: 0, y: -1 },
};

export interface PanKeys {
  /** Current pan direction: each axis in [-1, 1], normalised on diagonals. */
  direction(): Vec2;
}

export function attachPanKeys(target: Window = window): PanKeys {
  const held = new Set<string>();

  target.addEventListener("keydown", (e) => {
    if (!(e.key in ARROW_DIRECTIONS)) return;
    // Arrows would otherwise scroll the page (or a focused HUD element).
    e.preventDefault();
    held.add(e.key);
  });
  target.addEventListener("keyup", (e) => held.delete(e.key));
  // Keyups that happen while the window is unfocused never arrive, so drop
  // everything on blur or the camera would keep drifting on return.
  target.addEventListener("blur", () => held.clear());

  return {
    direction() {
      let x = 0;
      let y = 0;
      for (const key of held) {
        const d = ARROW_DIRECTIONS[key];
        if (!d) continue;
        x += d.x;
        y += d.y;
      }
      // Diagonals would otherwise be √2 faster than a single arrow.
      const len = Math.hypot(x, y);
      return len > 0 ? { x: x / len, y: y / len } : { x: 0, y: 0 };
    },
  };
}
