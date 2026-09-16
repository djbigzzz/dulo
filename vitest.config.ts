import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Root tsconfig uses jsx: "preserve" (Next); tests that import .tsx need the automatic runtime.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
