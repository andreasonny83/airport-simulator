/**
 * HUD markup, one template per element.
 *
 * Lives in TypeScript rather than index.html so the game (via `createHud`)
 * and Storybook (src/ui/hud.stories.ts) render the exact same elements:
 * tweak a class here and both update. Tailwind picks up the class names
 * from this file like any other source file.
 *
 * Templates are static strings: anything dynamic (score, toast text, pause
 * state) is filled in by `hud.ts` at runtime.
 */

/** "Landed" counter, top-left. */
export function scorePanelMarkup(): string {
  return `
    <div class="pointer-events-none absolute top-4 left-4 z-10">
      <div
        data-arrow-avoid
        class="rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 shadow-lg backdrop-blur-sm"
      >
        <span class="text-sm font-bold tracking-wider text-slate-400 uppercase">Landed</span>
        <div id="scoreDisplay" class="glow-text text-3xl font-black text-sky-400">0</div>
      </div>
    </div>`;
}

/** Pause / continue, top-right. Hidden until a shift starts (see `setPhase`). */
export function pauseButtonMarkup(): string {
  return `
    <div class="absolute top-4 right-4 z-10">
      <button
        id="pauseBtn"
        data-arrow-avoid
        class="hud-button hidden"
        title="Pause (P / Esc)"
        aria-label="Pause"
        aria-pressed="false"
      >
        ⏸
      </button>
    </div>`;
}

/** Paused banner: pointer-events-none so the camera buttons still work. */
export function pausedBannerMarkup(): string {
  return `
    <div
      id="pausedBanner"
      class="pointer-events-none absolute inset-0 z-10 hidden items-center justify-center"
    >
      <div
        class="rounded-2xl border border-slate-700 bg-slate-900/70 px-8 py-4 text-center shadow-lg backdrop-blur-sm"
      >
        <div class="glow-text text-4xl font-black tracking-widest text-sky-400">PAUSED</div>
        <div class="mt-1 text-sm text-slate-300">Press ▶, P or Esc to continue</div>
      </div>
    </div>`;
}

/** Toast: short notices such as "BLUE runway open"; fades via opacity. */
export function toastMarkup(): string {
  return `
    <div class="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
      <div
        id="toast"
        role="status"
        aria-live="polite"
        class="rounded-2xl border border-slate-700 bg-slate-900/70 px-6 py-2 text-lg font-black tracking-widest uppercase opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-500"
      ></div>
    </div>`;
}

/** Camera controls (buttons only: every drag on the canvas draws a path). */
export function cameraControlsMarkup(): string {
  return `
    <div
      data-arrow-avoid
      class="absolute right-4 bottom-4 z-10 flex gap-2"
      aria-label="Camera controls"
    >
      <button id="rotateLeftBtn" class="hud-button" title="Rotate left" aria-label="Rotate left">
        ⟲
      </button>
      <button id="rotateRightBtn" class="hud-button" title="Rotate right" aria-label="Rotate right">
        ⟳
      </button>
      <button id="zoomOutBtn" class="hud-button" title="Zoom out" aria-label="Zoom out">−</button>
      <button id="zoomInBtn" class="hud-button" title="Zoom in" aria-label="Zoom in">+</button>
    </div>`;
}

/**
 * Layer for arrival arrows (see arrivalArrows.ts). Below the other HUD
 * panels; arrows slide out from under any element marked
 * `data-arrow-avoid` (score, pause, camera buttons), so neither hides the other.
 */
export function arrivalLayerMarkup(): string {
  return `
    <div
      id="arrivals"
      class="pointer-events-none absolute inset-0 z-[5] overflow-hidden"
      aria-hidden="true"
    ></div>`;
}

/**
 * One arrival arrow, pinned to the screen edge where an off-screen plane
 * will fly in. Drawn pointing right (+x); `arrivalArrows.ts` positions the
 * wrapper and rotates the SVG to the plane's direction of travel, and sets
 * `color` to the plane's runway colour (the SVG paints in currentColor).
 */
export function arrivalArrowMarkup(): string {
  return `
    <div class="arrival-arrow absolute top-0 left-0 -mt-6 -ml-6 h-12 w-12 drop-shadow-lg">
      <svg viewBox="-24 -24 48 48" class="h-full w-full overflow-visible">
        <circle class="arrival-ring" r="17" fill="none" stroke="currentColor" stroke-width="3" />
        <circle r="14" fill="#0f172a" fill-opacity="0.55" />
        <path
          d="M 13 0 L 2 -10 L 2 -4 L -11 -4 L -11 4 L 2 4 L 2 10 Z"
          fill="currentColor"
          stroke="#f8fafc"
          stroke-width="1.8"
          stroke-linejoin="round"
        />
      </svg>
    </div>`;
}

/**
 * Start / game-over overlay. The game-over variant (text, and a see-through
 * backdrop so the crash stays visible) is patched in by `showGameOver`; keep
 * the backdrop classes here in sync with `START_BACKDROP` in hud.ts.
 */
export function overlayMarkup(): string {
  return `
    <div
      id="overlay"
      class="absolute inset-0 z-20 flex flex-col items-center justify-center bg-slate-950/80 backdrop-blur-md transition-opacity duration-300"
    >
      <h1 id="overlayTitle" class="glow-text mb-4 text-5xl font-black text-sky-400 md:text-6xl">
        RADAR COMMAND
      </h1>
      <p id="overlayMessage" class="mb-8 max-w-md px-4 text-center text-lg text-slate-300">
        Drag a path from the airplanes to their matching colored runways. Land them over the colored
        threshold, following the arrow. Don't let them crash!
      </p>
      <button
        id="startBtn"
        class="transform rounded-full bg-sky-500 px-8 py-4 text-xl font-bold text-slate-950 shadow-[0_0_20px_rgba(14,165,233,0.5)] transition-all hover:scale-105 hover:bg-sky-400 active:scale-95"
      >
        START SHIFT
      </button>
    </div>`;
}

/** The whole HUD, in stacking order (the overlay last, on top). */
export function hudMarkup(): string {
  return [
    arrivalLayerMarkup(),
    scorePanelMarkup(),
    pauseButtonMarkup(),
    pausedBannerMarkup(),
    toastMarkup(),
    cameraControlsMarkup(),
    overlayMarkup(),
  ].join("");
}
