import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CageBotScreenRuntimeAdapter } from "../../apps/daemon/src/modules/computer/cageBotScreenRuntime.ts";
import type { ComputerWorkerScope, SurfaceComputerWorker } from "../../apps/daemon/src/supervision/supervisor.ts";
import { applicationUnitName } from "../../apps/daemon/src/supervision/applicationUnits.ts";
import type { SurfaceId } from "../../packages/domain/src/ids.ts";

const SURFACE_ID = "surf_11111111111111111111111111111111" as SurfaceId;
let root: string | undefined;
const originalWaylandDisplay = process.env.WAYLAND_DISPLAY;

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
  if (originalWaylandDisplay === undefined) delete process.env.WAYLAND_DISPLAY;
  else process.env.WAYLAND_DISPLAY = originalWaylandDisplay;
});

function executable(directory: string, name: string, body: string): string {
  const target = path.join(directory, name);
  writeFileSync(target, body);
  chmodSync(target, 0o700);
  return target;
}

test("application units distinguish concurrent capture streams on one Surface", () => {
  const captureUnits = [
    applicationUnitName(SURFACE_ID, 1, "capture-1"),
    applicationUnitName(SURFACE_ID, 1, "capture-2"),
  ];
  expect(new Set(captureUnits).size).toBe(2);
  expect(captureUnits.every((unit) => unit.includes("-capture-"))).toBeTrue();
});

