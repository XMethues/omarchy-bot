import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { isInputAction, type ComputerAction, type SurfaceId } from "@omarchy-bot/domain";
import type { ComputerInputAuthority, ComputerWindowListItem } from "@omarchy-bot/agent-contract";
import type { SurfaceComputerWorker, Supervisor } from "../../supervision/supervisor.ts";
import { ensureCaptureHelper } from "../../../native/capture-helper/build.ts";
import { ensureInputHelper } from "../../../native/pointer-helper/build.ts";
import { ensureBotDesktop } from "../../../native/bot-desktop/build.ts";
import { ApplicationUnits, applicationUnitName } from "../../supervision/applicationUnits.ts";
import type {
  BotScreenActionResult,
  BotScreenCapture,
  BotScreenCaptureStream,
  BotScreenExpandedView,
  BotScreenInputAction,
  BotScreenProvision,
  BotScreenRuntime,
  BotScreenRuntimeAdapter,
  BotScreenRuntimeOutcome,
} from "./botScreenManager.ts";
import {
  command,
  executable,
  explicitEnvironment,
  isSocket,
  ownedProcessIdentity,
  ownedProcessRunning,
  privateRuntimeProcesses,
  type OwnedProcessIdentity,
  ProcessLineReader,
  terminateDetachedProcess,
  terminateOwnedProcess,
  WaylandCaptureStream,
  WaylandVirtualInput,
  type DetachedProcess,
} from "./botScreenWaylandHelpers.ts";
import { listApplicationToplevels, SwayIpcClient } from "./swayIpc.ts";
import {
  resolveSwayRuntimeBinaries,
  type SwayRuntimeSupply,
} from "./swayRuntimeSupply.ts";

export interface SwayAdapterOptions {
  runtimeRoot: string;
  profileRoot: string;
  hostRuntimeDir?: string;
  swayBin?: string;
  swaymsgBin?: string;
  wlrRandrBin?: string;
  grimBin?: string;
  inputHelperBin?: string;
  captureHelperBin?: string;
  botDesktopBin?: string;
  wayvncBin?: string;
  runtimeSupply?: SwayRuntimeSupply;
  computerWorkers: Pick<Supervisor, "startComputerWorker">;
}

type SwayProcess = DetachedProcess;

const SESSION_STATE_FILE = "session.json";

interface SwaySessionState {
  generation: number;
  waylandDisplay: string;
  swaySockName: string;
  outputName: string;
  swayPid?: number;
  desktopPid?: number;
  swayIdentity?: OwnedProcessIdentity | undefined;
  desktopIdentity?: OwnedProcessIdentity | undefined;
}

interface SwaySession {
  provision: BotScreenProvision;
  runtimeSurfaceDir: string;
  runtimeDir: string;
  profileDir: string;
  childEnv: Record<string, string>;
  outputName: string;
  videoWidth: number;
  videoHeight: number;
  swayProcess?: SwayProcess;
  desktopProcess?: SwayProcess;
  swayPid?: number;
  desktopPid?: number;
  swayIdentity?: OwnedProcessIdentity | undefined;
  desktopIdentity?: OwnedProcessIdentity | undefined;
  virtualInput?: WaylandVirtualInput;
  computerWorker?: SurfaceComputerWorker;
  grim: string;
  inputHelper: string;
  captureHelper: string;
  sockets: { waylandDisplay: string; swaySock: string };
}

const LINUX_KEY_CODES: Record<string, number> = {
  Esc: 1,
  Escape: 1,
  Tab: 15,
  Return: 28,
  Enter: 28,
  LeftCtrl: 29,
  Control: 29,
  Ctrl: 29,
  LeftShift: 42,
  Shift: 42,
  LeftAlt: 56,
  Alt: 56,
  Space: 57,
  Backspace: 14,
  RightShift: 54,
  RightCtrl: 97,
  RightAlt: 100,
  LeftMeta: 125,
  Super: 125,
  Meta: 125,
  Win: 125,
  Up: 103,
  Down: 108,
  Left: 105,
  Right: 106,
  Home: 102,
  End: 107,
  PageUp: 104,
  PageDown: 109,
  Delete: 111,
  Insert: 110,
  CapsLock: 58,
  F1: 59,
  F2: 60,
  F3: 61,
  F4: 62,
  F5: 63,
  F6: 64,
  F7: 65,
  F8: 66,
  F9: 67,
  F10: 68,
  F11: 87,
  F12: 88,
};

const LINUX_LETTER_KEY_CODES: Readonly<Record<string, number>> = {
  q: 16,
  w: 17,
  e: 18,
  r: 19,
  t: 20,
  y: 21,
  u: 22,
  i: 23,
  o: 24,
  p: 25,
  a: 30,
  s: 31,
  d: 32,
  f: 33,
  g: 34,
  h: 35,
  j: 36,
  k: 37,
  l: 38,
  z: 44,
  x: 45,
  c: 46,
  v: 47,
  b: 48,
  n: 49,
  m: 50,
};

function linuxKeyCode(key: string): number {
  const name = key.trim();
  if (name === "") throw new Error("key requires a known key name");
  const keyCode = LINUX_KEY_CODES[name]
    ?? LINUX_LETTER_KEY_CODES[name.toLowerCase()]
    ?? (/^[0-9]$/.test(name) ? (name === "0" ? 11 : Number(name) + 1) : undefined);
  if (keyCode === undefined) throw new Error(`unknown key: ${name}`);
  return keyCode;
}

function linuxKeyChord(value: unknown): number[] {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("key requires a known key name");
  }
  const keys = value.split("+").map((key) => key.trim());
  if (keys.some((key) => key === "")) throw new Error(`unknown key chord: ${value}`);
  return keys.map(linuxKeyCode);
}

