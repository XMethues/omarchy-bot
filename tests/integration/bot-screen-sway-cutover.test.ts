import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ComputerSurfaceOwner } from "../../apps/daemon/src/modules/computer/broker.ts";
import {
  DESTROY_LEFTOVER_CAGE_ENV,
  destroyLeftoverCageTrees,
  leftoverCageTrees,
} from "../../apps/daemon/src/modules/computer/leftoverCage.ts";
import { BOT_DESKTOP_ROLLOUT } from "../../apps/daemon/src/modules/computer/botDesktopRollout.ts";
import { processAlive } from "../../apps/daemon/src/modules/computer/botScreenWaylandHelpers.ts";
import { currentGeneration, waitScreenReady } from "./helpers/bot-screen-load-observe.ts";
import { api, makeBot, sendToBot, startDaemon, type Harness } from "./helpers/harness.ts";
import { writeFakeSwayIpcMode, writeFakeSwayTree } from "./helpers/fakeSwayIpc.ts";

function ownerOf(bot: { id: string; surfaceId: string }): ComputerSurfaceOwner {
  return { botId: bot.id, surfaceId: bot.surfaceId as ComputerSurfaceOwner["surfaceId"] };
}

const ENV_KEYS = [
  "OMARCHY_BOT_SWAY_BIN",
  "OMARCHY_BOT_SWAYMSG_BIN",
  "OMARCHY_BOT_WAYVNC_BIN",
  "OMARCHY_BOT_WLR_RANDR_BIN",
  "OMARCHY_BOT_GRIM_BIN",
  "OMARCHY_BOT_INPUT_HELPER_BIN",
  "OMARCHY_BOT_CAPTURE_HELPER_BIN",
  "OMARCHY_BOT_DESKTOP_BIN",
  DESTROY_LEFTOVER_CAGE_ENV,
] as const;

const priorEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
let leftoverPid: number | undefined;
let socketListeners: Array<{ stop: () => void }> = [];
let roots: string[] = [];
let harness: Harness | undefined;

