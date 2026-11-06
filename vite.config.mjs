import { defineConfig } from "vite";
import wasm from "vite-plugin-wasm";
export default defineConfig({ root: "web", base: "./", plugins: [wasm()], build: { outDir: "../dist", emptyOutDir: true, target: "esnext" },
  optimizeDeps: { exclude: ["@midnightntwrk/onchain-runtime-v4"] }, worker: { format: "es" } });
