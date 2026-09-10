import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SwayBotScreenRuntimeAdapter } from "../../apps/daemon/src/modules/computer/swayBotScreenRuntime.ts";
import { listApplicationToplevels } from "../../apps/daemon/src/modules/computer/swayIpc.ts";
import type { BotScreenRuntime } from "../../apps/daemon/src/modules/computer/botScreenManager.ts";
import type { ComputerAction } from "../../packages/domain/src/computer.ts";
import type { ComputerInputAuthority } from "../../packages/agent-contract/src/computer-protocol.ts";
import type { SurfaceId } from "../../packages/domain/src/ids.ts";
import type { ComputerWorkerScope, SurfaceComputerWorker } from "../../apps/daemon/src/supervision/supervisor.ts";
import {
  readFakeSwayCommands,
  writeFakeSwayIpcMode,
  writeFakeSwayTree,
} from "./helpers/fakeSwayIpc.ts";

const SURFACE_ID = "surf_33333333333333333333333333333333" as SurfaceId;
const SURFACE_B = "surf_44444444444444444444444444444444" as SurfaceId;

const SCREEN_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWMQMgn7D8IAC5MDN627upEAAAAASUVORK5CYII=",
  "base64",
);

const TWO_TOPLEVEL_TREE = {
  id: 1,
  type: "root",
  name: "root",
  nodes: [
    {
      id: 2,
      type: "output",
      name: "HEADLESS-1",
      nodes: [
        {
          id: 3,
          type: "workspace",
          name: `bot-${SURFACE_ID}`,
          nodes: [
            {
              id: 4,
              type: "con",
              name: null,
              layout: "splith",
              nodes: [
                {
                  id: 10,
                  type: "con",
                  name: "Firefox",
                  app_id: "firefox",
                  pid: 1001,
                  focused: false,
                  shell: "xdg_shell",
                  rect: { x: 0, y: 0, width: 800, height: 600 },
                },
              ],
            },
          ],
          floating_nodes: [
            {
              id: 20,
              type: "floating_con",
              name: "Dialog",
              window: 42,
              pid: 2002,
              focused: true,
              shell: "xwayland",
              rect: { x: 100, y: 80, width: 400, height: 300 },
            },
          ],
        },
      ],
    },
  ],
};

const EXPECTED_WINDOWS = [
  {
    id: "10",
    title: "Firefox",
    appId: "firefox",
    pid: 1001,
    focused: false,
    bounds: { x: 0, y: 0, width: 800, height: 600 },
    workspace: `bot-${SURFACE_ID}`,
    clientType: "wayland" as const,
  },
  {
    id: "20",
    title: "Dialog",
    pid: 2002,
    focused: true,
    bounds: { x: 100, y: 80, width: 400, height: 300 },
    workspace: `bot-${SURFACE_ID}`,
    clientType: "x11" as const,
  },
];

test("native window data includes available XWayland application identity", () => {
  expect(listApplicationToplevels({
    id: 1,
    type: "root",
    nodes: [{
      id: 2,
      type: "workspace",
      name: "1",
      nodes: [{
        id: 20,
        type: "con",
        name: "Dialog",
        window: 42,
        window_properties: { class: "FixtureDialog" },
        pid: 2002,
        focused: true,
        shell: "xwayland",
        rect: { x: 100, y: 80, width: 400, height: 300 },
      }],
      floating_nodes: [],
    }],
  })).toMatchObject([{
    id: "20",
    appId: "FixtureDialog",
    clientType: "x11",
  }]);
});

test("native window data excludes the Bot Desktop infrastructure surface", () => {
  expect(listApplicationToplevels({
    id: 1,
    type: "root",
    nodes: [{
      id: 2,
      type: "workspace",
      name: "1",
      nodes: [
        {
          id: 5,
          type: "con",
          name: "Bot Desktop",
          app_id: "dev.omarchy.BotDesktop",
          focused: true,
          shell: "xdg_shell",
          rect: { x: 0, y: 0, width: 1920, height: 1080 },
        },
        {
          id: 10,
          type: "con",
          name: "Brave",
          app_id: "brave-browser",
          focused: false,
          shell: "xdg_shell",
          rect: { x: 0, y: 0, width: 0, height: 0 },
        },
      ],
      floating_nodes: [],
    }],
  })).toMatchObject([{
    id: "10",
    appId: "brave-browser",
  }]);
});

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

