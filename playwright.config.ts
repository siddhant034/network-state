import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.GITHUB_ACTIONS
  ? "http://127.0.0.1:4173/network-state/"
  : "http://127.0.0.1:4173/";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { outputFolder: "playwright-report", open: "never" }]]
    : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
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
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000
  }
});
