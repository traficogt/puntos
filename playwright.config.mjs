import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  retries: 1,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:3001",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "firefox",
      testIgnore: "**/webkit-customer.spec.js",
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "chromium",
      testIgnore: "**/webkit-customer.spec.js",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
      },
    },
    ...(process.env.E2E_WEBKIT === "1"
      ? [
          {
            name: "webkit",
            testMatch: "**/webkit-customer.spec.js",
            timeout: 120_000,
            retries: 0,
            use: { ...devices["Desktop Safari"], browserName: "webkit", serviceWorkers: "block" },
          },
        ]
      : []),
  ],
});