test("Cage runtime becomes ready only with explicit private geometry, Desktop, capture, input, and worker", async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-cage-runtime-"));
  const bin = path.join(root, "bin");
  const runtimeRoot = path.join(root, "runtime");
  const profileRoot = path.join(root, "profiles");
  mkdirSync(bin);
  const outputInvocation = path.join(root, "wlr-randr-invocation");
  const cageInvocation = path.join(root, "cage-environment");
  const desktopPid = path.join(root, "bot-desktop-pid");
  const png = path.join(root, "screen.png");
  process.env.WAYLAND_DISPLAY = "host-wayland-9";
  writeFileSync(
    png,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWMQMgn7D8IAC5MDN627upEAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const cage = executable(bin, "cage", `#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
import path from "node:path";
writeFileSync(${JSON.stringify(cageInvocation)}, [process.env.XDG_RUNTIME_DIR, process.env.WAYLAND_DISPLAY, process.env.WLR_BACKENDS, process.env.WLR_RENDERER].join("|"));
const separator = process.argv.indexOf("--");
const application = process.argv.slice(separator + 1);
const socket = path.join(process.env.XDG_RUNTIME_DIR, "wayland-0");
const server = Bun.listen({ unix: socket, socket: { data() {} } });
const child = Bun.spawn(application, { env: { ...process.env, WAYLAND_DISPLAY: "wayland-0" }, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
const status = await child.exited;
server.stop(true);
process.exit(status);
`);
  const desktop = executable(bin, "bot-desktop", [
    "#!/bin/sh",
    "if [ \"$1\" = \"--host\" ]; then while :; do sleep 60; done; fi",
    `printf '%s' "$$" > ${JSON.stringify(desktopPid)}`,
    "printf 'READY %s %s\\n' \"$1\" \"$2\"",
    "while :; do sleep 60; done",
    "",
  ].join("\n"));
  const wlrRandr = executable(bin, "wlr-randr", `#!/bin/sh\nprintf '%s|%s|%s|%s' "$XDG_RUNTIME_DIR" "$WAYLAND_DISPLAY" "$XDG_CONFIG_HOME" "$*" > ${JSON.stringify(outputInvocation)}\n`);
  const grim = executable(bin, "grim", `#!/bin/sh\ncat ${JSON.stringify(png)}\n`);
  const input = executable(bin, "input", [
    "#!/bin/sh",
    "printf 'READY\\n'",
    "while IFS=' ' read -r command request rest; do",
    "  printf 'OK %s\\n' \"$request\"",
    "done",
    "",
  ].join("\n"));
  const capture = executable(bin, "capture", "#!/bin/sh\nprintf 'READY\\n'\nwhile read -r command; do [ \"$command\" = close ] && exit 0; done\n");
  const ffmpeg = executable(bin, "ffmpeg", "#!/bin/sh\nprintf ' V..... libx264 H.264 encoder\\n'\n");
  let workerScope: ComputerWorkerScope | undefined;
  let workerStopped = false;
  const workerExit = Promise.withResolvers<Error>();
  const worker: SurfaceComputerWorker = {
    surfaceId: SURFACE_ID,
    runtimeGeneration: 1,
    exited: workerExit.promise,
    act: async (action) => ({ done: true, text: `worker-${action.name}` }),
    stop: async () => {
      workerStopped = true;
    },
  };
  const adapter = new CageBotScreenRuntimeAdapter({
    runtimeRoot,
    profileRoot,
    cageBin: cage,
    wlrRandrBin: wlrRandr,
    grimBin: grim,
    inputHelperBin: input,
    captureHelperBin: capture,
    botDesktopBin: desktop,
    ffmpegBin: ffmpeg,
    computerWorkers: {
      startComputerWorker: async (scope) => {
        workerScope = scope;
        return worker;
      },
    },
  });

  const runtime = await adapter.start({
    surfaceId: SURFACE_ID,
    generation: 1,
    geometryGeneration: 7,
    logicalWidth: 2,
    logicalHeight: 1,
    scale: 1,
    refreshRate: 15,
  });
  expect(runtime.readiness).toEqual({
    compositor: "ready",
    waylandSocket: "private",
    output: {
      geometryGeneration: 7,
      logicalWidth: 2,
      logicalHeight: 1,
      scale: 1,
      refreshRate: 15,
    },
    desktopSurface: "ready",
    capture: "ready",
    input: "ready",
    computerWorker: "ready",
  });
  const runtimeDir = path.join(runtimeRoot, SURFACE_ID, "1");
  const profileDir = path.join(profileRoot, SURFACE_ID);
  expect(statSync(runtimeDir).mode & 0o777).toBe(0o700);
  for (const directory of ["config", "state", "cache"]) {
    expect(statSync(path.join(profileDir, directory)).mode & 0o777).toBe(0o700);
  }
  expect(readFileSync(outputInvocation, "utf8")).toBe([
    runtimeDir,
    "wayland-0",
    path.join(profileDir, "config"),
    "--output HEADLESS-1 --on --custom-mode 2x1@15Hz --pos 0,0 --transform normal --scale 1",
  ].join("|"));
  expect(readFileSync(cageInvocation, "utf8")).toBe(`${runtimeDir}|wayland-0|headless|pixman`);
  expect(workerScope?.env).toMatchObject({
    XDG_RUNTIME_DIR: runtimeDir,
    WAYLAND_DISPLAY: "wayland-0",
    XDG_CONFIG_HOME: path.join(profileDir, "config"),
    XDG_STATE_HOME: path.join(profileDir, "state"),
    XDG_CACHE_HOME: path.join(profileDir, "cache"),
  });
  expect(workerScope?.env).not.toHaveProperty("WLR_BACKENDS");
  const captureResult = await runtime.capture();
  expect(captureResult.mediaType).toBe("image/png");
  expect(captureResult.bytes.slice(0, 8)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const [firstCaptureStream, secondCaptureStream] = await Promise.all([
    runtime.openCaptureStream(),
    runtime.openCaptureStream(),
  ]);
  await Promise.all([firstCaptureStream.close(), secondCaptureStream.close()]);
  await expect(runtime.act({ name: "open_app", args: { app: "fixture.desktop" } })).resolves.toEqual({
    text: "worker-open_app",
  });
  expect(runtime.readiness.desktopSurface).toBe("ready");
  await runtime.setInputAuthority(1);
  const context = {
    surfaceId: SURFACE_ID,
    runtimeGeneration: 1,
    geometryGeneration: 7,
    controllerEpoch: 1,
  };
  await runtime.input({ ...context, sequence: 1, type: "motion", x: 10, y: 20 });
  await runtime.input({
    ...context,
    sequence: 2,
    type: "button",
    x: 10,
    y: 20,
    button: "left",
    state: "pressed",
  });
  await runtime.input({ ...context, sequence: 3, type: "scroll", x: 10, y: 20, deltaX: 0, deltaY: -120 });
  await runtime.input({ ...context, sequence: 4, type: "key", keyCode: 28, state: "pressed" });
  await runtime.input({ ...context, sequence: 5, type: "paste", text: "Cage paste" });
  await runtime.releaseInput(1);
  const outcome = runtime.outcome;
  process.kill(Number(readFileSync(desktopPid, "utf8")), "SIGTERM");
  await expect(outcome).resolves.toMatchObject({
    type: "desktop-exited",
    error: expect.objectContaining({ message: expect.stringContaining("Bot Desktop exited") }),
  });

  await runtime.stop();
  expect(workerStopped).toBeTrue();
  expect(existsSync(path.join(runtimeRoot, SURFACE_ID))).toBeFalse();
  expect(existsSync(profileDir)).toBeTrue();
  await adapter.destroy(SURFACE_ID);
  expect(existsSync(profileDir)).toBeFalse();
});

test("Cage dependency failure happens before a Surface runtime or profile is created", async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-cage-preflight-"));
  const runtimeRoot = path.join(root, "runtime");
  const profileRoot = path.join(root, "profiles");
  const ffmpeg = executable(root, "ffmpeg", "#!/bin/sh\nprintf ' V..... libx264 H.264 encoder\\n'\n");
  const adapter = new CageBotScreenRuntimeAdapter({
    runtimeRoot,
    profileRoot,
    cageBin: path.join(root, "missing-cage"),
    ffmpegBin: ffmpeg,
    computerWorkers: { startComputerWorker: async () => { throw new Error("worker should not start"); } },
  });

  await expect(adapter.start({
    surfaceId: SURFACE_ID,
    generation: 1,
    geometryGeneration: 1,
    logicalWidth: 1920,
    logicalHeight: 1080,
    scale: 1,
    refreshRate: 16,
  })).rejects.toThrow("configured Cage executable is unavailable");
  expect(existsSync(path.join(runtimeRoot, SURFACE_ID))).toBeFalse();
  expect(existsSync(path.join(profileRoot, SURFACE_ID))).toBeFalse();
});

