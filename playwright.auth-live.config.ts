import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "auth-local-live.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  timeout: 380_000,
  use: {
    baseURL: process.env.AUTH_E2E_BASE_URL ?? "http://127.0.0.1:3300",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