function requireCoordinate(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a number`);
  return value;
}

function optionalCoordinate(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  return requireCoordinate(value, "coordinate");
}

function pointerButton(value: unknown): "left" | "middle" | "right" {
  if (value === undefined || value === "left") return "left";
  if (value === "middle" || value === "right") return value;
  throw new Error("click button must be left, middle, or right");
}

function resolveFocusMatches(
  windows: ComputerWindowListItem[],
  args: Record<string, unknown>,
): ComputerWindowListItem[] {
  if (args.id !== undefined && args.id !== null && args.id !== "") {
    const id = String(args.id);
    return windows.filter((window) => window.id === id);
  }
  if (typeof args.title === "string") {
    return windows.filter((window) => window.title === args.title);
  }
  if (typeof args.appId === "string") {
    return windows.filter((window) => window.appId === args.appId);
  }
  throw new Error("focus_window requires id, title, or appId");
}

function writeSwayConfig(configHome: string): string {
  const swayDir = path.join(configHome, "sway");
  mkdirSync(swayDir, { recursive: true, mode: 0o700 });
  chmodSync(swayDir, 0o700);
  const configPath = path.join(swayDir, "config");
  writeFileSync(
    configPath,
    [
      "xwayland enable",
      "default_border none",
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  return configPath;
}

function sessionEnvironment(input: {
  runtimeDir: string;
  waylandDisplay: string;
  configHome: string;
  stateHome: string;
  cacheHome: string;
  swaySock: string;
  dbusAddress: string;
}): Record<string, string> {
  return {
    ...explicitEnvironment(input),
    SWAYSOCK: input.swaySock,
    DBUS_SESSION_BUS_ADDRESS: input.dbusAddress,
    XDG_CURRENT_DESKTOP: "sway",
  };
}

/**
 * Pure-headless Sway adapter. Compositor lifetime stays independent from the
 * separately supervised Bot Desktop; applications remain worker descendants.
 */
export class SwayBotScreenRuntimeAdapter implements BotScreenRuntimeAdapter {
  #units: ApplicationUnits;
  #runtimes = new Map<SurfaceId, BotScreenRuntime>();
  #sessions = new Map<SurfaceId, SwaySession>();
  #resolvedWayvnc: string | undefined;

  constructor(private readonly options: SwayAdapterOptions) {
    this.#units = new ApplicationUnits(options.hostRuntimeDir);
  }

  async start(provision: BotScreenProvision): Promise<BotScreenRuntime> {
    await this.#stopTracked(provision.surfaceId);
    await this.#units.stop(provision.surfaceId);
    if (!Number.isSafeInteger(provision.scale) || provision.scale < 1) {
      throw new Error("Sway Bot Screen scale must be a positive integer");
    }
    const { sway, wlrRandr } = await this.#resolveCompositor();
    const grim = executable(this.options.grimBin, "grim");
    if (grim === undefined) {
      throw new Error("grim is required for the Sway Bot Screen runtime");
    }
    const [inputHelper, captureHelper, botDesktop] = await Promise.all([
      this.options.inputHelperBin === undefined
        ? ensureInputHelper()
        : Promise.resolve(executable(this.options.inputHelperBin, this.options.inputHelperBin)),
      this.options.captureHelperBin === undefined
        ? ensureCaptureHelper()
        : Promise.resolve(executable(this.options.captureHelperBin, this.options.captureHelperBin)),
      this.options.botDesktopBin === undefined
        ? ensureBotDesktop()
        : Promise.resolve(executable(this.options.botDesktopBin, this.options.botDesktopBin)),
    ]);
    if (inputHelper === undefined || captureHelper === undefined || botDesktop === undefined) {
      throw new Error("Bot Desktop and the Bot Screen capture/input helpers are required for Sway");
    }

    const runtimeSurfaceDir = path.join(this.options.runtimeRoot, provision.surfaceId);
    const runtimeDir = path.join(runtimeSurfaceDir, String(provision.generation));
    const waylandSocketPath = path.join(runtimeDir, "wayland-0");
    const swaySockPath = path.join(runtimeDir, "sway-ipc.sock");
    const dbusPath = path.join(runtimeDir, "bus");
    if (Buffer.byteLength(waylandSocketPath) > 107 || Buffer.byteLength(swaySockPath) > 107) {
      throw new Error(
        `Bot Screen runtime path is too long for a private Wayland socket: ${runtimeDir}`,
      );
    }
    const profileDir = path.join(this.options.profileRoot, provision.surfaceId);
    const profileExisted = existsSync(profileDir);
    const configHome = path.join(profileDir, "config");
    const stateHome = path.join(profileDir, "state");
    const cacheHome = path.join(profileDir, "cache");
    rmSync(runtimeSurfaceDir, { recursive: true, force: true });
    for (const directory of [
      this.options.runtimeRoot,
      runtimeSurfaceDir,
      runtimeDir,
      profileDir,
      configHome,
      stateHome,
      cacheHome,
    ]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
    }
    const configPath = writeSwayConfig(configHome);
    const dbusAddress = `unix:path=${dbusPath}`;

    const bootstrapEnv = {
      ...sessionEnvironment({
        runtimeDir,
        waylandDisplay: "wayland-0",
        configHome,
        stateHome,
        cacheHome,
        swaySock: swaySockPath,
        dbusAddress,
      }),
      WLR_BACKENDS: "headless",
      WLR_HEADLESS_OUTPUTS: "1",
      WLR_LIBINPUT_NO_DEVICES: "1",
      WLR_RENDERER_ALLOW_SOFTWARE: "1",
      WLR_RENDERER: "pixman",
    };
    // This marker must precede spawn: recovery can encounter bound sockets
    // before Desktop readiness allows session.json to be committed.
    writeFileSync(path.join(runtimeDir, "generation.json"), JSON.stringify({
      compositor: "sway", generation: provision.generation,
    }), { mode: 0o600 });
    const swayProcess = Bun.spawn([
      ...this.#units.command(provision.surfaceId, provision.generation, "compositor", bootstrapEnv),
      sway,
      "-c",
      configPath,
    ], {
      env: this.#units.launcherEnvironment(bootstrapEnv),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    });
    let desktopProcess: SwayProcess | undefined;
    let computerWorker: SurfaceComputerWorker | undefined;
    let virtualInput: WaylandVirtualInput | undefined;
    try {
      const sockets = await this.#discoverSockets(runtimeDir, swaySockPath, swayProcess);
      const childEnv = sessionEnvironment({
        runtimeDir,
        waylandDisplay: sockets.waylandDisplay,
        configHome,
        stateHome,
        cacheHome,
        swaySock: sockets.swaySock,
        dbusAddress,
      });
      const outputName = "HEADLESS-1";
      const videoWidth = Math.round(provision.logicalWidth * provision.scale);
      const videoHeight = Math.round(provision.logicalHeight * provision.scale);
      await this.#configureOutput(
        wlrRandr,
        childEnv,
        outputName,
        videoWidth,
        videoHeight,
        provision.refreshRate,
        provision.scale,
        swayProcess,
      );
      const startedDesktop = Bun.spawn([
        ...this.#units.command(provision.surfaceId, provision.generation, "application", childEnv),
        botDesktop,
        String(provision.logicalWidth),
        String(provision.logicalHeight),
        String(provision.scale),
      ], {
        env: this.#units.launcherEnvironment(childEnv),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
      });
      desktopProcess = startedDesktop;
      const desktopReadiness = new ProcessLineReader(startedDesktop.stdout);
      await this.#waitForDesktop(
        desktopReadiness,
        startedDesktop,
        provision.logicalWidth,
        provision.logicalHeight,
      );
      await this.#capture(grim, childEnv, outputName, videoWidth, videoHeight);

      const startedVirtualInput = await WaylandVirtualInput.start(
        inputHelper,
        outputName,
        this.#units.launcherEnvironment(childEnv),
        provision,
        this.#units.command(provision.surfaceId, provision.generation, "input", childEnv),
      );
      virtualInput = startedVirtualInput;
      const startedComputerWorker = await this.options.computerWorkers.startComputerWorker({
        surfaceId: provision.surfaceId,
        runtimeGeneration: provision.generation,
        env: childEnv,
        wrapCommand: (targetEnvironment) => ({
          commandPrefix: this.#units.command(provision.surfaceId, provision.generation, "worker", targetEnvironment),
          launcherEnvironment: this.#units.launcherEnvironment(targetEnvironment),
        }),
      });
      computerWorker = startedComputerWorker;
      const session: SwaySession = {
        provision,
        runtimeSurfaceDir,
        runtimeDir,
        profileDir,
        childEnv,
        outputName,
        videoWidth,
        videoHeight,
        swayProcess,
        desktopProcess: startedDesktop,
        swayPid: swayProcess.pid,
        desktopPid: startedDesktop.pid,
        swayIdentity: ownedProcessIdentity(swayProcess.pid, runtimeDir, applicationUnitName(provision.surfaceId, provision.generation, "compositor")),
        desktopIdentity: ownedProcessIdentity(startedDesktop.pid, runtimeDir, applicationUnitName(provision.surfaceId, provision.generation, "application")),
        virtualInput: startedVirtualInput,
        computerWorker: startedComputerWorker,
        grim,
        inputHelper,
        captureHelper,
        sockets,
      };
      this.#writeSessionState(session);
      const runtime = this.#bindRuntime(session);
      this.#sessions.set(provision.surfaceId, session);
      this.#runtimes.set(provision.surfaceId, runtime);
      return runtime;
    } catch (error) {
      await computerWorker?.stop().catch(() => {});
      await virtualInput?.stop().catch(() => {});
      if (desktopProcess !== undefined) await terminateDetachedProcess(desktopProcess).catch(() => {});
      await terminateDetachedProcess(swayProcess).catch(() => {});
      await this.#units.stop(provision.surfaceId, provision.generation);
      rmSync(runtimeSurfaceDir, { recursive: true, force: true });
      if (!profileExisted) rmSync(profileDir, { recursive: true, force: true });
      throw error;
    }
  }

  async reconcile(provision: BotScreenProvision): Promise<BotScreenRuntime | undefined> {
    const session = this.#sessions.get(provision.surfaceId);
    const runtime = this.#runtimes.get(provision.surfaceId);
    if (
      session !== undefined
      && runtime !== undefined
      && session.provision.generation === provision.generation
    ) {
      if (await this.#liveTreeValid(session)) {
        try {
          await this.#ensureHelpers(session);
          return this.#runtimes.get(provision.surfaceId) ?? runtime;
        } catch {
          // Treat helper restart failure as an invalid tree.
        }
      }
      await this.#discardInvalid(provision);
      return undefined;
    }
    if (session === undefined && runtime === undefined) {
      try {
        const recovered = await this.#reattachFromDisk(provision);
        if (recovered !== undefined) return recovered;
      } catch {
        // Fall through to discard any leftover tree.
      }
    }
    await this.#discardInvalid(provision);
    return undefined;
  }

  async destroy(surfaceId: SurfaceId): Promise<void> {
    await this.#stopTracked(surfaceId);
    await this.#units.stop(surfaceId);
    rmSync(path.join(this.options.runtimeRoot, surfaceId), { recursive: true, force: true });
    rmSync(path.join(this.options.profileRoot, surfaceId), { recursive: true, force: true });
  }

  async #stopTracked(surfaceId: SurfaceId): Promise<void> {
    const runtime = this.#runtimes.get(surfaceId);
    if (runtime === undefined) {
      this.#sessions.delete(surfaceId);
      return;
    }
    await runtime.stop().catch(() => {});
    if (this.#runtimes.get(surfaceId) === runtime) this.#runtimes.delete(surfaceId);
    this.#sessions.delete(surfaceId);
  }

  async #liveTreeValid(session: SwaySession): Promise<boolean> {
    if (this.#liveSockets(session.runtimeDir) === undefined) return false;
    if (!this.#compositorRunning(session)) {
      return false;
    }
    if (!this.#desktopRunning(session)) {
      return false;
    }
    try {
      await this.#capture(
        session.grim,
        session.childEnv,
        session.outputName,
        session.videoWidth,
        session.videoHeight,
      );
      return true;
    } catch {
      return false;
    }
  }

  #liveSockets(runtimeDir: string): { waylandDisplay: string; swaySock: string } | undefined {
    if (!existsSync(runtimeDir)) return undefined;
    const waylandDisplay = readdirSync(runtimeDir).find((entry) =>
      /^wayland-\d+$/.test(entry) && isSocket(path.join(runtimeDir, entry))
    );
    const expectedSwaySock = path.join(runtimeDir, "sway-ipc.sock");
    const swaySock = isSocket(expectedSwaySock)
      ? expectedSwaySock
      : readdirSync(runtimeDir)
        .filter((entry) => entry.startsWith("sway-ipc") && isSocket(path.join(runtimeDir, entry)))
        .map((entry) => path.join(runtimeDir, entry))[0];
    if (waylandDisplay === undefined || swaySock === undefined) return undefined;
    return { waylandDisplay, swaySock };
  }

  async #ensureHelpers(session: SwaySession): Promise<void> {
    let rebound = false;
    if (session.virtualInput === undefined || !session.virtualInput.running) {
      session.virtualInput = await WaylandVirtualInput.start(
        session.inputHelper,
        session.outputName,
        this.#units.launcherEnvironment(session.childEnv),
        session.provision,
        this.#units.command(session.provision.surfaceId, session.provision.generation, "input", session.childEnv),
      );
      rebound = true;
    }
    if (session.computerWorker === undefined || !await this.#workerPending(session.computerWorker)) {
      session.computerWorker = await this.options.computerWorkers.startComputerWorker({
        surfaceId: session.provision.surfaceId,
        runtimeGeneration: session.provision.generation,
        env: session.childEnv,
        wrapCommand: (targetEnvironment) => ({
          commandPrefix: this.#units.command(
            session.provision.surfaceId,
            session.provision.generation,
            "worker",
            targetEnvironment,
          ),
          launcherEnvironment: this.#units.launcherEnvironment(targetEnvironment),
        }),
      });
      rebound = true;
    }
    if (!rebound) return;
    const runtime = this.#bindRuntime(session);
    this.#sessions.set(session.provision.surfaceId, session);
    this.#runtimes.set(session.provision.surfaceId, runtime);
  }

  async #workerPending(worker: SurfaceComputerWorker): Promise<boolean> {
    let settled = false;
    void worker.exited.then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await Promise.resolve();
    return !settled;
  }

  async #discardInvalid(provision: BotScreenProvision): Promise<void> {
    const session = this.#sessions.get(provision.surfaceId);
    await this.#stopTracked(provision.surfaceId);
    if (session !== undefined) {
      await session.virtualInput?.stop().catch(() => {});
      await session.computerWorker?.stop().catch(() => {});
      if (session.desktopProcess !== undefined) {
        await terminateDetachedProcess(session.desktopProcess).catch(() => {});
      } else if (session.desktopPid !== undefined) {
        await terminateOwnedProcess(session.desktopIdentity).catch(() => {});
      }
      if (session.swayProcess !== undefined) {
        await terminateDetachedProcess(session.swayProcess).catch(() => {});
      } else if (session.swayPid !== undefined) {
        await terminateOwnedProcess(session.swayIdentity).catch(() => {});
      }
    } else {
      await this.#stopPersistedPids(provision);
    }
    await this.#units.stop(provision.surfaceId, provision.generation).catch(async () => {
      await this.#units.stop(provision.surfaceId);
    });
    rmSync(path.join(this.options.runtimeRoot, provision.surfaceId), { recursive: true, force: true });
  }

  async #stopPersistedPids(provision: BotScreenProvision): Promise<void> {
    const runtimeDir = path.join(this.options.runtimeRoot, provision.surfaceId, String(provision.generation));
    const state = this.#readSessionState(runtimeDir);
    await this.#units.stop(provision.surfaceId, provision.generation);
    if (state !== undefined) {
      const desktop = state.desktopIdentity ?? ownedProcessIdentity(state.desktopPid ?? 0, runtimeDir);
      const sway = state.swayIdentity ?? ownedProcessIdentity(state.swayPid ?? 0, runtimeDir);
      await Promise.all([terminateOwnedProcess(desktop), terminateOwnedProcess(sway)]);
    }
    // Also covers pre-session.json startup and orphaned private descendants.
    await Promise.all(privateRuntimeProcesses(runtimeDir).map(terminateOwnedProcess));
  }

  #writeSessionState(session: SwaySession): void {
    writeFileSync(
      path.join(session.runtimeDir, SESSION_STATE_FILE),
      JSON.stringify({
        generation: session.provision.generation,
        waylandDisplay: session.sockets.waylandDisplay,
        swaySockName: path.basename(session.sockets.swaySock),
        outputName: session.outputName,
        ...(session.swayPid === undefined ? {} : { swayPid: session.swayPid }),
        ...(session.desktopPid === undefined ? {} : { desktopPid: session.desktopPid }),
        swayIdentity: session.swayIdentity,
        desktopIdentity: session.desktopIdentity,
      } satisfies SwaySessionState),
      { mode: 0o600 },
    );
  }

  #readSessionState(runtimeDir: string): SwaySessionState | undefined {
    try {
      const parsed = JSON.parse(readFileSync(path.join(runtimeDir, SESSION_STATE_FILE), "utf8")) as Partial<SwaySessionState>;
      if (
        typeof parsed.generation !== "number"
        || !Number.isSafeInteger(parsed.generation)
        || typeof parsed.waylandDisplay !== "string"
        || typeof parsed.swaySockName !== "string"
        || typeof parsed.outputName !== "string"
        || parsed.swaySockName.includes("/")
        || parsed.waylandDisplay.includes("/")
      ) {
        return undefined;
      }
      return {
        generation: parsed.generation,
        waylandDisplay: parsed.waylandDisplay,
        swaySockName: parsed.swaySockName,
        outputName: parsed.outputName,
        ...(typeof parsed.swayPid === "number" ? { swayPid: parsed.swayPid } : {}),
        ...(typeof parsed.desktopPid === "number" ? { desktopPid: parsed.desktopPid } : {}),
        ...(this.#readIdentity(parsed.swayIdentity, parsed.swayPid, runtimeDir) === undefined ? {} : { swayIdentity: parsed.swayIdentity }),
        ...(this.#readIdentity(parsed.desktopIdentity, parsed.desktopPid, runtimeDir) === undefined ? {} : { desktopIdentity: parsed.desktopIdentity }),
      };
    } catch {
      return undefined;
    }
  }

  #readIdentity(value: unknown, pid: number | undefined, runtimeDir: string): OwnedProcessIdentity | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const identity = value as Partial<OwnedProcessIdentity>;
    if (identity.pid !== pid || identity.runtimeDir !== runtimeDir
      || typeof identity.startTime !== "string" || !/^\d+$/.test(identity.startTime)
      || typeof identity.bootId !== "string"
      || (identity.unitName !== undefined && typeof identity.unitName !== "string")) return undefined;
    return identity as OwnedProcessIdentity;
  }

  async #reattachFromDisk(provision: BotScreenProvision): Promise<BotScreenRuntime | undefined> {
    const runtimeSurfaceDir = path.join(this.options.runtimeRoot, provision.surfaceId);
    const runtimeDir = path.join(runtimeSurfaceDir, String(provision.generation));
    const state = this.#readSessionState(runtimeDir);
    if (state === undefined || state.generation !== provision.generation) return undefined;
    const sockets = this.#liveSockets(runtimeDir);
    if (sockets === undefined) return undefined;
    if (sockets.waylandDisplay !== state.waylandDisplay) return undefined;
    if (path.basename(sockets.swaySock) !== state.swaySockName) return undefined;
    const swayIdentity = state.swayIdentity ?? ownedProcessIdentity(state.swayPid ?? 0, runtimeDir, applicationUnitName(provision.surfaceId, provision.generation, "compositor"));
    const desktopIdentity = state.desktopIdentity ?? ownedProcessIdentity(state.desktopPid ?? 0, runtimeDir, applicationUnitName(provision.surfaceId, provision.generation, "application"));
    if (!ownedProcessRunning(swayIdentity) || !ownedProcessRunning(desktopIdentity)) return undefined;
    const tools = await this.#resolveTools();
    const profileDir = path.join(this.options.profileRoot, provision.surfaceId);
    const configHome = path.join(profileDir, "config");
    const stateHome = path.join(profileDir, "state");
    const cacheHome = path.join(profileDir, "cache");
    if (!existsSync(configHome) || !existsSync(stateHome) || !existsSync(cacheHome)) return undefined;
    const childEnv = sessionEnvironment({
      runtimeDir,
      waylandDisplay: sockets.waylandDisplay,
      configHome,
      stateHome,
      cacheHome,
      swaySock: sockets.swaySock,
      dbusAddress: `unix:path=${path.join(runtimeDir, "bus")}`,
    });
    const videoWidth = Math.round(provision.logicalWidth * provision.scale);
    const videoHeight = Math.round(provision.logicalHeight * provision.scale);
    await this.#capture(tools.grim, childEnv, state.outputName, videoWidth, videoHeight);
    const session: SwaySession = {
      provision,
      runtimeSurfaceDir,
      runtimeDir,
      profileDir,
      childEnv,
      outputName: state.outputName,
      videoWidth,
      videoHeight,
      ...(state.swayPid === undefined ? {} : { swayPid: state.swayPid }),
      ...(state.desktopPid === undefined ? {} : { desktopPid: state.desktopPid }),
      swayIdentity,
      desktopIdentity,
      grim: tools.grim,
      inputHelper: tools.inputHelper,
      captureHelper: tools.captureHelper,
      sockets,
    };
    await this.#ensureHelpers(session);
    if (session.virtualInput === undefined || session.computerWorker === undefined) return undefined;
    if (this.#runtimes.get(provision.surfaceId) === undefined) {
      const runtime = this.#bindRuntime(session);
      this.#sessions.set(provision.surfaceId, session);
      this.#runtimes.set(provision.surfaceId, runtime);
    }
    this.#writeSessionState(session);
    return this.#runtimes.get(provision.surfaceId);
  }

  async #resolveCompositor(): Promise<{ sway: string; wlrRandr: string }> {
    if (this.options.runtimeSupply !== undefined) {
      const binaries = await resolveSwayRuntimeBinaries({
        ...(this.options.swayBin === undefined ? {} : { swayOverride: this.options.swayBin }),
        ...(this.options.swaymsgBin === undefined ? {} : { swaymsgOverride: this.options.swaymsgBin }),
        ...(this.options.wayvncBin === undefined ? {} : { wayvncOverride: this.options.wayvncBin }),
        ...(this.options.wlrRandrBin === undefined ? {} : { wlrRandrOverride: this.options.wlrRandrBin }),
        supply: this.options.runtimeSupply,
      });
      this.#resolvedWayvnc = binaries.wayvncBin;
      return { sway: binaries.swayBin, wlrRandr: binaries.wlrRandrBin };
    }
    const sway = executable(this.options.swayBin, "sway");
    if (sway === undefined) throw new Error("Sway executable is unavailable");
    const wlrRandr = executable(this.options.wlrRandrBin, "wlr-randr");
    if (wlrRandr === undefined) {
      throw new Error("wlr-randr is required for the Sway Bot Screen runtime");
    }
    return { sway, wlrRandr };
  }

  async #resolveTools(): Promise<{ grim: string; inputHelper: string; captureHelper: string }> {
    const grim = executable(this.options.grimBin, "grim");
    if (grim === undefined) throw new Error("grim is required for the Sway Bot Screen runtime");
    const [inputHelper, captureHelper] = await Promise.all([
      this.options.inputHelperBin === undefined
        ? ensureInputHelper()
        : Promise.resolve(executable(this.options.inputHelperBin, this.options.inputHelperBin)),
      this.options.captureHelperBin === undefined
        ? ensureCaptureHelper()
        : Promise.resolve(executable(this.options.captureHelperBin, this.options.captureHelperBin)),
    ]);
    if (inputHelper === undefined || captureHelper === undefined) {
      throw new Error("Bot Desktop and the Bot Screen capture/input helpers are required for Sway");
    }
    return { grim, inputHelper, captureHelper };
  }

  #compositorRunning(session: SwaySession): boolean {
    if (session.swayProcess !== undefined) return session.swayProcess.exitCode === null && session.swayProcess.signalCode === null;
    return ownedProcessRunning(session.swayIdentity);
  }

  #desktopRunning(session: SwaySession): boolean {
    if (session.desktopProcess !== undefined) return session.desktopProcess.exitCode === null && session.desktopProcess.signalCode === null;
    return ownedProcessRunning(session.desktopIdentity);
  }

  #compositorExited(session: SwaySession): Promise<number> {
    if (session.swayProcess !== undefined) return session.swayProcess.exited;
    return this.#watchPid(session.swayIdentity);
  }

  #desktopExited(session: SwaySession): Promise<number> {
    if (session.desktopProcess !== undefined) return session.desktopProcess.exited;
    return this.#watchPid(session.desktopIdentity);
  }

  async #watchPid(identity: OwnedProcessIdentity | undefined): Promise<number> {
    while (ownedProcessRunning(identity)) await Bun.sleep(100);
    return 0;
  }

  async #stopCompositor(session: SwaySession): Promise<void> {
    if (session.swayProcess !== undefined) {
      await terminateDetachedProcess(session.swayProcess);
      return;
    }
    if (session.swayPid !== undefined) await terminateOwnedProcess(session.swayIdentity);
  }

  async #stopDesktop(session: SwaySession): Promise<void> {
    if (session.desktopProcess !== undefined) {
      await terminateDetachedProcess(session.desktopProcess);
      return;
    }
    if (session.desktopPid !== undefined) await terminateOwnedProcess(session.desktopIdentity);
  }

  #bindRuntime(session: SwaySession): BotScreenRuntime {
    const provision = session.provision;
    const virtualInput = session.virtualInput;
    const computerWorker = session.computerWorker;
    if (virtualInput === undefined || computerWorker === undefined) {
      throw new Error("Sway Bot Screen helpers are required before binding a runtime");
    }
    const swayIpc = new SwayIpcClient(session.sockets.swaySock);
    const listWindows = async () => listApplicationToplevels(await swayIpc.getTree());
    let lastInputEpoch = 0;
    const sendAgentInput = async (
      deliver: (send: (event: BotScreenInputAction) => Promise<void>) => Promise<void>,
    ): Promise<void> => {
      const epoch = ++lastInputEpoch;
      await virtualInput.setInputAuthority(epoch);
      let sequence = 0;
      try {
        await deliver(async (event) => {
          await virtualInput.input({
            surfaceId: provision.surfaceId,
            runtimeGeneration: provision.generation,
            geometryGeneration: provision.geometryGeneration,
            controllerEpoch: epoch,
            sequence: ++sequence,
            ...event,
          });
        });
      } finally {
        await virtualInput.release(epoch);
      }
    };
    const outcome = Promise.race<BotScreenRuntimeOutcome>([
      this.#compositorExited(session).then((status) => ({
        type: "compositor-exited",
        error: new Error(`Sway compositor exited with status ${status}`),
      })),
      this.#desktopExited(session).then((status) => ({
        type: "desktop-exited",
        error: new Error(`Bot Desktop exited with status ${status}`),
      })),
      computerWorker.exited.then((error) => ({ type: "computer-worker-exited", error })),
      virtualInput.exited.then((error) => ({ type: "input-helper-exited", error })),
    ]);
    let stopped = false;
    let cleanupComplete = false;
    let stopInFlight: Promise<void> | undefined;
    const captureStreams = new Set<BotScreenCaptureStream>();
    const captureStreamStarts = new Set<Promise<void>>();
    let captureStreamSequence = 0;
    const expandedViews = new Set<BotScreenExpandedView>();
    const expandedViewStarts = new Set<Promise<void>>();
    type SharedWayvnc = {
      process: SwayProcess;
      socketPath: string;
      leaseCount: number;
      stopping?: Promise<void>;
      listeners: Set<(error: Error) => void>;
    };
    let sharedWayvnc: SharedWayvnc | undefined;
    let sharedWayvncStart: Promise<SharedWayvnc> | undefined;
    let sharedWayvncStop: Promise<void> | undefined;
    let pendingExpandedAcquires = 0;
    const failSharedWayvnc = (shared: SharedWayvnc, error: Error): void => {
      for (const listener of [...shared.listeners]) listener(error);
    };
    const stopSharedWayvnc = (shared: SharedWayvnc): Promise<void> => {
      if (shared.stopping !== undefined) return shared.stopping;
      const stopping = (async (): Promise<void> => {
        if (sharedWayvnc === shared) sharedWayvnc = undefined;
        if (this.#units.enabled) {
          // The launcher is not the service: stop only this owned WayVNC unit,
          // never all Surface units while a preview or compositor remains live.
          const result = await command([
            "systemctl", "--user", "stop",
            applicationUnitName(provision.surfaceId, provision.generation, "wayvnc"),
          ], this.#units.launcherEnvironment(session.childEnv));
          if (result.status !== 0) throw new Error(`could not stop WayVNC unit: ${result.stderr.trim()}`);
        }
        await terminateDetachedProcess(shared.process);
        try { unlinkSync(shared.socketPath); } catch { /* already gone */ }
      })();
      shared.stopping = stopping;
      sharedWayvncStop = stopping;
      // Keep a failed barrier: starting a new generation over uncertain cleanup
      // would reuse its unit/socket. Successful cleanup alone releases the name.
      void stopping.then(() => {
        if (sharedWayvncStop === stopping) sharedWayvncStop = undefined;
      }, () => {});
      return stopping;
    };
    const ensureSharedWayvnc = async (wayvnc: string): Promise<SharedWayvnc> => {
      await sharedWayvncStop;
      if (stopped) throw new Error("Sway Bot Screen compositor is not running");
      if (sharedWayvnc !== undefined) return sharedWayvnc;
      if (sharedWayvncStart !== undefined) return sharedWayvncStart;
      const starting = (async (): Promise<SharedWayvnc> => {
        const socketPath = path.join(session.runtimeDir, "wayvnc.sock");
        // wayvnc 0.10.1: --unix-socket plus a path address. There is no
        // --disable-paste flag; --disable-input disables remote pointer,
        // keyboard, and clipboard (wayvnc PR #129, present in 0.10.1).
        // Sway 1.12 binds wayland-1+, never wayland-0; clients must use the discovered display.
        const wayvncProcess = Bun.spawn([
          ...this.#units.command(provision.surfaceId, provision.generation, "wayvnc", session.childEnv),
          wayvnc,
          "--unix-socket",
          "--output",
          session.outputName,
          "--disable-input",
          socketPath,
        ], {
          env: this.#units.launcherEnvironment(session.childEnv),
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          detached: true,
        });
        const wayvncStderr = new Response(wayvncProcess.stderr).text();
        const wayvncExitDetail = async (status: number): Promise<string> => {
          const detail = (await wayvncStderr).trim().split("\n").slice(-8).join(" ");
          return `WayVNC exited before binding its socket with status ${status}${detail === "" ? "" : `: ${detail}`}`;
        };
        try {
          const deadline = Date.now() + 5_000;
          while (!isSocket(socketPath)) {
            if (wayvncProcess.exitCode !== null) {
              throw new Error(await wayvncExitDetail(wayvncProcess.exitCode));
            }
            if (stopped || !this.#compositorRunning(session)) {
              throw new Error("Sway Bot Screen compositor is not running");
            }
            if (Date.now() >= deadline) throw new Error("WayVNC did not create its private RFB socket");
            await Bun.sleep(20);
          }
          chmodSync(socketPath, 0o600);
          const listeners = new Set<(error: Error) => void>();
          const shared: SharedWayvnc = {
            process: wayvncProcess,
            socketPath,
            leaseCount: 0,
            listeners,
          };
          void wayvncProcess.exited.then((status) => {
            void stopSharedWayvnc(shared).catch(() => {});
            failSharedWayvnc(shared, new Error(`WayVNC exited with status ${status}`));
          });
          sharedWayvnc = shared;
          return shared;
        } catch (error) {
          await terminateDetachedProcess(wayvncProcess).catch(() => {});
          try { unlinkSync(socketPath); } catch { /* already gone */ }
          throw error;
        }
      })();
      sharedWayvncStart = starting;
      try {
        return await starting;
      } finally {
        if (sharedWayvncStart === starting) sharedWayvncStart = undefined;
      }
    };
    const capture = async (): Promise<BotScreenCapture> => {
      if (stopped || !this.#compositorRunning(session)) throw new Error("Sway Bot Screen compositor is not running");
      if (!this.#desktopRunning(session)) throw new Error("Bot Desktop is not running");
      return this.#capture(session.grim, session.childEnv, session.outputName, session.videoWidth, session.videoHeight);
    };
    const openCaptureStream = async (): Promise<BotScreenCaptureStream> => {
      if (stopped || !this.#compositorRunning(session)) throw new Error("Sway Bot Screen compositor is not running");
      if (!this.#desktopRunning(session)) throw new Error("Bot Desktop is not running");
      const opening = Promise.withResolvers<void>();
      captureStreamStarts.add(opening.promise);
      try {
        const stream = await WaylandCaptureStream.start(
          session.captureHelper,
          session.outputName,
          this.#units.launcherEnvironment(session.childEnv),
          session.videoWidth,
          session.videoHeight,
          this.#units.command(
            provision.surfaceId,
            provision.generation,
            `capture-${++captureStreamSequence}`,
            session.childEnv,
          ),
        );
        if (stopped || !this.#compositorRunning(session)) {
          await stream.close();
          throw new Error("Sway Bot Screen compositor is not running");
        }
        let closed = false;
        let lease!: BotScreenCaptureStream;
        const close = async (): Promise<void> => {
          if (closed) return;
          closed = true;
          captureStreams.delete(lease);
          await stream.close();
        };
        lease = {
          next: async () => {
            try {
              return await stream.next();
            } catch (error) {
              await close().catch(() => {});
              throw error;
            }
          },
          close,
        };
        captureStreams.add(lease);
        return lease;
      } finally {
        opening.resolve();
        captureStreamStarts.delete(opening.promise);
      }
    };
    const act = async (
      action: ComputerAction,
      inputAuthority?: ComputerInputAuthority,
    ): Promise<BotScreenActionResult> => {
      if (isInputAction(action.name)) {
        if (inputAuthority === undefined || inputAuthority.surfaceId !== provision.surfaceId) {
          throw new Error("Bot Screen input authority does not match this Surface");
        }
      }
      if (action.name === "screenshot") return { image: await capture() };
      if (action.name === "list_windows") return { windowList: await listWindows() };
      if (action.name === "observe") {
        const windowList = await listWindows();
        return { image: await capture(), windowList };
      }
      if (action.name === "focus_window") {
        const windows = await listWindows();
        const matches = resolveFocusMatches(windows, action.args);
        if (matches.length === 0) throw new Error("focus_window did not match a window");
        if (matches.length > 1) throw new Error("focus_window matched multiple windows");
        const target = matches[0]!;
        await swayIpc.runCommand(`[con_id=${target.id}] focus`);
        const confirmed = (await listWindows()).find((window) => window.id === target.id);
        if (confirmed?.focused !== true) throw new Error("Sway window focus was not confirmed");
        return {};
      }
      if (action.name === "click") {
        const x = requireCoordinate(action.args.x, "click x");
        const y = requireCoordinate(action.args.y, "click y");
        const button = pointerButton(action.args.button);
        await sendAgentInput(async (send) => {
          await send({ type: "motion", x, y });
          await send({ type: "button", x, y, button, state: "pressed" });
          await send({ type: "button", x, y, button, state: "released" });
        });
        return {};
      }
      if (action.name === "scroll") {
        const x = optionalCoordinate(action.args.x, 0);
        const y = optionalCoordinate(action.args.y, 0);
        const deltaX = requireCoordinate(action.args.deltaX, "scroll deltaX");
        const deltaY = requireCoordinate(action.args.deltaY, "scroll deltaY");
        await sendAgentInput(async (send) => {
          await send({ type: "scroll", x, y, deltaX, deltaY });
        });
        return {};
      }
      if (action.name === "key") {
        const keyCodes = linuxKeyChord(action.args.key);
        await sendAgentInput(async (send) => {
          for (const keyCode of keyCodes) {
            await send({ type: "key", keyCode, state: "pressed" });
          }
          for (const keyCode of keyCodes.toReversed()) {
            await send({ type: "key", keyCode, state: "released" });
          }
        });
        return {};
      }
      if (action.name === "type") {
        if (typeof action.args.text !== "string") throw new Error("type requires args.text");
        const text = action.args.text;
        await sendAgentInput(async (send) => {
          await send({ type: "paste", text });
        });
        return {};
      }
      const result = await computerWorker.act(action, inputAuthority);
      const workerImage = result.image === undefined
        ? undefined
        : {
            mediaType: result.image.mediaType,
            bytes: new Uint8Array(Buffer.from(result.image.base64, "base64")),
          };
      return {
        ...(result.text === undefined ? {} : { text: result.text }),
        ...(result.windowList === undefined ? {} : { windowList: result.windowList }),
        ...(workerImage === undefined ? {} : { image: workerImage }),
      };
    };
    const runtime: BotScreenRuntime = {
      readiness: {
        compositor: "ready",
        waylandSocket: "private",
        output: {
          geometryGeneration: provision.geometryGeneration,
          logicalWidth: provision.logicalWidth,
          logicalHeight: provision.logicalHeight,
          scale: provision.scale,
          refreshRate: provision.refreshRate,
        },
        desktopSurface: "ready",
        capture: "ready",
        input: "ready",
        computerWorker: "ready",
      },
      expandedProjection: "rfb",
      capture,
      openCaptureStream,
      acquireExpandedView: async () => {
        if (stopped || !this.#compositorRunning(session)) throw new Error("Sway Bot Screen compositor is not running");
        if (!this.#desktopRunning(session)) throw new Error("Bot Desktop is not running");
        if (this.#resolvedWayvnc === undefined && this.options.runtimeSupply !== undefined) {
          await this.#resolveCompositor();
        }
        const wayvnc = this.#resolvedWayvnc
          ?? (this.options.wayvncBin === undefined
            ? undefined
            : executable(this.options.wayvncBin, this.options.wayvncBin));
        if (wayvnc === undefined) throw new Error("WayVNC executable is unavailable");
        const opening = Promise.withResolvers<void>();
        expandedViewStarts.add(opening.promise);
        pendingExpandedAcquires += 1;
        try {
          const shared = await ensureSharedWayvnc(wayvnc);
          if (stopped || !this.#compositorRunning(session)) {
            throw new Error("Sway Bot Screen compositor is not running");
          }
          const inbound: Uint8Array[] = [];
          const waiters: Array<{ resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }> = [];
          let closed = false;
          let leaseFailed: Error | undefined;
          const outbound: Array<{
            bytes: Uint8Array;
            offset: number;
            resolve: () => void;
            reject: (error: Error) => void;
          }> = [];
          let outboundBytes = 0;
          let writeTimeout: Timer | undefined;
          const failLease = (error: Error): void => {
            if (leaseFailed !== undefined) return;
            leaseFailed = error;
            clearTimeout(writeTimeout);
            for (const pending of outbound.splice(0)) pending.reject(error);
            outboundBytes = 0;
            for (const waiter of waiters.splice(0)) waiter.reject(error);
          };
          // Bun TCP write returns the accepted prefix length, not a buffered
          // boolean. Hold the suffix until drain and never overtake a prior send.
          const flushWrites = (): void => {
            if (leaseFailed !== undefined) return;
            clearTimeout(writeTimeout);
            try {
              while (outbound.length > 0) {
                const pending = outbound[0]!;
                const remaining = pending.bytes.subarray(pending.offset);
                const written = socket.write(remaining);
                if (written < 0 || written > remaining.byteLength) throw new Error("WayVNC RFB write failed");
                pending.offset += written;
                if (pending.offset !== pending.bytes.byteLength) break;
                outbound.shift();
                outboundBytes -= pending.bytes.byteLength;
                pending.resolve();
              }
              if (outbound.length > 0) {
                writeTimeout = setTimeout(() => failLease(new Error("WayVNC RFB write drain timed out")), 5_000);
              }
            } catch (cause) {
              failLease(cause instanceof Error ? cause : new Error(String(cause)));
            }
          };
          shared.listeners.add(failLease);
          const socket = await Bun.connect({
            unix: shared.socketPath,
            socket: {
              data(_socket, data) {
                const copy = data instanceof Uint8Array ? data.slice() : new Uint8Array(data);
                const waiter = waiters.shift();
                if (waiter !== undefined) waiter.resolve(copy);
                else inbound.push(copy);
              },
              error(_socket, error) {
                failLease(error instanceof Error ? error : new Error(String(error)));
              },
              close() {
                failLease(new Error("WayVNC RFB connection closed"));
              },
              drain() {
                flushWrites();
              },
            },
          });
          if (stopped || !this.#compositorRunning(session)) {
            try { socket.end(); } catch { /* already closed */ }
            shared.listeners.delete(failLease);
            throw new Error("Sway Bot Screen compositor is not running");
          }
          shared.leaseCount += 1;
          let lease!: BotScreenExpandedView;
          const close = async (): Promise<void> => {
            if (closed) return;
            closed = true;
            expandedViews.delete(lease);
            shared.listeners.delete(failLease);
            failLease(new Error("Sway Bot Screen expanded view is closed"));
            try { socket.end(); } catch { /* already closed */ }
            shared.leaseCount -= 1;
            if (shared.leaseCount === 0 && pendingExpandedAcquires === 0) {
              await stopSharedWayvnc(shared);
            }
          };
          lease = {
            send: async (bytes) => {
              if (closed) throw new Error("Sway Bot Screen expanded view is closed");
              if (leaseFailed !== undefined) throw leaseFailed;
              if (bytes.byteLength === 0) return;
              if (outboundBytes + bytes.byteLength > 4 * 1024 * 1024) {
                const error = new Error("WayVNC RFB pending write limit exceeded");
                failLease(error);
                throw error;
              }
              const pending = Promise.withResolvers<void>();
              const idle = outbound.length === 0;
              // send owns retained bytes until completion, including queued callers.
              outbound.push({ bytes: bytes.slice(), offset: 0, resolve: pending.resolve, reject: pending.reject });
              outboundBytes += bytes.byteLength;
              if (idle) flushWrites();
              return pending.promise;
            },
            receive: async () => {
              if (closed) throw new Error("Sway Bot Screen expanded view is closed");
              if (leaseFailed !== undefined) throw leaseFailed;
              const queued = inbound.shift();
              if (queued !== undefined) return queued;
              const waiter = Promise.withResolvers<Uint8Array>();
              waiters.push(waiter);
              return waiter.promise;
            },
            close,
          };
          expandedViews.add(lease);
          return lease;
        } catch (error) {
          if (
            sharedWayvnc !== undefined
            && sharedWayvnc.leaseCount === 0
            && pendingExpandedAcquires === 1
          ) {
            await stopSharedWayvnc(sharedWayvnc);
          }
          throw error;
        } finally {
          pendingExpandedAcquires -= 1;
          opening.resolve();
          expandedViewStarts.delete(opening.promise);
        }
      },
      act,
      setInputAuthority: async (controllerEpoch) => {
        const epoch = Math.max(controllerEpoch, lastInputEpoch + 1);
        lastInputEpoch = epoch;
        await virtualInput.setInputAuthority(epoch);
        return epoch;
      },
      input: (event) => virtualInput.input(event),
      releaseInput: (controllerEpoch) => virtualInput.release(controllerEpoch),
      outcome,
      stop: async () => {
        stopped = true;
        if (cleanupComplete) return;
        if (stopInFlight !== undefined) return stopInFlight;
        const cleanup = (async (): Promise<void> => {
          await virtualInput.stop().catch(() => {});
          await Promise.allSettled(captureStreamStarts);
          await Promise.allSettled(expandedViewStarts);
          await Promise.allSettled([...captureStreams].map((stream) => stream.close()));
          await Promise.allSettled([...expandedViews].map((view) => view.close()));
          await Promise.allSettled([
            computerWorker.stop(),
            this.#stopDesktop(session),
            this.#stopCompositor(session),
          ]);
          await this.#units.stop(provision.surfaceId, provision.generation);
          await Promise.all(privateRuntimeProcesses(session.runtimeDir).map(terminateOwnedProcess));
          rmSync(session.runtimeSurfaceDir, { recursive: true, force: true });
        })();
        stopInFlight = cleanup;
        try {
          await cleanup;
          cleanupComplete = true;
        } finally {
          if (this.#runtimes.get(provision.surfaceId) === runtime) {
            this.#runtimes.delete(provision.surfaceId);
          }
          this.#sessions.delete(provision.surfaceId);
          stopInFlight = undefined;
        }
      },
    };
    return runtime;
  }

  async #discoverSockets(
    runtimeDir: string,
    expectedSwaySock: string,
    swayProcess: SwayProcess,
  ): Promise<{ waylandDisplay: string; swaySock: string }> {
    const stderr = new Response(swayProcess.stderr).text();
    const exited = swayProcess.exited.then(async (status) => {
      const detail = (await stderr).trim().split("\n").slice(-3).join(" ");
      throw new Error(
        `Sway exited before readiness with status ${status}${detail === "" ? "" : `: ${detail}`}`,
      );
    });
    const socketReady = (async (): Promise<{ waylandDisplay: string; swaySock: string }> => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const waylandDisplay = readdirSync(runtimeDir).find((entry) =>
          /^wayland-\d+$/.test(entry) && isSocket(path.join(runtimeDir, entry))
        );
        const discoveredSwaySock = isSocket(expectedSwaySock)
          ? expectedSwaySock
          : readdirSync(runtimeDir)
            .filter((entry) => entry.startsWith("sway-ipc") && isSocket(path.join(runtimeDir, entry)))
            .map((entry) => path.join(runtimeDir, entry))[0];
        if (waylandDisplay !== undefined && discoveredSwaySock !== undefined) {
          return { waylandDisplay, swaySock: discoveredSwaySock };
        }
        await Bun.sleep(20);
      }
      throw new Error("Sway did not create its private Wayland and IPC sockets");
    })();
    return Promise.race([socketReady, exited]);
  }

  async #configureOutput(
    wlrRandr: string,
    environment: Record<string, string>,
    outputName: string,
    videoWidth: number,
    videoHeight: number,
    refreshRate: number,
    scale: number,
    swayProcess: SwayProcess,
  ): Promise<void> {
    const argv = [
      wlrRandr,
      "--output",
      outputName,
      "--on",
      "--custom-mode",
      `${videoWidth}x${videoHeight}@${refreshRate}Hz`,
      "--pos",
      "0,0",
      "--transform",
      "normal",
      "--scale",
      String(scale),
    ];
    const deadline = Date.now() + 5_000;
    let lastError = "Sway output configuration failed";
    while (Date.now() < deadline) {
      if (swayProcess.exitCode !== null) {
        throw new Error(`Sway exited before output configuration with status ${swayProcess.exitCode}`);
      }
      const configured = await command(argv, environment);
      if (configured.status === 0) return;
      lastError = `Sway output configuration failed${
        configured.stderr.trim() === "" ? "" : `: ${configured.stderr.trim()}`
      }`;
      await Bun.sleep(20);
    }
    throw new Error(lastError);
  }

  async #waitForDesktop(
    readiness: ProcessLineReader,
    desktopProcess: SwayProcess,
    width: number,
    height: number,
  ): Promise<void> {
    const expected = `READY ${width} ${height}`;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const line = await Promise.race([
        readiness.next(),
        desktopProcess.exited.then(() => {
          throw new Error("Bot Desktop exited during startup");
        }),
        Bun.sleep(Math.max(1, deadline - Date.now())).then(() => {
          throw new Error("Bot Desktop did not commit the configured output surface");
        }),
      ]);
      if (line === expected) return;
    }
    throw new Error("Bot Desktop did not commit the configured output surface");
  }

  async #capture(
    grim: string,
    environment: Record<string, string>,
    outputName: string,
    expectedWidth: number,
    expectedHeight: number,
  ): Promise<BotScreenCapture> {
    const shot = Bun.spawn([grim, "-o", outputName, "-"], {
      env: environment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, bytes, stderr] = await Promise.all([
      shot.exited,
      new Response(shot.stdout).arrayBuffer(),
      new Response(shot.stderr).text(),
    ]);
    const image = new Uint8Array(bytes);
    if (status !== 0 || image.length < 8 || image[0] !== 0x89 || image[1] !== 0x50) {
      throw new Error(`Sway Bot Screen capture failed${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`);
    }
    const metadata = await sharp(image).metadata();
    if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
      throw new Error("Sway Bot Screen capture geometry does not match its configured output");
    }
    return { mediaType: "image/png", bytes: image };
  }
}
