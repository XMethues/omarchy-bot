import { expect, test } from "bun:test";
import { existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SurfaceId } from "../../packages/domain/src/ids.ts";
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

async function differingPixels(first: Uint8Array, second: Uint8Array, directory: string): Promise<number> {
  const firstPath = path.join(directory, "pointer-isolation-before.png");
  const secondPath = path.join(directory, "pointer-isolation-after.png");
  writeFileSync(firstPath, first);
  writeFileSync(secondPath, second);
  const comparison = Bun.spawn(["compare", "-metric", "AE", firstPath, secondPath, "null:"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, metric] = await Promise.all([
    comparison.exited,
    new Response(comparison.stderr).text(),
  ]);
  if (status !== 0 && status !== 1) throw new Error(`ImageMagick comparison failed with status ${status}`);
  return Number(metric.trim().split(/\s+/, 1)[0]);
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

platformTest("two real nested Hyprland Screens act and capture concurrently with distinct pixels", async () => {
  const beforeClients = await hostClientAddresses();
  const harness = await startDaemon(undefined, { useProductionBotScreen: true });
  const runtimeSurfaceDirs: string[] = [];
  try {
    const botIds = await Promise.all([
      makeBot(harness, "First real Hyprland screen"),
      makeBot(harness, "Second real Hyprland screen"),
    ]);
    const bots = await Promise.all(botIds.map((botId) =>
      api<{ surfaceId: string }>(harness, "GET", `/api/bots/${botId}`)
    ));
    const owners = botIds.map((botId, index) => ({
      botId,
      surfaceId: bots[index]!.surfaceId as SurfaceId,
    }));
    runtimeSurfaceDirs.push(...owners.map((owner) =>
      path.join(harness.svc.cfg.botScreenRuntimeDir, owner.surfaceId)
    ));

    const openings = await Promise.all(owners.map((owner) =>
      fetch(
        `${harness.baseUrl}/api/computer/state?botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`,
      ).then((response) => response.json()) as Promise<{ state: string }>
    ));
    expect(openings.map((opening) => opening.state)).toEqual(["starting", "starting"]);
    await Promise.all(owners.map((owner) => waitUntilReady(harness, owner.botId, owner.surfaceId)));

    expect(await hostClientAddresses()).toEqual(beforeClients);
    for (const owner of owners) {
      expect(statSync(path.join(harness.svc.cfg.botScreenRuntimeDir, owner.surfaceId)).mode & 0o777).toBe(0o700);
      for (const profile of ["config", "state", "cache"]) {
        expect(statSync(path.join(harness.svc.cfg.botScreenProfileDir, owner.surfaceId, profile)).mode & 0o777).toBe(0o700);
      }
    }

    const leases = await Promise.all(owners.map((owner) =>
      harness.svc.computer.acquire(owner, undefined)
    ));
    expect(leases.every((lease) => lease.granted && lease.token !== undefined)).toBeTrue();
    await Promise.all([
      harness.svc.computer.act(owners[0]!, undefined, { name: "type", args: { text: "FIRST-SCREEN-PIXELS" } }),
      harness.svc.computer.act(owners[1]!, undefined, { name: "type", args: { text: "SECOND-SCREEN-PIXELS" } }),
    ]);
    const activeViews = await Promise.all(owners.map((owner) =>
      fetch(
        `${harness.baseUrl}/api/computer/state?botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`,
      ).then((response) => response.json()) as Promise<{ state: string }>
    ));
    expect(activeViews.map((view) => view.state)).toEqual(["bot-using", "bot-using"]);

    const previews = await Promise.all(owners.map(async (owner) => {
      const response = await fetch(
        `${harness.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`,
      );
      expect(response.status).toBe(200);
      return new Uint8Array(await response.arrayBuffer());
    }));
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(previews[0]!.slice(0, 8)).toEqual(pngSignature);
    expect(previews[1]!.slice(0, 8)).toEqual(pngSignature);
    expect(sha256(previews[0]!)).not.toBe(sha256(previews[1]!));
    const hostCapture = await runBytes(["grim", "-"]);
    expect(previews.every((preview) => sha256(preview) !== sha256(hostCapture))).toBeTrue();

    const hostPointerBefore = await run(["hyprctl", "-j", "cursorpos"]);
    const sources = await Promise.all(owners.map((owner) => harness.svc.screens.projectionSource(owner)));
    expect(sources.every((source) => source !== undefined)).toBeTrue();
    const firstSource = sources[0]!;
    const secondSource = sources[1]!;
    const secondBeforePointer = (await secondSource.capture()).bytes;

    await firstSource.pointer({ type: "motion", x: 100, y: 120 });
    await firstSource.pointer({ type: "button", x: 100, y: 120, button: "left", state: "pressed" });
    await firstSource.pointer({ type: "button", x: 100, y: 120, button: "left", state: "released" });
    await firstSource.pointer({ type: "button", x: 80, y: 100, button: "left", state: "pressed" });
    await firstSource.pointer({ type: "motion", x: 600, y: 180 });
    await firstSource.pointer({ type: "button", x: 600, y: 180, button: "left", state: "released" });
    await firstSource.pointer({ type: "scroll", x: 600, y: 180, deltaX: 0, deltaY: -720 });
    const secondAfterFirstInput = (await secondSource.capture()).bytes;
    expect(await differingPixels(secondBeforePointer, secondAfterFirstInput, harness.home)).toBeLessThan(10_000);
    await secondSource.pointer({ type: "motion", x: 700, y: 400 });
    await Promise.all([firstSource.releasePointer(), secondSource.releasePointer()]);

    expect(await run(["hyprctl", "-j", "cursorpos"])).toBe(hostPointerBefore);

    for (const [index, owner] of owners.entries()) {
      harness.svc.computer.release(owner, leases[index]!.token!);
    }
  } finally {
    await harness.stop();
  }

  expect(runtimeSurfaceDirs).toHaveLength(2);
  expect(runtimeSurfaceDirs.every((runtimeDir) => !existsSync(runtimeDir))).toBeTrue();
  const processes = await run(["ps", "-eo", "args"]);
  expect(processes.includes(harness.svc.cfg.botScreenRuntimeDir)).toBeFalse();
}, 90_000);
