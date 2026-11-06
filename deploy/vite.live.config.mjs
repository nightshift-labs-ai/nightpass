// Builds deploy/live-web (reads the deployed contracts on the preview network) into ../dist/live.
import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
export default defineConfig({ root: "live-web", base: "./", plugins: [wasm()], build: { outDir: "../../dist/live", emptyOutDir: true, target: "esnext" } });