afterEach(async () => {
  if (harness !== undefined) {
    await harness.stop().catch(() => {});
    harness = undefined;
  }
  for (const listener of socketListeners) listener.stop();
  socketListeners = [];
  if (leftoverPid !== undefined && processAlive(leftoverPid)) {
    try { process.kill(leftoverPid, "SIGKILL"); } catch { /* already gone */ }
    leftoverPid = undefined;
  }
  for (const key of ENV_KEYS) {
    const value = priorEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function executable(directory: string, name: string, body: string): string {
  const target = path.join(directory, name);
  writeFileSync(target, body);
  chmodSync(target, 0o700);
  return target;
}
function computerRuntimeDir(runtimeRoot: string): string {
  const computerRoot = path.join(runtimeRoot, "computer");
  const generation = readdirSync(computerRoot).find((entry) => /^\d+$/.test(entry));
  if (generation === undefined) throw new Error("shared Bot Computer generation is unavailable");
  return path.join(computerRoot, generation);
}


async function installFakeSwayBins(directory: string): Promise<{
  sway: string;
  swaymsg: string;
  wayvnc: string;
  wlrRandr: string;
  grim: string;
  input: string;
  capture: string;
  desktop: string;
}> {
  const controlDir = path.join(directory, "ipc-control");
  mkdirSync(controlDir);
  writeFakeSwayTree(controlDir, {
    id: 1,
    type: "root",
    name: "root",
    nodes: [],
    floating_nodes: [],
  });
  writeFakeSwayIpcMode(controlDir, "ok");
  const helperPath = path.resolve(import.meta.dir, "helpers/fakeSwayIpc.ts");
  const png = path.join(directory, "screen.png");
  const convert = Bun.which("magick") ?? Bun.which("convert");
  if (convert === null) throw new Error("cutover fixture requires ImageMagick convert");
  const painted = Bun.spawn([convert, "-size", "1920x1080", "xc:#102028", png], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  if (await painted.exited !== 0) {
    throw new Error(`could not paint cutover fixture PNG: ${await new Response(painted.stderr).text()}`);
  }
  return {
    sway: executable(directory, "sway", `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import path from "node:path";
import { serveFakeSwayIpc } from ${JSON.stringify(helperPath)};
const runtimeDir = process.env.XDG_RUNTIME_DIR ?? "";
const wayland = path.join(runtimeDir, "wayland-0");
const swaySock = process.env.SWAYSOCK ?? path.join(runtimeDir, "sway-ipc.sock");
writeFileSync(path.join(runtimeDir, "sway-started"), runtimeDir);
Bun.listen({ unix: wayland, socket: { data() {} } });
await serveFakeSwayIpc({
  socketPath: swaySock,
  controlDir: ${JSON.stringify(controlDir)},
});
`),
    swaymsg: executable(directory, "swaymsg", "#!/bin/sh\nexit 0\n"),
    wayvnc: executable(directory, "wayvnc", "#!/bin/sh\nsleep 3600\n"),
    wlrRandr: executable(directory, "wlr-randr", "#!/bin/sh\nexit 0\n"),
    grim: executable(directory, "grim", `#!/bin/sh\ncat ${JSON.stringify(png)}\n`),
    input: executable(directory, "input", [
      "#!/bin/sh",
      "printf 'READY\\n'",
      "while IFS=' ' read -r command request rest; do",
      "  printf 'OK %s\\n' \"$request\"",
      "done",
      "",
    ].join("\n")),
    capture: executable(directory, "capture", "#!/bin/sh\nprintf 'READY\\n'\nwhile read -r command; do [ \"$command\" = close ] && exit 0; done\n"),
    desktop: executable(directory, "bot-desktop", "#!/bin/sh\nprintf 'READY %s %s\\n' \"$1\" \"$2\"\nwhile :; do sleep 60; done\n"),
  };
}

async function useFakeSwayProductionBins(): Promise<string> {
  const root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-sway-cutover-bins-"));
  roots.push(root);
  const bins = await installFakeSwayBins(root);
  process.env.OMARCHY_BOT_SWAY_BIN = bins.sway;
  process.env.OMARCHY_BOT_SWAYMSG_BIN = bins.swaymsg;
  process.env.OMARCHY_BOT_WAYVNC_BIN = bins.wayvnc;
  process.env.OMARCHY_BOT_WLR_RANDR_BIN = bins.wlrRandr;
  process.env.OMARCHY_BOT_GRIM_BIN = bins.grim;
  process.env.OMARCHY_BOT_INPUT_HELPER_BIN = bins.input;
  process.env.OMARCHY_BOT_CAPTURE_HELPER_BIN = bins.capture;
  process.env.OMARCHY_BOT_DESKTOP_BIN = bins.desktop;
  return root;
}

async function plantLiveCageTree(runtimeRoot: string, surfaceId: string, generation = 1): Promise<{
  runtimeDir: string;
  pid: number;
  exited: Promise<number>;
}> {
  const runtimeDir = path.join(runtimeRoot, surfaceId, String(generation));
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const wayland = path.join(runtimeDir, "wayland-0");
  socketListeners.push(Bun.listen({ unix: wayland, socket: { data() {} } }));
  const cageBin = executable(runtimeDir, "cage", "#!/bin/sh\nexec sleep 3600\n");
  const child = Bun.spawn([cageBin], {
    env: { ...process.env, XDG_RUNTIME_DIR: runtimeDir },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    detached: true,
  });
  leftoverPid = child.pid;
  child.unref();
  const deadline = Date.now() + 2_000;
  while (!processAlive(child.pid) && Date.now() < deadline) await Bun.sleep(10);
  return { runtimeDir, pid: child.pid, exited: child.exited };
}

function plantStaleCageSockets(runtimeRoot: string, surfaceId: string, generation = 1): string {
  const runtimeDir = path.join(runtimeRoot, surfaceId, String(generation));
  mkdirSync(runtimeDir, { recursive: true, mode: 0o700 });
  const wayland = path.join(runtimeDir, "wayland-0");
  socketListeners.push(Bun.listen({ unix: wayland, socket: { data() {} } }));
  writeFileSync(path.join(runtimeDir, "cage-leftover"), "stale-cage");
  return runtimeDir;
}

test("live Cage trees block production start unless leftover Cage trees are destroyed", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-sway-cutover-home-"));
  roots.push(home);
  const planted = await plantLiveCageTree(path.join(home, "r"), "surf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  expect(processAlive(planted.pid)).toBeTrue();

  await expect(startDaemon(home, { useProductionBotScreen: true, waitForAgentReady: false })).rejects.toThrow(
    /Save work.*not move live processes.*OMARCHY_BOT_DESTROY_LEFTOVER_CAGE=1/,
  );
  expect(processAlive(planted.pid)).toBeTrue();
  expect(existsSync(path.join(planted.runtimeDir, "wayland-0"))).toBeTrue();

  await useFakeSwayProductionBins();
  process.env[DESTROY_LEFTOVER_CAGE_ENV] = "1";
  harness = await startDaemon(home, { useProductionBotScreen: true });
  await planted.exited;
  expect(processAlive(planted.pid)).toBeFalse();
  expect(existsSync(planted.runtimeDir)).toBeFalse();

  const botId = await makeBot(harness, "Post-cutover Sway");
  const owner = ownerOf(await api<{ id: string; surfaceId: string }>(harness, "GET", `/api/bots/${botId}`));
  await waitScreenReady(harness, owner);
  expect(await currentGeneration(harness, owner)).toBe(1);
  expect(existsSync(path.join(harness.home, "r", owner.surfaceId, "1", "surface.json"))).toBeTrue();
  const computerDir = computerRuntimeDir(path.join(harness.home, "r"));
  expect(existsSync(path.join(computerDir, "sway-ipc.sock"))).toBeTrue();
  expect(existsSync(path.join(computerDir, "sway-started"))).toBeTrue();
}, 20_000);

test("destroying leftover Cage trees leaves a sibling Sway generation on the same surface", async () => {
  const runtimeRoot = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-leftover-cage-"));
  roots.push(runtimeRoot);
  const surfaceId = "surf_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const planted = await plantLiveCageTree(runtimeRoot, surfaceId, 1);
  const swayDir = path.join(runtimeRoot, surfaceId, "2");
  mkdirSync(swayDir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(swayDir, "session.json"), JSON.stringify({ swaySockName: "sway-ipc.sock" }));
  writeFileSync(path.join(swayDir, "keep-sway"), "sibling");

  const trees = leftoverCageTrees(runtimeRoot);
  expect(trees).toEqual([expect.objectContaining({ surfaceId, generation: "1", runtimeDir: planted.runtimeDir })]);

  await destroyLeftoverCageTrees(trees);
  await planted.exited;

  expect(processAlive(planted.pid)).toBeFalse();
  expect(existsSync(planted.runtimeDir)).toBeFalse();
  expect(existsSync(path.join(swayDir, "session.json"))).toBeTrue();
  expect(existsSync(path.join(swayDir, "keep-sway"))).toBeTrue();
});

test("recovered ready surfaces do not reopen leftover Cage sockets and start a new Sway generation", async () => {
  harness = await startDaemon();
  const botId = await makeBot(harness, "Cutover ready");
  const created = await sendToBot(harness, botId, "keep this thread");
  const owner = ownerOf(await api<{ id: string; surfaceId: string }>(harness, "GET", `/api/bots/${botId}`));
  const snapshot = await fetch(
    `${harness.baseUrl}/api/computer/snapshot?botId=${owner.botId}&surfaceId=${owner.surfaceId}`,
  );
  expect(snapshot.status).toBe(200);
  const previousGeneration = await currentGeneration(harness, owner);
  expect(previousGeneration).toBe(1);

  const home = harness.home;
  await harness.disconnectForRestart();
  harness = undefined;
  const leftoverDir = plantStaleCageSockets(path.join(home, "r"), owner.surfaceId, previousGeneration);
  expect(existsSync(path.join(leftoverDir, "wayland-0"))).toBeTrue();
  expect(existsSync(path.join(leftoverDir, "session.json"))).toBeFalse();

  await useFakeSwayProductionBins();
  harness = await startDaemon(home, { useProductionBotScreen: true });
  expect(await api<{ id: string }>(harness, "GET", `/api/bots/${botId}`)).toMatchObject({ id: botId });
  expect(await api<{ id: string }[]>(harness, "GET", `/api/bots/${botId}/threads`)).toEqual([
    expect.objectContaining({ id: created.threadId }),
  ]);

  await waitScreenReady(harness, owner);
  const generation = await currentGeneration(harness, owner);
  expect(generation).toBe(previousGeneration + 1);
  const swayDir = path.join(harness.home, "r", owner.surfaceId, String(generation));
  expect(existsSync(path.join(swayDir, "surface.json"))).toBeTrue();
  expect(existsSync(path.join(computerRuntimeDir(path.join(harness.home, "r")), "sway-started"))).toBeTrue();
  expect(existsSync(path.join(leftoverDir, "cage-leftover"))).toBeFalse();
  expect(readFileSync(path.join(swayDir, "surface.json"), "utf8")).toContain("computerGeneration");

  const shot = await harness.svc.screens.act(owner, { name: "screenshot", args: {} });
  expect(shot.desktopSession?.runtimeGeneration).toBe(generation);
  expect(shot.image?.mediaType).toBe("image/png");
}, 20_000);

test("production cutover exercises Computer Surface, Agent-only use, deletion, and rollout status", async () => {
  await useFakeSwayProductionBins();
  harness = await startDaemon(undefined, { useProductionBotScreen: true });
  const status = JSON.parse(readFileSync(harness.svc.cfg.statusPath, "utf8")) as {
    botDesktopRollout: typeof BOT_DESKTOP_ROLLOUT;
  };
  expect(status.botDesktopRollout.humanAcceptance).toBe("pending");

  const botId = await makeBot(harness, "Cutover public");
  const sent = await sendToBot(harness, botId, "agent-only later");
  const owner = ownerOf(await api<{ id: string; surfaceId: string }>(harness, "GET", `/api/bots/${botId}`));

  const preview = await fetch(
    `${harness.baseUrl}/api/computer/snapshot?botId=${owner.botId}&surfaceId=${owner.surfaceId}`,
  );
  expect(preview.status).toBe(200);
  await waitScreenReady(harness, owner);
  const agentShot = await harness.svc.screens.act(owner, { name: "screenshot", args: {} });
  expect(agentShot.desktopSession?.runtimeGeneration).toBe(1);
  expect(existsSync(path.join(harness.home, "r", owner.surfaceId, "1", "surface.json"))).toBeTrue();

  const workspaceMarker = path.join(harness.svc.cfg.sharedWorkspaceDir, "cutover-keep.txt");
  mkdirSync(harness.svc.cfg.sharedWorkspaceDir, { recursive: true });
  writeFileSync(workspaceMarker, "keep");
  const deleted = await api<{ status: string }>(harness, "DELETE", `/api/bots/${botId}`, {});
  expect(deleted.status).toBe("deleted");
  expect(existsSync(path.join(harness.home, "r", owner.surfaceId))).toBeFalse();
  expect(readFileSync(workspaceMarker, "utf8")).toBe("keep");
  expect((await fetch(`${harness.baseUrl}/api/computer/state?botId=${owner.botId}&surfaceId=${owner.surfaceId}`)).status).toBe(404);
  expect(sent.threadId).toBeString();
}, 20_000);

