import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "chat-isolated.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 900_000,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3400",
    browserName: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 120_000,
  },
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1 --port 3400",
    url: "http://127.0.0.1:3400/login",
    // A production server avoids Windows dev-server Fast Refresh restarts while
    // the long authenticated workflow changes routes and viewport sizes.
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
