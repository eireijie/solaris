import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Base path: relative by default so `dist/` works from any static host and any
// sub-path. Override with VITE_BASE=/some/path/ for absolute asset URLs.
const base = process.env.VITE_BASE ?? "./";

export default defineConfig({
  base,
  plugins: [react()],
  worker: { format: "es" },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        platform: resolve(import.meta.dirname, "index.html"),
        demo: resolve(import.meta.dirname, "demo/index.html"),
        // Workbench dev harness (features/models/dev) — route-free, noindex.
        workbench: resolve(import.meta.dirname, "workbench.html"),
      },
    },
  },
  server: { port: 5180, strictPort: false },
  preview: { port: 4180 },
});
