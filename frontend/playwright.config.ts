import { defineConfig } from "@playwright/test";

// The web app is published on 3211 (docker-compose.yml's `web` service maps
// "3211:80" -- this changed from the original plan's port 80 after the compose
// file was updated in a later task). E2E_BASE_URL still lets this be overridden
// for a differently-configured stack.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3211",
    trace: "retain-on-failure",
  },
});
