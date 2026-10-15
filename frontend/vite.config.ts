import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * S8: the release id the app reports with every problem report (`app_version`): VITE_APP_VERSION,
 * else the GIT_COMMIT build argument, else the current git commit, else the package version.
 */
function appVersion(): string {
  const fromEnv = process.env.VITE_APP_VERSION || process.env.GIT_COMMIT;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  try {
    return execSync("git rev-parse --short HEAD", { cwd: dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    try {
      const pkg = JSON.parse(readFileSync(path.resolve(dirname, "package.json"), "utf-8")) as { version?: string };
      return pkg.version ?? "unknown";
    } catch {
      return "unknown";
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  resolve: {
    alias: {
      "@": path.resolve(dirname, "./src"),
    },
  },
  build: {
    // AU-12: never ship source maps (or a `sourceMappingURL` comment) in the production bundle -- they
    // would hand anyone the app's original source. `vite` dev keeps its own in-memory maps regardless.
    sourcemap: false,
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
