import { expect, test } from "bun:test";
import { existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BotDeletionService } from "../../apps/daemon/src/modules/bots/botDeletion.ts";
import { BotScreenManager, type BotScreenInputAction } from "../../apps/daemon/src/modules/computer/botScreenManager.ts";
import { HyprlandBotScreenRuntimeAdapter } from "../../apps/daemon/src/modules/computer/hyprlandBotScreenRuntime.ts";
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
  const harness = await startDaemon(undefined, { useProductionBotScreen: true, botScreenCapacity: 2 });
  const runtimeSurfaceDirs: string[] = [];
  const profileSurfaceDirs: string[] = [];
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
    profileSurfaceDirs.push(...owners.map((owner) =>
      path.join(harness.svc.cfg.botScreenProfileDir, owner.surfaceId)
    ));

    const openings = await Promise.all(owners.map((owner) =>
      fetch(
        `${harness.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`,
      )
    ));
    expect(openings.map((opening) => opening.status)).toEqual([200, 200]);
    await Promise.all(owners.map((owner) => waitUntilReady(harness, owner.botId, owner.surfaceId)));

    expect(await hostClientAddresses()).toEqual(beforeClients);
    for (const owner of owners) {
      expect(statSync(path.join(harness.svc.cfg.botScreenRuntimeDir, owner.surfaceId)).mode & 0o777).toBe(0o700);
      for (const profile of ["config", "state", "cache"]) {
        expect(statSync(path.join(harness.svc.cfg.botScreenProfileDir, owner.surfaceId, profile)).mode & 0o777).toBe(0o700);
      }
    }

    const userManagerSocket = process.env.XDG_RUNTIME_DIR === undefined
      ? undefined
      : path.join(process.env.XDG_RUNTIME_DIR, "systemd", "private");
    if (Bun.which("systemctl") !== null && userManagerSocket !== undefined && existsSync(userManagerSocket)) {
      const units = await run(["systemctl", "--user", "list-units", "--all", "--plain", "--no-legend", "omarchy-bot-screen-*"]);
      for (const owner of owners) {
        const prefix = `omarchy-bot-screen-${owner.surfaceId.slice("surf_".length)}-g1`;
        for (const role of ["compositor", "application", "input", "worker"]) {
          expect(units).toContain(`${prefix}-${role}.service`);
        }
      }
    }

    await Promise.all([
      harness.svc.screens.act(
        owners[0]!,
        { name: "type", args: { text: "FIRST-SCREEN-PIXELS" } },
        { ...owners[0]!, turnId: "smoke-first-screen" },
      ),
      harness.svc.screens.act(
        owners[1]!,
        { name: "type", args: { text: "SECOND-SCREEN-PIXELS" } },
        { ...owners[1]!, turnId: "smoke-second-screen" },
      ),
    ]);
    const activeViews = await Promise.all(owners.map((owner) =>
      fetch(
        `${harness.baseUrl}/api/computer/state?botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`,
      ).then((response) => response.json()) as Promise<{ state: string }>
    ));
    expect(activeViews.map((view) => view.state)).toEqual(["ready", "ready"]);

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
    let firstEpoch = 1;
    let firstSequence = 0;
    let secondSequence = 0;
    const firstInput = (action: BotScreenInputAction): Promise<void> =>
      firstSource.input({
        surfaceId: firstSource.surfaceId,
        runtimeGeneration: firstSource.runtimeGeneration,
        geometryGeneration: firstSource.geometryGeneration,
        controllerEpoch: firstEpoch,
        sequence: ++firstSequence,
        ...action,
      });
    const secondInput = (action: BotScreenInputAction): Promise<void> =>
      secondSource.input({
        surfaceId: secondSource.surfaceId,
        runtimeGeneration: secondSource.runtimeGeneration,
        geometryGeneration: secondSource.geometryGeneration,
        controllerEpoch: 1,
        sequence: ++secondSequence,
        ...action,
      });
    await Promise.all([firstSource.setInputAuthority(firstEpoch), secondSource.setInputAuthority(1)]);

    await firstInput({ type: "motion", x: 100, y: 120 });
    await firstInput({ type: "button", x: 100, y: 120, button: "left", state: "pressed" });
    await firstInput({ type: "button", x: 100, y: 120, button: "left", state: "released" });
    await firstInput({ type: "button", x: 80, y: 100, button: "left", state: "pressed" });
    await firstInput({ type: "motion", x: 600, y: 180 });
    await firstInput({ type: "button", x: 600, y: 180, button: "left", state: "released" });
    await firstInput({ type: "scroll", x: 600, y: 180, deltaX: 0, deltaY: -720 });
    await firstInput({ type: "key", keyCode: 29, state: "pressed" });
    await firstInput({ type: "key", keyCode: 38, state: "pressed" });
    await firstInput({ type: "key", keyCode: 38, state: "released" });
    await firstInput({ type: "key", keyCode: 29, state: "released" });
    await firstInput({ type: "paste", text: "WEB-CONTROL-PASTE λ" });
    await firstInput({ type: "key", keyCode: 28, state: "pressed" });
    await firstInput({ type: "key", keyCode: 28, state: "released" });
    const firstAfterKeyboard = (await firstSource.capture()).bytes;
    expect(await differingPixels(previews[0]!, firstAfterKeyboard, harness.home)).toBeGreaterThan(0);
    const secondAfterFirstInput = (await secondSource.capture()).bytes;
    expect(await differingPixels(secondBeforePointer, secondAfterFirstInput, harness.home)).toBeLessThan(10_000);
    await secondInput({ type: "motion", x: 700, y: 400 });
    await firstInput({ type: "key", keyCode: 42, state: "pressed" });
    await firstInput({ type: "button", x: 600, y: 180, button: "left", state: "pressed" });
    await firstSource.releaseInput(firstEpoch);
    firstEpoch = 2;
    firstSequence = 0;
    await firstSource.setInputAuthority(firstEpoch);
    await firstInput({ type: "key", keyCode: 42, state: "pressed" });
    await firstInput({ type: "key", keyCode: 42, state: "released" });
    await firstInput({ type: "button", x: 600, y: 180, button: "left", state: "pressed" });
    await firstInput({ type: "button", x: 600, y: 180, button: "left", state: "released" });
    await Promise.all([firstSource.releaseInput(firstEpoch), secondSource.releaseInput(1)]);

    expect(await run(["hyprctl", "-j", "cursorpos"])).toBe(hostPointerBefore);

    for (const [index, owner] of owners.entries()) {
      const deleted = await api<{ status: string }>(harness, "DELETE", `/api/bots/${owner.botId}`, {});
      expect(deleted.status).toBe("deleted");
      expect(existsSync(runtimeSurfaceDirs[index]!)).toBeFalse();
      expect(existsSync(profileSurfaceDirs[index]!)).toBeFalse();
    }
    await expect(firstSource.capture()).rejects.toThrow("unknown Computer Surface");
  } finally {
    await harness.stop();
  }

  expect(runtimeSurfaceDirs).toHaveLength(2);
  expect(runtimeSurfaceDirs.every((runtimeDir) => !existsSync(runtimeDir))).toBeTrue();
  expect(profileSurfaceDirs).toHaveLength(2);
  expect(profileSurfaceDirs.every((profileDir) => !existsSync(profileDir))).toBeTrue();
  const processes = await run(["ps", "-eo", "args"]);
  expect(processes.includes(harness.svc.cfg.botScreenRuntimeDir)).toBeFalse();
  for (const runtimeDir of runtimeSurfaceDirs) {
    expect(processes).not.toContain(path.basename(runtimeDir));
  }
  if (
    Bun.which("systemctl") !== null
    && process.env.XDG_RUNTIME_DIR !== undefined
    && existsSync(path.join(process.env.XDG_RUNTIME_DIR, "systemd", "private"))
  ) {
    const units = await run(["systemctl", "--user", "list-units", "--all", "--plain", "--no-legend", "omarchy-bot-screen-*"]);
    expect(units.trim()).toBe("");
  }
}, 90_000);

