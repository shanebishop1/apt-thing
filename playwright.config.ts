import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end configuration. The suite drives a real `next dev` server whose Cloudflare dev
 * bridge is pointed at `e2e/wrangler.e2e.jsonc`, so requests hit the local D1 emulator instead
 * of mocks. Provider keys are deliberately blank: extraction then produces manual-review
 * records, which is what the specs assert against.
 */
const port = 3111;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // The suite shares one server and one database, so specs run one at a time.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI
    ? [["html", { outputFolder: "playwright-report", open: "never" }], ["line"]]
    : [["html", { outputFolder: "playwright-report", open: "never" }], ["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The database reset has to happen before the dev server boots: the dev bridge opens the
    // local D1 state on startup and keeps the file handles, so deleting the directory later
    // would leave the server reading an unlinked copy.
    command: `node e2e/reset-database.mjs && pnpm exec next dev -p ${port} -H 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      APT_WRANGLER_CONFIG: "e2e/wrangler.e2e.jsonc",
      GROUP_INVITE_CODES: "nyc-5br-2026=e2e-invite-code-0123456789abcdef",
      GEMINI_API_KEY: "",
      REALTYAPI_KEY: "",
      STADIA_MAPS_API_KEY: "",
    },
  },
});
