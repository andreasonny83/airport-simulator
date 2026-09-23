/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  build: {
    // Babylon core is large even when tree-shaken; raise the warning threshold
    // so a normal build does not spam chunk-size warnings.
    chunkSizeWarningLimit: 2000,
  },
  test: {
    // Only the pure simulation layer is unit tested; it has no DOM dependency.
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
