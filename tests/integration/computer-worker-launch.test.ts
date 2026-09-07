import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, watch, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkerClient } from "../../apps/daemon/src/supervision/workerClient.ts";

const SURFACE_ID = "surf_11111111111111111111111111111111";
const WORKER_SCRIPT = path.resolve(import.meta.dir, "../../workers/computer/src/worker.ts");
let root: string | undefined;

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

test("open_app launches directly in the owning Screen environment and application exit leaves its worker alive", async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-app-launch-"));
  const dataHome = path.join(root, "data");
  const configHome = path.join(root, "config");
  const stateHome = path.join(root, "state");
  const cacheHome = path.join(root, "cache");
  const binDir = path.join(root, "bin");
  const marker = path.join(root, "application-environment");
  const activationMarker = path.join(root, "global-activation-used");
  for (const directory of [path.join(dataHome, "applications"), configHome, stateHome, cacheHome, binDir]) {
    mkdirSync(directory, { recursive: true });
  }
  const application = path.join(binDir, "fixture-application");
  writeFileSync(application, [
    "#!/bin/sh",
    `printf '%s|%s|%s|%s|%s' "$WAYLAND_DISPLAY" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" "$(pwd)" > ${JSON.stringify(`${marker}.tmp`)}`,
    `mv ${JSON.stringify(`${marker}.tmp`)} ${JSON.stringify(marker)}`,
    "exit 0",
    "",
  ].join("\n"));
  chmodSync(application, 0o700);
  const gtkLaunch = path.join(binDir, "gtk-launch");
  writeFileSync(gtkLaunch, `#!/bin/sh\ntouch ${JSON.stringify(activationMarker)}\n`);
  chmodSync(gtkLaunch, 0o700);
  writeFileSync(path.join(dataHome, "applications", "fixture.desktop"), [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Fixture",
    `Exec=${application} %U`,
    "",
  ].join("\n"));

  const applicationCwd = path.join(root, ".omarchy-bot", "workspace");
  mkdirSync(applicationCwd, { recursive: true });
  const worker = new WorkerClient({
    name: "computer-application-launch-test",
    script: WORKER_SCRIPT,
    env: {
      HOME: root,
      PATH: `${binDir}:/usr/bin:/bin`,
      XDG_DATA_HOME: dataHome,
      XDG_CONFIG_HOME: configHome,
      XDG_STATE_HOME: stateHome,
      XDG_CACHE_HOME: cacheHome,
      XDG_RUNTIME_DIR: root,
      WAYLAND_DISPLAY: "wayland-private",
      OMARCHY_BOT_SURFACE_ID: SURFACE_ID,
      OMARCHY_BOT_RUNTIME_GENERATION: "1",
      OMARCHY_BOT_APPLICATION_CWD: applicationCwd,
    },
    onEvent: () => {},
  });
  const markerWritten = Promise.withResolvers<void>();
  const watcher = watch(root, (_event, filename) => {
    if (filename === path.basename(marker)) markerWritten.resolve();
  });
  try {
    await worker.start();
    await expect(worker.request({
      type: "act",
      surfaceId: SURFACE_ID,
      runtimeGeneration: 1,
      action: { name: "open_app", args: { app: "fixture.desktop" } },
      inputAuthority: { botId: "bot_launch_test", surfaceId: SURFACE_ID, turnId: "turn-launch-test" },
    }, 2_000)).resolves.toMatchObject({ done: true, text: "launched fixture.desktop" });
    await markerWritten.promise;
    expect(await Bun.file(marker).text()).toBe(`wayland-private|${configHome}|${stateHome}|${cacheHome}|${applicationCwd}`);
    expect(applicationCwd).not.toBe(path.dirname(WORKER_SCRIPT));
    expect(existsSync(activationMarker)).toBeFalse();
    expect(worker.alive).toBeTrue();
    await expect(worker.request({
      type: "act",
      surfaceId: SURFACE_ID,
      runtimeGeneration: 1,
      action: { name: "open_app", args: { app: "missing.desktop" } },
      inputAuthority: { botId: "bot_launch_test", surfaceId: SURFACE_ID, turnId: "turn-launch-test" },
    }, 2_000)).rejects.toThrow("application desktop entry not found");
    expect(worker.alive).toBeTrue();
  } finally {
    await worker.stop();
    watcher.close();
  }
});

test("open_url returns after dispatch while its opener keeps running in the owning Screen", async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-url-launch-"));
  const binDir = path.join(root, "bin");
  const marker = path.join(root, "url-environment");
  const applicationCwd = path.join(root, ".omarchy-bot", "workspace");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(applicationCwd, { recursive: true });
  const opener = path.join(binDir, "xdg-open");
  writeFileSync(opener, [
    "#!/bin/sh",
    `printf '%s|%s|%s|%s' "$1" "$WAYLAND_DISPLAY" "$(pwd)" "$XDG_RUNTIME_DIR" > ${JSON.stringify(`${marker}.tmp`)}`,
    `mv ${JSON.stringify(`${marker}.tmp`)} ${JSON.stringify(marker)}`,
    "sleep 30",
    "",
  ].join("\n"));
  chmodSync(opener, 0o700);

  const worker = new WorkerClient({
    name: "computer-url-launch-test",
    script: WORKER_SCRIPT,
    env: {
      HOME: root,
      PATH: `${binDir}:/usr/bin:/bin`,
      XDG_RUNTIME_DIR: root,
      WAYLAND_DISPLAY: "wayland-private",
      OMARCHY_BOT_SURFACE_ID: SURFACE_ID,
      OMARCHY_BOT_RUNTIME_GENERATION: "1",
      OMARCHY_BOT_APPLICATION_CWD: applicationCwd,
    },
    onEvent: () => {},
  });
  const markerWritten = Promise.withResolvers<void>();
  const watcher = watch(root, (_event, filename) => {
    if (filename === path.basename(marker)) markerWritten.resolve();
  });
  try {
    await worker.start();
    await expect(worker.request({
      type: "act",
      surfaceId: SURFACE_ID,
      runtimeGeneration: 1,
      action: { name: "open_url", args: { url: "https://example.com/path" } },
      inputAuthority: { botId: "bot_url_test", surfaceId: SURFACE_ID, turnId: "turn-url-test" },
    }, 1_000)).resolves.toMatchObject({ done: true });
    await markerWritten.promise;
    expect(await Bun.file(marker).text()).toBe(
      `https://example.com/path|wayland-private|${applicationCwd}|${root}`,
    );
    expect(worker.alive).toBeTrue();
  } finally {
    await worker.stop();
    watcher.close();
  }
});