test("Cage rejects an overlong private socket path before launching the compositor", async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-cage-path-"));
  const bin = path.join(root, "bin");
  const runtimeRoot = path.join(root, "x".repeat(80));
  const cageStarted = path.join(root, "cage-started");
  mkdirSync(bin);
  const inert = "#!/bin/sh\nexit 0\n";
  const adapter = new CageBotScreenRuntimeAdapter({
    runtimeRoot,
    profileRoot: path.join(root, "profiles"),
    cageBin: executable(bin, "cage", `#!/bin/sh\ntouch ${JSON.stringify(cageStarted)}\nexit 0\n`),
    wlrRandrBin: executable(bin, "wlr-randr", inert),
    grimBin: executable(bin, "grim", inert),
    inputHelperBin: executable(bin, "input", inert),
    captureHelperBin: executable(bin, "capture", inert),
    botDesktopBin: executable(bin, "desktop", inert),
    ffmpegBin: executable(bin, "ffmpeg", "#!/bin/sh\nprintf ' V..... libx264 H.264 encoder\\n'\n"),
    computerWorkers: { startComputerWorker: async () => { throw new Error("worker should not start"); } },
  });

  await expect(adapter.start({
    surfaceId: SURFACE_ID,
    generation: 1,
    geometryGeneration: 1,
    logicalWidth: 1920,
    logicalHeight: 1080,
    scale: 1,
    refreshRate: 16,
  })).rejects.toThrow("runtime path is too long for a private Wayland socket");
  expect(existsSync(cageStarted)).toBeFalse();
  expect(existsSync(path.join(runtimeRoot, SURFACE_ID))).toBeFalse();
});

test("Cage rejects ffmpeg without libx264 before starting a Surface process", async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-cage-ffmpeg-preflight-"));
  const bin = path.join(root, "bin");
  const runtimeRoot = path.join(root, "runtime");
  const profileRoot = path.join(root, "profiles");
  const cageStarted = path.join(root, "cage-started");
  mkdirSync(bin);
  const inert = "#!/bin/sh\nexit 0\n";
  const cage = executable(bin, "cage", `#!/bin/sh\ntouch ${JSON.stringify(cageStarted)}\nexit 0\n`);
  const ffmpeg = executable(bin, "ffmpeg", "#!/bin/sh\nprintf ' V..... h264_other H.264 encoder\\n'\n");
  const adapter = new CageBotScreenRuntimeAdapter({
    runtimeRoot,
    profileRoot,
    cageBin: cage,
    wlrRandrBin: executable(bin, "wlr-randr", inert),
    grimBin: executable(bin, "grim", inert),
    inputHelperBin: executable(bin, "input", inert),
    captureHelperBin: executable(bin, "capture", inert),
    botDesktopBin: executable(bin, "desktop", inert),
    ffmpegBin: ffmpeg,
    computerWorkers: { startComputerWorker: async () => { throw new Error("worker should not start"); } },
  });

  await expect(adapter.start({
    surfaceId: SURFACE_ID,
    generation: 1,
    geometryGeneration: 1,
    logicalWidth: 1920,
    logicalHeight: 1080,
    scale: 1,
    refreshRate: 18,
  })).rejects.toThrow("requires ffmpeg with libx264");
  expect(existsSync(cageStarted)).toBeFalse();
  expect(existsSync(path.join(runtimeRoot, SURFACE_ID))).toBeFalse();
  expect(existsSync(path.join(profileRoot, SURFACE_ID))).toBeFalse();
});
