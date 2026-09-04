import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CageBotScreenRuntimeAdapter } from "../../apps/daemon/src/modules/computer/cageBotScreenRuntime.ts";
import type { ComputerWorkerScope, SurfaceComputerWorker } from "../../apps/daemon/src/supervision/supervisor.ts";
import type { SurfaceId } from "../../packages/domain/src/ids.ts";

const SURFACE_ID = "surf_11111111111111111111111111111111" as SurfaceId;
let root: string | undefined;

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

function executable(directory: string, name: string, body: string): string {
  const target = path.join(directory, name);
  writeFileSync(target, body);
  chmodSync(target, 0o700);
  return target;
}

test("Cage runtime becomes ready only with explicit private geometry, Desktop, capture, input, and worker", async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-cage-runtime-"));
  const bin = path.join(root, "bin");
  const runtimeRoot = path.join(root, "runtime");
  const profileRoot = path.join(root, "profiles");
  mkdirSync(bin);
  const outputInvocation = path.join(root, "wlr-randr-invocation");
  const png = path.join(root, "screen.png");
  writeFileSync(
    png,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWMQMgn7D8IAC5MDN627upEAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const cage = executable(bin, "cage", `#!/usr/bin/env bun
import path from "node:path";
const separator = process.argv.indexOf("--");
const application = process.argv.slice(separator + 1);
const socket = path.join(process.env.XDG_RUNTIME_DIR, "wayland-0");
const server = Bun.listen({ unix: socket, socket: { data() {} } });
const child = Bun.spawn(application, { env: { ...process.env, WAYLAND_DISPLAY: "wayland-0" }, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
const status = await child.exited;
server.stop(true);
process.exit(status);
`);
  const desktop = executable(bin, "bot-desktop", "#!/bin/sh\nprintf 'READY %s %s\\n' \"$1\" \"$2\"\nwhile :; do sleep 60; done\n");
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
  const adapter = new CageBotScreenRuntimeAdapter({
    runtimeRoot,
    profileRoot,
    cageBin: path.join(root, "missing-cage"),
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
  })).rejects.toThrow("Cage, wlr-randr, and grim are required");
  expect(existsSync(path.join(runtimeRoot, SURFACE_ID))).toBeFalse();
  expect(existsSync(path.join(profileRoot, SURFACE_ID))).toBeFalse();
});
