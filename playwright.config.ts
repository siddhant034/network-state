import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.pw.ts",
  fullyParallel: true,
  reporter: "list",
  outputDir: "/tmp/network-state-playwright-results",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      testIgnore: "**/mobile-config.pw.ts",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "firefox",
      testIgnore: "**/mobile-config.pw.ts",
      use: { ...devices["Desktop Firefox"] }
    },
    {
      name: "webkit",
      testIgnore: "**/mobile-config.pw.ts",
      use: { ...devices["Desktop Safari"] }
    },
    {
      name: "webkit-iphone",
      testMatch: "**/mobile-config.pw.ts",
      use: { ...devices["iPhone 13"] }
    }
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 4173 --strictPort",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: false,
    timeout: 30_000
  }
});
