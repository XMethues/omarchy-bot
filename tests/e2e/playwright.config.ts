import { defineConfig } from "@playwright/test";
import os from "node:os";
import path from "node:path";

/**
 * One daemon (workers: 1) booted in-process by globalSetup from the repo's
 * fake workers; the daemon serves the built web app itself.
 */
export default defineConfig({
  testDir: "./specs",
  outputDir: path.join(os.tmpdir(), "omarchy-bot-playwright-results"),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.OMARCHY_BOT_E2E_BASE_URL ?? "http://127.0.0.1:7399",
    headless: true,
    actionTimeout: 10_000,
  },
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  reporter: [["list"]],
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