function authority(surfaceId: SurfaceId = SURFACE_ID): ComputerInputAuthority {
  return {
    surfaceId,
    botId: "bot_33333333333333333333333333333333",
    turnId: "turn_33333333333333333333333333333333",
  };
}

async function startControlRuntime(options?: {
  tree?: unknown;
  failPastePath?: string;
}): Promise<{
  runtime: BotScreenRuntime;
  adapter: SwayBotScreenRuntimeAdapter;
  controlDir: string;
  inputLog: string;
  failPastePath: string;
  workerActions: ComputerAction[];
  workerScope: ComputerWorkerScope | undefined;
  expandedViewCalls: number;
  application: string;
  applicationMarker: string;
  unlinkIpc: () => void;
}> {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-sway-control-"));
  const bin = path.join(root, "bin");
  const controlDir = path.join(root, "ipc-control");
  const inputLog = path.join(root, "input.log");
  const failPastePath = options?.failPastePath ?? path.join(root, "fail-paste");
  const applicationCwd = path.join(root, "workspace");
  const applicationMarker = path.join(root, "application.env");
  const png = path.join(root, "screen.png");
  mkdirSync(bin);
  mkdirSync(controlDir);
  mkdirSync(applicationCwd);
  writeFileSync(png, SCREEN_PNG);
  writeFakeSwayTree(controlDir, options?.tree ?? TWO_TOPLEVEL_TREE);
  writeFakeSwayIpcMode(controlDir, "ok");
  writeFileSync(inputLog, "");

  const helperPath = path.resolve(import.meta.dir, "helpers/fakeSwayIpc.ts");
  const sway = executable(bin, "sway", `#!/usr/bin/env bun
import path from "node:path";
import { serveFakeSwayIpc } from ${JSON.stringify(helperPath)};
const runtimeDir = process.env.XDG_RUNTIME_DIR ?? "";
const wayland = path.join(runtimeDir, "wayland-0");
const swaySock = process.env.SWAYSOCK ?? path.join(runtimeDir, "sway-ipc.sock");
Bun.listen({ unix: wayland, socket: { data() {} } });
await serveFakeSwayIpc({
  socketPath: swaySock,
  controlDir: ${JSON.stringify(controlDir)},
});
`);
  const input = executable(bin, "input", `#!/usr/bin/env bun
import { appendFileSync, existsSync } from "node:fs";
const logPath = ${JSON.stringify(inputLog)};
const failPastePath = ${JSON.stringify(failPastePath)};
process.stdout.write("READY\\n");
const decoder = new TextDecoder();
let buffer = "";
for await (const chunk of Bun.stdin.stream()) {
  buffer += decoder.decode(chunk);
  let newline = buffer.indexOf("\\n");
  while (newline >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    appendFileSync(logPath, line + "\\n");
    const [command, request] = line.split(" ");
    if (command === "paste" && existsSync(failPastePath)) {
      process.stdout.write("ERR " + request + " paste failed\\n");
    } else {
      process.stdout.write("OK " + request + "\\n");
    }
    newline = buffer.indexOf("\\n");
  }
}
`);
  const application = executable(bin, "fixture-app", `#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
const treePath = ${JSON.stringify(path.join(controlDir, "tree.json"))};
const tree = JSON.parse(readFileSync(treePath, "utf8"));
tree.nodes[0].nodes[0].nodes.push({
  id: 30,
  type: "con",
  name: "Shared App",
  app_id: "fixture-app",
  pid: process.pid,
  focused: true,
  shell: "xdg_shell",
  rect: { x: 0, y: 0, width: 640, height: 480 },
  nodes: [],
  floating_nodes: [],
});
writeFileSync(treePath, JSON.stringify(tree));
writeFileSync(${JSON.stringify(applicationMarker)}, [
  process.env.HOME,
  process.env.XDG_CONFIG_HOME,
  process.cwd(),
].join("|"));
await Promise.withResolvers<void>().promise;
`);
  const browserApplications = path.join(
    root,
    "profiles",
    "computer",
    "data",
    "applications",
  );
  mkdirSync(browserApplications, { recursive: true });
  writeFileSync(
    path.join(browserApplications, "brave-browser.desktop"),
    [
      "[Desktop Entry]",
      "Type=Application",
      `Exec="${application}" %U`,
      "",
    ].join("\n"),
  );

  const workerActions: ComputerAction[] = [];
  let workerScope: ComputerWorkerScope | undefined;
  const adapter = new SwayBotScreenRuntimeAdapter({
    runtimeRoot: path.join(root, "runtime"),
    profileRoot: path.join(root, "profiles"),
    applicationCwd,
    swayBin: sway,
    wlrRandrBin: executable(bin, "wlr-randr", "#!/bin/sh\nexit 0\n"),
    grimBin: executable(bin, "grim", `#!/bin/sh\ncat ${JSON.stringify(png)}\n`),
    inputHelperBin: input,
    captureHelperBin: executable(
      bin,
      "capture",
      "#!/bin/sh\nprintf 'READY\\n'\nwhile read -r command; do [ \"$command\" = close ] && exit 0; done\n",
    ),
    botDesktopBin: executable(bin, "bot-desktop", [
      "#!/bin/sh",
      "printf 'READY %s %s\\n' \"$1\" \"$2\"",
      "while :; do sleep 60; done",
      "",
    ].join("\n")),
    computerWorkers: {
      startComputerWorker: async (scope): Promise<SurfaceComputerWorker> => {
        workerScope = scope;
        return {
          surfaceId: scope.surfaceId,
          runtimeGeneration: scope.runtimeGeneration,
          exited: new Promise<Error>(() => {}),
          act: async (action) => {
            workerActions.push(action);
            return { done: true, text: `worker-${action.name}` };
          },
          stop: async () => {},
        };
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
  let expandedViewCalls = 0;
  const originalExpanded = runtime.acquireExpandedView.bind(runtime);
  runtime.acquireExpandedView = async () => {
    expandedViewCalls += 1;
    return originalExpanded();
  };
  writeFileSync(path.join(controlDir, "commands.log"), "");
  const swaySock = workerScope?.env.SWAYSOCK;
  return {
    adapter,
    runtime,
    controlDir,
    inputLog,
    failPastePath,
    workerActions,
    application,
    applicationMarker,
    workerScope,
    get expandedViewCalls() {
      return expandedViewCalls;
    },
    unlinkIpc: () => rmSync(swaySock!, { force: true }),
  };
}

test("list_windows returns ordinary and floating toplevels without a Screen Projection", async () => {
  const fixture = await startControlRuntime();
  try {
    const result = await fixture.runtime.act({ name: "list_windows", args: {} });
    expect(result.windowList).toEqual(EXPECTED_WINDOWS);
    expect(fixture.expandedViewCalls).toBe(0);
    expect(fixture.workerActions).toEqual([]);
    expect(readFakeSwayCommands(fixture.controlDir)).toEqual([]);
  } finally {
    await fixture.runtime.stop();
  }
});

test("observe returns the native window list and a PNG without a Screen Projection", async () => {
  const fixture = await startControlRuntime();
  try {
    const result = await fixture.runtime.act({ name: "observe", args: {} });
    expect(result.windowList).toEqual(EXPECTED_WINDOWS);
    expect(result.image?.mediaType).toBe("image/png");
    expect(result.image?.bytes.slice(0, 8)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(fixture.expandedViewCalls).toBe(0);
    expect(fixture.workerActions).toEqual([]);
  } finally {
    await fixture.runtime.stop();
  }
});

test("observe throws when the private Sway IPC socket is missing", async () => {
  const fixture = await startControlRuntime();
  try {
    fixture.unlinkIpc();
    await expect(fixture.runtime.act({ name: "observe", args: {} })).rejects.toThrow(/Sway IPC/);
  } finally {
    await fixture.runtime.stop();
  }
});

test("focus_window sends a private focus command and succeeds only after the tree confirms it", async () => {
  const fixture = await startControlRuntime();
  try {
    await fixture.runtime.act({ name: "focus_window", args: { id: "10" } }, authority());
    expect(readFakeSwayCommands(fixture.controlDir)).toEqual([
      `workspace bot-${SURFACE_ID}`,
      "[con_id=10] focus",
    ]);
    const listed = await fixture.runtime.act({ name: "list_windows", args: {} });
    expect(listed.windowList).toEqual([
      { ...EXPECTED_WINDOWS[0], focused: true },
      { ...EXPECTED_WINDOWS[1], focused: false },
    ]);
  } finally {
    await fixture.runtime.stop();
  }
});

test("focus_window throws for stale ids, ambiguous titles, refusals, unconfirmed focus, and hung IPC", async () => {
  const fixture = await startControlRuntime();
  try {
    await expect(fixture.runtime.act({ name: "focus_window", args: { id: "999" } }, authority()))
      .rejects.toThrow(/did not match/);
    expect(readFakeSwayCommands(fixture.controlDir)).toEqual([]);

    const output = TWO_TOPLEVEL_TREE.nodes[0]!;
    const workspace = output.nodes[0]!;
    writeFakeSwayTree(fixture.controlDir, {
      ...TWO_TOPLEVEL_TREE,
      nodes: [
        {
          ...output,
          nodes: [
            {
              ...workspace,
              floating_nodes: [
                {
                  ...workspace.floating_nodes[0]!,
                  name: "Firefox",
                },
              ],
            },
          ],
        },
      ],
    });
    await expect(fixture.runtime.act({ name: "focus_window", args: { title: "Firefox" } }, authority()))
      .rejects.toThrow(/multiple/);
    expect(readFakeSwayCommands(fixture.controlDir)).toEqual([]);

    writeFakeSwayTree(fixture.controlDir, TWO_TOPLEVEL_TREE);
    writeFakeSwayIpcMode(fixture.controlDir, "refuse");
    await expect(fixture.runtime.act({ name: "focus_window", args: { id: "10" } }, authority()))
      .rejects.toThrow(/refused/);
    expect(readFakeSwayCommands(fixture.controlDir)).toEqual([
      `workspace bot-${SURFACE_ID}`,
    ]);

    writeFakeSwayIpcMode(fixture.controlDir, "ack");
    await expect(fixture.runtime.act({ name: "focus_window", args: { id: "10" } }, authority()))
      .rejects.toThrow(/not confirmed/);
    expect(readFakeSwayCommands(fixture.controlDir)).toEqual([
      `workspace bot-${SURFACE_ID}`,
      `workspace bot-${SURFACE_ID}`,
      "[con_id=10] focus",
    ]);

    writeFakeSwayIpcMode(fixture.controlDir, "hang");
    await expect(fixture.runtime.act({ name: "focus_window", args: { id: "10" } }, authority()))
      .rejects.toThrow(/timed out/);
  } finally {
    await fixture.runtime.stop();
  }
});

function inputHelperLines(logPath: string): string[] {
  return readFileSync(logPath, "utf8").split("\n").filter((line) => line !== "");
}

function pasteTexts(logPath: string): string[] {
  return inputHelperLines(logPath).flatMap((line) => {
    const [command, , , , , , , payload] = line.split(" ");
    if (command !== "paste" || payload === undefined) return [];
    return [Buffer.from(payload, "base64").toString("utf8")];
  });
}

test("pointer, key, and type actions reject missing authority before mutating the input helper", async () => {
  const fixture = await startControlRuntime();
  try {
    await expect(fixture.runtime.act({ name: "click", args: { x: 4, y: 5 } })).rejects.toThrow(/authority/);
    await expect(fixture.runtime.act({ name: "scroll", args: { deltaX: 0, deltaY: -120 } })).rejects.toThrow(/authority/);
    await expect(fixture.runtime.act({ name: "key", args: { key: "Return" } })).rejects.toThrow(/authority/);
    await expect(fixture.runtime.act({ name: "type", args: { text: "你好, world" } })).rejects.toThrow(/authority/);
    await expect(fixture.runtime.act({ name: "focus_window", args: { id: "10" } })).rejects.toThrow(/authority/);
    await expect(fixture.runtime.act({
      name: "click",
      args: { x: 4, y: 5 },
    }, authority("surf_44444444444444444444444444444444" as SurfaceId))).rejects.toThrow(/authority/);
    expect(inputHelperLines(fixture.inputLog)).toEqual([]);
    expect(readFakeSwayCommands(fixture.controlDir)).toEqual([]);
  } finally {
    await fixture.runtime.stop();
  }
});

test("authorized click, scroll, key, and type drive the private virtual-input helper", async () => {
  const fixture = await startControlRuntime();
  try {
    await fixture.runtime.act({ name: "click", args: { x: 4, y: 5 } }, authority());
    await fixture.runtime.act({ name: "scroll", args: { x: 4, y: 5, deltaX: 1, deltaY: -120 } }, authority());
    await fixture.runtime.act({ name: "key", args: { key: "Return" } }, authority());
    await fixture.runtime.act({ name: "type", args: { text: "你好, world" } }, authority());
    const lines = inputHelperLines(fixture.inputLog);
    expect(lines.some((line) => line.startsWith("motion ") && line.endsWith(" 4 5"))).toBeTrue();
    expect(lines.some((line) => line.startsWith("button ") && line.includes(" 4 5 272 1"))).toBeTrue();
    expect(lines.some((line) => line.startsWith("button ") && line.includes(" 4 5 272 0"))).toBeTrue();
    expect(lines.some((line) => line.startsWith("scroll ") && line.endsWith(" 4 5 1 -120"))).toBeTrue();
    expect(lines.some((line) => line.startsWith("key ") && line.endsWith(" 28 1"))).toBeTrue();
    expect(lines.some((line) => line.startsWith("key ") && line.endsWith(" 28 0"))).toBeTrue();
    expect(pasteTexts(fixture.inputLog)).toEqual(["你好, world"]);
    expect(lines.filter((line) => line.startsWith("authority ")).length).toBe(4);
    expect(lines.filter((line) => line.startsWith("release ")).length).toBe(4);
    expect(fixture.workerActions).toEqual([]);
  } finally {
    await fixture.runtime.stop();
  }
});

test("human input authority serializes the shared seat across Screen workspaces", async () => {
  const fixture = await startControlRuntime();
  const second = await fixture.adapter.start({
    surfaceId: SURFACE_B,
    generation: 2,
    geometryGeneration: 7,
    logicalWidth: 2,
    logicalHeight: 1,
    scale: 1,
    refreshRate: 15,
  });
  writeFileSync(path.join(fixture.controlDir, "commands.log"), "");
  writeFakeSwayTree(fixture.controlDir, {
    id: 1,
    type: "root",
    name: "root",
    nodes: [{
      id: 2,
      type: "workspace",
      name: `bot-${SURFACE_B}`,
      nodes: [{
        id: 30,
        type: "con",
        name: "Second Screen",
        app_id: "fixture",
        focused: true,
        shell: "xdg_shell",
        rect: { x: 8_292, y: 80, width: 400, height: 300 },
      }],
      floating_nodes: [],
    }],
    floating_nodes: [],
  });
  let firstEpoch: number | undefined;
  let secondEpoch: number | undefined;
  try {
    await expect(second.act({ name: "list_windows", args: {} })).resolves.toMatchObject({
      windowList: [{
        title: "Second Screen",
        bounds: { x: 100, y: 80, width: 400, height: 300 },
      }],
    });
    firstEpoch = await fixture.runtime.setInputAuthority(1);
    const secondAuthority = second.setInputAuthority(1).then((epoch) => {
      secondEpoch = epoch;
      return "acquired";
    });
    expect(await Promise.race([
      secondAuthority,
      Bun.sleep(30).then(() => "waiting"),
    ])).toBe("waiting");
    await fixture.runtime.releaseInput(firstEpoch);
    firstEpoch = undefined;
    expect(await secondAuthority).toBe("acquired");
    expect(readFakeSwayCommands(fixture.controlDir)).toEqual([
      `workspace bot-${SURFACE_ID}`,
      `workspace bot-${SURFACE_B}`,
    ]);
  } finally {
    if (firstEpoch !== undefined) await fixture.runtime.releaseInput(firstEpoch).catch(() => {});
    if (secondEpoch !== undefined) await second.releaseInput(secondEpoch).catch(() => {});
    await Promise.allSettled([fixture.runtime.stop(), second.stop()]);
  }
});

test("Agent key chords press in order and release in reverse order", async () => {
  const fixture = await startControlRuntime();
  try {
    await fixture.runtime.act({ name: "key", args: { key: "Ctrl+L" } }, authority());
    expect(inputHelperLines(fixture.inputLog)
      .filter((line) => line.startsWith("key "))
      .map((line) => line.split(" ").slice(-2).join(" ")))
      .toEqual([
        "29 1",
        "38 1",
        "38 0",
        "29 0",
      ]);
  } finally {
    await fixture.runtime.stop();
  }
});

test("type throws when the private helper cannot paste exact Unicode", async () => {
  const fixture = await startControlRuntime();
  writeFileSync(fixture.failPastePath, "1\n");
  try {
    await expect(fixture.runtime.act({ name: "type", args: { text: "你好, world" } }, authority()))
      .rejects.toThrow();
    expect(pasteTexts(fixture.inputLog)).toEqual(["你好, world"]);
  } finally {
    await fixture.runtime.stop();
  }
});

test("shared runtime launches applications into the requesting Screen workspace", async () => {
  const fixture = await startControlRuntime();
  try {
    const shot = await fixture.runtime.act({ name: "screenshot", args: {} });
    expect(shot.image?.bytes.slice(0, 8)).toEqual(
      new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    const observed = await fixture.runtime.act({ name: "observe", args: {} });
    expect(observed.windowList).toEqual(EXPECTED_WINDOWS);
    const listed = await fixture.runtime.act({ name: "list_windows", args: {} });
    expect(listed.windowList).toEqual(EXPECTED_WINDOWS);

    await expect(
      fixture.runtime.act({ name: "open_app", args: { app: fixture.application } }, authority()),
    ).resolves.toEqual({ text: `launched ${fixture.application}` });
    expect(fixture.workerActions).toEqual([]);
    expect(readFakeSwayCommands(fixture.controlDir)).toEqual([
      `workspace bot-${SURFACE_ID}`,
      "[con_id=30] move container to workspace bot-surf_33333333333333333333333333333333",
      `workspace bot-${SURFACE_ID}`,
      `[app_id="^dev[.]omarchy[.]BotDesktop$" workspace="^bot-${SURFACE_ID}$"] move scratchpad`,
    ]);
    expect(await Bun.file(fixture.applicationMarker).text()).toBe([
      path.join(root!, "profiles", "computer", "home"),
      path.join(root!, "profiles", "computer", "config"),
      path.join(root!, "workspace"),
    ].join("|"));
    expect(fixture.workerScope?.env.WAYLAND_DISPLAY).toBe("wayland-0");
    expect(fixture.workerScope?.env.SWAYSOCK).toContain(path.join(root!, "runtime", "computer"));
    expect(fixture.expandedViewCalls).toBe(0);
  } finally {
    await fixture.runtime.stop();
  }
});

test("open_url reuses the shared browser profile and routes its new window", async () => {
  const fixture = await startControlRuntime();
  const url = "https://example.com/shared";
  try {
    await expect(
      fixture.runtime.act({ name: "open_url", args: { url } }, authority()),
    ).resolves.toEqual({ text: `opened ${url}` });
    expect(fixture.workerActions).toEqual([]);
    expect(readFakeSwayCommands(fixture.controlDir)).toEqual([
      `workspace bot-${SURFACE_ID}`,
      "[con_id=30] move container to workspace bot-surf_33333333333333333333333333333333",
      `workspace bot-${SURFACE_ID}`,
      `[app_id="^dev[.]omarchy[.]BotDesktop$" workspace="^bot-${SURFACE_ID}$"] move scratchpad`,
    ]);
    expect(await Bun.file(fixture.applicationMarker).text()).toContain(
      path.join(root!, "profiles", "computer"),
    );
  } finally {
    await fixture.runtime.stop();
  }
});
