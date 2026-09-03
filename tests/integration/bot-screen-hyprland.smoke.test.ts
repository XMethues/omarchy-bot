import { expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { api, makeBot, startDaemon, type Harness } from "./helpers/harness.ts";

const platformTest = process.env.OMARCHY_BOT_REAL_HYPRLAND_SMOKE === "1" ? test : test.skip;

async function runBytes(argv: string[]): Promise<Uint8Array> {
  const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
  ]);
  if (status !== 0) throw new Error(`${argv.join(" ")} failed: ${stderr.trim()}`);
  return new Uint8Array(stdout);
}

async function run(argv: string[]): Promise<string> {
  return new TextDecoder().decode(await runBytes(argv));
}

async function hostClientAddresses(): Promise<string[]> {
  const parsed = JSON.parse(await run(["hyprctl", "-j", "clients"])) as Array<{ address: string }>;
  return parsed.map((client) => client.address).sort();
}

function sha256(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

async function waitUntilReady(harness: Harness, botId: string, surfaceId: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const response = await fetch(
      `${harness.baseUrl}/api/computer/state?botId=${encodeURIComponent(botId)}&surfaceId=${encodeURIComponent(surfaceId)}`,
    );
    const view = await response.json() as { state: string };
    if (view.state === "ready") return;
    if (view.state === "unavailable") throw new Error("real Bot Screen reported unavailable");
    if (Date.now() >= deadline) throw new Error(`real Bot Screen stayed ${view.state}`);
    // This opt-in smoke waits on real compositor/socket readiness; fake time cannot drive platform processes.
    await Bun.sleep(20);
  }
}

platformTest("real nested Hyprland is headless, directly captured, and completely torn down", async () => {
  const beforeClients = await hostClientAddresses();
  const harness = await startDaemon(undefined, { useProductionBotScreen: true });
  let runtimeSurfaceDir: string | undefined;
  try {
    const botId = await makeBot(harness, "Real Hyprland smoke");
    const bot = await api<{ surfaceId: string }>(harness, "GET", `/api/bots/${botId}`);
    runtimeSurfaceDir = path.join(harness.svc.cfg.botScreenRuntimeDir, bot.surfaceId);

    const opening = await fetch(
      `${harness.baseUrl}/api/computer/state?botId=${encodeURIComponent(botId)}&surfaceId=${encodeURIComponent(bot.surfaceId)}`,
    ).then((response) => response.json()) as { state: string };
    expect(opening.state).toBe("starting");
    await waitUntilReady(harness, botId, bot.surfaceId);

    expect(await hostClientAddresses()).toEqual(beforeClients);
    expect(statSync(runtimeSurfaceDir).mode & 0o777).toBe(0o700);
    for (const profile of ["config", "state", "cache"]) {
      expect(statSync(path.join(harness.svc.cfg.botScreenProfileDir, bot.surfaceId, profile)).mode & 0o777).toBe(0o700);
    }

    const previewBuffer = await fetch(
      `${harness.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(botId)}&surfaceId=${encodeURIComponent(bot.surfaceId)}`,
    ).then((response) => response.arrayBuffer());
    const preview = new Uint8Array(previewBuffer as ArrayBuffer);
    const hostCapture = await runBytes(["grim", "-"]);
    expect(preview.slice(0, 8)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(sha256(preview)).not.toBe(sha256(hostCapture));
  } finally {
    await harness.stop();
  }

  expect(runtimeSurfaceDir).toBeDefined();
  expect(existsSync(runtimeSurfaceDir!)).toBeFalse();
  const processes = await run(["ps", "-eo", "args"]);
  expect(processes.includes(harness.svc.cfg.botScreenRuntimeDir)).toBeFalse();
}, 60_000);
