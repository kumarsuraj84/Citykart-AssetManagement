import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // Playwright's own specs live under e2e/ (*.spec.ts) and are run by
    // `npx playwright test`, not vitest -- without this exclusion vitest's
    // default include glob also picks them up and tries to execute them as
    // unit tests (no baseURL/fixtures/browser, so they fail outright).
    exclude: ["node_modules/**", "e2e/**"],
  },
});