platformTest("deletion cleans an unresponsive real input helper without waiting for its hung RPC", async () => {
  const harness = await startDaemon();
  const helperPath = path.join(harness.home, "unresponsive-input-helper");
  writeFileSync(helperPath, [
    "#!/bin/sh",
    "printf 'READY\\n'",
    "while IFS= read -r line; do",
    '  case "$line" in',
    "    release\\ *) sleep 60 ;;",
    "    *) set -- $line; printf 'OK %s\\n' \"$2\" ;;",
    "  esac",
    "done",
    "",
  ].join("\n"), { mode: 0o700 });
  const adapter = new HyprlandBotScreenRuntimeAdapter({
    runtimeRoot: harness.svc.cfg.botScreenRuntimeDir,
    profileRoot: harness.svc.cfg.botScreenProfileDir,
    ...(process.env.XDG_RUNTIME_DIR === undefined ? {} : { hostRuntimeDir: process.env.XDG_RUNTIME_DIR }),
    ...(process.env.WAYLAND_DISPLAY === undefined ? {} : { hostWaylandDisplay: process.env.WAYLAND_DISPLAY }),
    inputHelperBin: helperPath,
    computerWorkers: harness.svc.supervisor,
  });
  const manager = new BotScreenManager(harness.svc.db, adapter, {
    capacity: 1,
    logicalWidth: harness.svc.cfg.botScreenLogicalWidth,
    logicalHeight: harness.svc.cfg.botScreenLogicalHeight,
  });
  let surfaceId: SurfaceId | undefined;
  try {
    const botId = await makeBot(harness, "Unresponsive real input helper");
    const bot = await api<{ surfaceId: SurfaceId }>(harness, "GET", `/api/bots/${botId}`);
    surfaceId = bot.surfaceId;
    const owner = { botId, surfaceId };
    manager.open(owner);
    const readyDeadline = Date.now() + 20_000;
    for (;;) {
      const lifecycle = manager.status(owner);
      if (lifecycle.state === "ready") break;
      if (lifecycle.state === "failed") throw new Error(lifecycle.failure);
      if (Date.now() >= readyDeadline) throw new Error("real Bot Screen with fixture helper did not become ready");
      await Bun.sleep(20);
    }

    const source = await manager.projectionSource(owner);
    expect(source).toBeDefined();
    await source!.setInputAuthority(1);
    const deletion = new BotDeletionService(
      harness.svc.db,
      harness.svc.events,
      harness.svc.attachments,
      harness.svc.avatars,
      harness.svc.turns,
      harness.svc.threads,
      manager,
      harness.svc.cfg.botDeletionTerminalTimeoutMs,
    );
    const startedAt = Date.now();
    const result = await deletion.delete(botId);
    expect(result.status).toBe("deleted");
    expect(Date.now() - startedAt).toBeLessThan(15_000);
    expect(existsSync(path.join(harness.svc.cfg.botScreenRuntimeDir, surfaceId))).toBeFalse();
    expect(existsSync(path.join(harness.svc.cfg.botScreenProfileDir, surfaceId))).toBeFalse();
    await expect(source!.capture()).rejects.toThrow("unknown Computer Surface");

    const userManagerSocket = process.env.XDG_RUNTIME_DIR === undefined
      ? undefined
      : path.join(process.env.XDG_RUNTIME_DIR, "systemd", "private");
    if (Bun.which("systemctl") !== null && userManagerSocket !== undefined && existsSync(userManagerSocket)) {
      const units = await run(["systemctl", "--user", "list-units", "--all", "--full", "--plain", "--no-legend", "omarchy-bot-screen-*"]);
      expect(units).not.toContain(surfaceId.slice("surf_".length));
    }
    expect(await run(["ps", "-eo", "args"])).not.toContain(helperPath);
  } finally {
    await manager.shutdown().catch(() => {});
    if (surfaceId !== undefined) await adapter.destroy(surfaceId).catch(() => {});
    await harness.stop();
  }
}, 45_000);
