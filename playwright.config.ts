import { defineConfig, devices } from "@playwright/test";

const appPort = Number(process.env.TEST_APP_PORT ?? 3100);
const appOrigin = `http://127.0.0.1:${appPort}`;

export default defineConfig({
  testDir: "./tests/browser",
  outputDir: "test-results/browser/artifacts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "test-results/browser/report" }],
    ["junit", { outputFile: "test-results/browser/results.xml" }],
  ],
  use: {
    baseURL: appOrigin,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --webpack --port ${appPort}`,
    url: `${appOrigin}/login`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI && !process.env.PLAYWRIGHT_TEST_ISOLATED,
  },
});
