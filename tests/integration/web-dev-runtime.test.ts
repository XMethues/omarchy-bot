import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Subprocess } from "bun";
import { chromium } from "@playwright/test";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const webRoot = path.join(repoRoot, "apps/web");

let devServer: Subprocess<"ignore", "pipe", "inherit"> | undefined;
let devUrl = "";

beforeAll(async () => {
  const portProbe = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
  const port = portProbe.port;
  portProbe.stop(true);
  devUrl = `http://127.0.0.1:${port}`;

  devServer = Bun.spawn(
    ["bun", "run", "dev", "--", "--host", "127.0.0.1", "--port", String(port), "--strictPort", "--force"],
    {
      cwd: webRoot,
      stdout: "pipe",
      stderr: "inherit",
    },
  );

  const reader = devServer.stdout.getReader();
  const decoder = new TextDecoder();
  let output = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`Vite exited before becoming ready:\n${output}`);
    output += decoder.decode(chunk.value, { stream: true });
    if (output.includes(devUrl)) return;
  }
});

afterAll(async () => {
  if (devServer === undefined || devServer.exitCode !== null) return;
  devServer.kill("SIGTERM");
  await devServer.exited;
});

test("the Vite development runtime loads both pinned DiceBear renderers", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();

    await page.goto(devUrl);
    // Dynamic import is the contract under test: Vite must resolve both pinned browser modules.
    const moduleError = await page.evaluate(async (modulePath) => {
      try {
        await import(modulePath);
        return null;
      } catch (error) {
        return String(error);
      }
    }, "/src/components/avatarRenderer.ts");
    expect(moduleError).toBeNull();
    await page.locator("#root > *").first().waitFor({ state: "attached", timeout: 5_000 });
  } finally {
    await browser.close();
  }
}, 30_000);
