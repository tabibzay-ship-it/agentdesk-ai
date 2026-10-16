import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "auth-local-live.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 900_000,
  use: {
    baseURL: process.env.AUTH_E2E_BASE_URL ?? "http://127.0.0.1:3300",
    browserName: "chromium",
    trace: "off",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3300",
    cwd: process.env.AUTH_E2E_APP_DIR ?? ".",
    url: "http://127.0.0.1:3300/login",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
