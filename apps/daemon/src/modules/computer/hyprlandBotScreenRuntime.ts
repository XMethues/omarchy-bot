import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { ComputerAction, SurfaceId } from "@omarchy-bot/domain";
import type { ComputerInputAuthority } from "@omarchy-bot/agent-contract";
import type { SurfaceComputerWorker, Supervisor } from "../../supervision/supervisor.ts";
import { ensureInputHelper } from "../../../native/pointer-helper/build.ts";
import { ApplicationUnits } from "../../supervision/applicationUnits.ts";
import {
  BotScreenInputRejectedError,
  type BotScreenActionResult,
  type BotScreenCapture,
  type BotScreenInputEvent,
  type BotScreenProvision,
  type BotScreenRuntime,
  type BotScreenRuntimeAdapter,
} from "./botScreenManager.ts";

interface HyprlandAdapterOptions {
  runtimeRoot: string;
  profileRoot: string;
  hostRuntimeDir?: string;
  hostWaylandDisplay?: string;
  hyprlandBin?: string;
  hyprctlBin?: string;
  grimBin?: string;
  inputHelperBin?: string;
  applicationBin?: string;
  computerWorkers: Pick<Supervisor, "startComputerWorker">;
}

interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

type ScreenProcess = Bun.Subprocess<"ignore", "ignore", "ignore">;
const INPUT_RPC_TIMEOUT_MS = 1_000;
type PointerProcess = Bun.Subprocess<"pipe", "pipe", "pipe">;

function executable(name: string | undefined, fallback: string): string | undefined {
  const candidate = name ?? fallback;
  if (candidate.includes("/")) return existsSync(candidate) ? candidate : undefined;
  return Bun.which(candidate) ?? undefined;
}

async function command(argv: string[], env: Record<string, string>): Promise<CommandResult> {
  const child = Bun.spawn(argv, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { status, stdout, stderr };
}

function signalProcessTree(child: ScreenProcess, signal: NodeJS.Signals): void {
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

async function terminate(child: ScreenProcess): Promise<void> {
  if (child.exitCode !== null) return;
  signalProcessTree(child, "SIGTERM");
  const stopped = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(3_000).then(() => false),
  ]);
  if (stopped) return;
  signalProcessTree(child, "SIGKILL");
  await child.exited;
}

class WaylandVirtualInput {
  readonly exited: Promise<Error>;
  #reader: ReadableStreamDefaultReader<Uint8Array>;
  #decoder = new TextDecoder();
  #buffer = "";
  #requestSequence = 0;
  #operations: Promise<void> = Promise.resolve();
  #stopped = false;
  #context: string;
  #terminalError: Error | undefined;

  private constructor(
    private readonly process: PointerProcess,
    provision: BotScreenProvision,
  ) {
    this.#reader = process.stdout.getReader();
    this.#context = `${provision.surfaceId} ${provision.generation} ${provision.geometryGeneration}`;
    this.exited = process.exited.then((status) => new Error(`Bot Screen input helper exited with status ${status}`));
  }

  static async start(
    binary: string,
    outputName: string,
    launcherEnvironment: Record<string, string>,
    provision: BotScreenProvision,
    commandPrefix: string[],
  ): Promise<WaylandVirtualInput> {
    const process = Bun.spawn([
      ...commandPrefix,
      binary,
      outputName,
      provision.surfaceId,
      String(provision.generation),
      String(provision.geometryGeneration),
      String(provision.logicalWidth),
      String(provision.logicalHeight),
    ], {
      env: launcherEnvironment,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const input = new WaylandVirtualInput(process, provision);
    const ready = await Promise.race([
      input.#readLine(),
      process.exited.then(async (status) => {
        const stderr = await new Response(process.stderr).text();
        throw new Error(
          `Bot Screen input helper exited with status ${status}${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`,
        );
      }),
      Bun.sleep(5_000).then(() => {
        throw new Error("Bot Screen input helper did not become ready");
      }),
    ]);
    if (ready !== "READY") {
      process.kill("SIGTERM");
      throw new Error("Bot Screen input helper returned an invalid readiness response");
    }
    return input;
  }

  setInputAuthority(controllerEpoch: number): Promise<void> {
    const requestSequence = ++this.#requestSequence;
    return this.#command(
      `authority ${requestSequence} ${this.#context} ${controllerEpoch}`,
      requestSequence,
    );
  }

  input(event: BotScreenInputEvent): Promise<void> {
    const requestSequence = ++this.#requestSequence;
    const envelope = `${event.surfaceId} ${event.runtimeGeneration} ${event.geometryGeneration} ${event.controllerEpoch} ${event.sequence}`;
    if (event.type === "motion") {
      return this.#command(`motion ${requestSequence} ${envelope} ${event.x} ${event.y}`, requestSequence);
    }
    if (event.type === "button") {
      const button = event.button === "left" ? 272 : event.button === "right" ? 273 : 274;
      return this.#command(
        `button ${requestSequence} ${envelope} ${event.x} ${event.y} ${button} ${
          event.state === "pressed" ? 1 : 0
        }`,
        requestSequence,
      );
    }
    if (event.type === "scroll") {
      return this.#command(
        `scroll ${requestSequence} ${envelope} ${event.x} ${event.y} ${event.deltaX} ${event.deltaY}`,
        requestSequence,
      );
    }
    if (event.type === "key") {
      return this.#command(
        `key ${requestSequence} ${envelope} ${event.keyCode} ${event.state === "pressed" ? 1 : 0}`,
        requestSequence,
      );
    }
    return this.#command(
      `paste ${requestSequence} ${envelope} ${Buffer.from(event.text, "utf8").toString("base64")}`,
      requestSequence,
    );
  }

  release(controllerEpoch?: number): Promise<void> {
    const requestSequence = ++this.#requestSequence;
    return this.#command(
      `release ${requestSequence} ${this.#context} ${controllerEpoch ?? 0}`,
      requestSequence,
    );
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    if (this.#terminalError === undefined) await this.release().catch(() => {});
    this.#stopped = true;
    this.process.stdin.end();
    const exited = await Promise.race([
      this.process.exited.then(() => true),
      Bun.sleep(1_000).then(() => false),
    ]);
    if (exited) return;
    this.process.kill("SIGTERM");
    const terminated = await Promise.race([
      this.process.exited.then(() => true),
      Bun.sleep(1_000).then(() => false),
    ]);
    if (terminated) return;
    this.process.kill("SIGKILL");
    await this.process.exited;
  }


  #command(line: string, requestSequence: number): Promise<void> {
    const operation = this.#operations.then(async () => {
      if (this.#terminalError !== undefined) throw this.#terminalError;
      if (this.#stopped || this.process.exitCode !== null) throw new Error("Bot Screen input helper is not running");
      let timeout: Timer | undefined;
      let response: string;
      try {
        const exchange = (async () => {
          this.process.stdin.write(`${line}\n`);
          await this.process.stdin.flush();
          return this.#readLine();
        })();
        response = await Promise.race([
          exchange,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              const error = new Error("Bot Screen input helper RPC timed out");
              this.#terminalError = error;
              this.process.kill("SIGTERM");
              reject(error);
            }, INPUT_RPC_TIMEOUT_MS);
            timeout.unref?.();
          }),
        ]);
      } catch (cause) {
        const error = this.#terminalError
          ?? (cause instanceof Error ? cause : new Error(String(cause)));
        this.#terminalError = error;
        this.process.kill("SIGTERM");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      if (response === `OK ${requestSequence}`) return;
      const rejectionPrefix = `ERR ${requestSequence} `;
      if (response.startsWith(rejectionPrefix)) {
        throw new BotScreenInputRejectedError(response.slice(rejectionPrefix.length));
      }
      const error = new Error("Bot Screen input helper returned an invalid protocol response");
      this.#terminalError = error;
      this.process.kill("SIGTERM");
      throw error;
    });
    this.#operations = operation.catch(() => {});
    return operation;
  }

  async #readLine(): Promise<string> {
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline >= 0) {
        const line = this.#buffer.slice(0, newline);
        this.#buffer = this.#buffer.slice(newline + 1);
        return line;
      }
      const chunk = await this.#reader.read();
      if (chunk.done) throw new Error("Bot Screen input helper closed its protocol stream");
      this.#buffer += this.#decoder.decode(chunk.value, { stream: true });
    }
  }
}

function explicitEnvironment(input: {
  runtimeDir: string;
  waylandDisplay: string;
  configHome: string;
  stateHome: string;
  cacheHome: string;
  instanceSignature?: string;
}): Record<string, string> {
  const env: Record<string, string> = {
    HOME: process.env.HOME ?? path.dirname(input.configHome),
    LANG: process.env.LANG ?? "C.UTF-8",
    LOGNAME: process.env.LOGNAME ?? process.env.USER ?? "",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    USER: process.env.USER ?? "",
    XDG_CACHE_HOME: input.cacheHome,
    XDG_CONFIG_HOME: input.configHome,
    XDG_RUNTIME_DIR: input.runtimeDir,
    XDG_SESSION_TYPE: "wayland",
    XDG_STATE_HOME: input.stateHome,
    WAYLAND_DISPLAY: input.waylandDisplay,
    GDK_BACKEND: "wayland",
    MOZ_ENABLE_WAYLAND: "1",
    QT_QPA_PLATFORM: "wayland",
  };
  for (const key of ["OMARCHY_COMPUTER_BIN", "OMARCHY_BOT_COMPUTER_BIN"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  if (input.instanceSignature !== undefined) env.HYPRLAND_INSTANCE_SIGNATURE = input.instanceSignature;
  return env;
}

function isSocket(candidate: string): boolean {
  try {
    return lstatSync(candidate).isSocket();
  } catch {
    return false;
  }
}

function discoverHostWaylandDisplay(runtimeDir: string): string | undefined {
  try {
    const displays = readdirSync(runtimeDir)
      .filter((entry) => /^wayland-\d+$/.test(entry) && isSocket(path.join(runtimeDir, entry)))
      .sort();
    return displays.length === 1 ? displays[0] : undefined;
  } catch {
    return undefined;
  }
}

function socketRuntimeName(surfaceId: SurfaceId): string {
  const entropy = BigInt(`0x${surfaceId.slice(-11)}`).toString(36).padStart(9, "0");
  return `.b${entropy}`;
}


function minimalConfig(): string {
  return [
    "# Purpose-built nested Bot Screen config. No Omarchy/UWSM imports or autostart.",
    "monitor = , preferred, auto, 1",
    "xwayland {",
    "  enabled = false",
    "}",
    "animations {",
    "  enabled = false",
    "}",
    "misc {",
    "  disable_hyprland_logo = true",
    "  disable_splash_rendering = true",
    "  force_default_wallpaper = 0",
    "}",
    "",
  ].join("\n");
}

/** Production nested-Hyprland adapter. It never captures or launches on the host socket. */
export class HyprlandBotScreenRuntimeAdapter implements BotScreenRuntimeAdapter {
  #units: ApplicationUnits;

  constructor(private readonly options: HyprlandAdapterOptions) {
    this.#units = new ApplicationUnits(options.hostRuntimeDir);
  }

  async start(provision: BotScreenProvision): Promise<BotScreenRuntime> {
    await this.#units.stop(provision.surfaceId);
    this.#removeSocketRuntimeDirs(provision.surfaceId);
    const hyprland = executable(this.options.hyprlandBin, "Hyprland");
    const hyprctl = executable(this.options.hyprctlBin, "hyprctl");
    const grim = executable(this.options.grimBin, "grim");
    const application = executable(this.options.applicationBin, "alacritty");
    if (hyprland === undefined || hyprctl === undefined || grim === undefined || application === undefined) {
      throw new Error("Hyprland, hyprctl, grim, and the Bot Screen application are required");
    }

    const hostRuntimeDir = this.options.hostRuntimeDir;
    if (hostRuntimeDir === undefined) throw new Error("a running host Wayland session is required");
    const hostDisplay = this.options.hostWaylandDisplay ?? discoverHostWaylandDisplay(hostRuntimeDir);
    if (hostDisplay === undefined) throw new Error("a unique running host Wayland session is required");
    const hostSocket = path.isAbsolute(hostDisplay) ? hostDisplay : path.join(hostRuntimeDir, hostDisplay);
    if (!isSocket(hostSocket)) throw new Error("the host Wayland socket is unavailable");

    const runtimeSurfaceDir = path.join(this.options.runtimeRoot, provision.surfaceId);
    const runtimeDir = path.join(runtimeSurfaceDir, String(provision.generation));
    const profileDir = path.join(this.options.profileRoot, provision.surfaceId);
    const configHome = path.join(profileDir, "config");
    const stateHome = path.join(profileDir, "state");
    const cacheHome = path.join(profileDir, "cache");
    for (const directory of [this.options.runtimeRoot, runtimeSurfaceDir, runtimeDir, profileDir, configHome, stateHome, cacheHome]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
    }
    // Hyprland appends its long instance signature and IPC socket names to
    // XDG_RUNTIME_DIR. A short sibling keeps those AF_UNIX paths below 108 bytes.
    const socketRuntimeDir = path.join(hostRuntimeDir, socketRuntimeName(provision.surfaceId));
    mkdirSync(socketRuntimeDir, { recursive: false, mode: 0o700 });
    chmodSync(socketRuntimeDir, 0o700);
    const configPath = path.join(runtimeDir, "hyprland.conf");
    writeFileSync(configPath, minimalConfig(), { mode: 0o600 });
    const bootstrapEnv = explicitEnvironment({
      runtimeDir: socketRuntimeDir,
      waylandDisplay: hostSocket,
      configHome,
      stateHome,
      cacheHome,
    });
    const compositor = Bun.spawn([
      ...this.#units.command(provision.surfaceId, provision.generation, "compositor", bootstrapEnv),
      hyprland,
      "--config",
      configPath,
    ], {
      env: this.#units.launcherEnvironment(bootstrapEnv),
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    });

    let applicationProcess: ScreenProcess | undefined;
    let computerWorker: SurfaceComputerWorker | undefined;
    let virtualInput: WaylandVirtualInput | undefined;
    try {
      const ready = await this.#discover(socketRuntimeDir, compositor);
      const childEnv = explicitEnvironment({
        runtimeDir: socketRuntimeDir,
        waylandDisplay: ready.waylandSocket,
        configHome,
        stateHome,
        cacheHome,
        instanceSignature: ready.instanceSignature,
      });
      const outputName = `BOT-${provision.surfaceId.slice(-12).toUpperCase()}`;
      const videoWidth = Math.round(provision.logicalWidth * provision.scale);
      const videoHeight = Math.round(provision.logicalHeight * provision.scale);
      await this.#hyprctl(hyprctl, childEnv, ["output", "create", "headless", outputName]);
      await this.#hyprctl(hyprctl, childEnv, [
        "keyword",
        "monitor",
        `${outputName},${videoWidth}x${videoHeight}@${provision.refreshRate},0x0,${provision.scale}`,
      ]);

      const monitors = await this.#monitors(hyprctl, childEnv);
      for (const monitor of monitors) {
        if (monitor.name.startsWith("WAYLAND-")) {
          await this.#hyprctl(hyprctl, childEnv, ["output", "remove", monitor.name]);
        }
      }
      await this.#waitForHeadlessOutput(hyprctl, childEnv, outputName);
      const inputHelper = this.options.inputHelperBin === undefined
        ? await ensureInputHelper()
        : executable(this.options.inputHelperBin, this.options.inputHelperBin);
      if (inputHelper === undefined) throw new Error("the Bot Screen Wayland input helper is unavailable");
      const startedVirtualInput = await WaylandVirtualInput.start(
        inputHelper,
        outputName,
        this.#units.launcherEnvironment(childEnv),
        provision,
        this.#units.command(provision.surfaceId, provision.generation, "input", childEnv),
      );
      virtualInput = startedVirtualInput;

      applicationProcess = Bun.spawn([
        ...this.#units.command(provision.surfaceId, provision.generation, "application", childEnv),
        application,
      ], {
        env: this.#units.launcherEnvironment(childEnv),
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
        detached: true,
      });
      await this.#waitForApplication(hyprctl, childEnv, applicationProcess);
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
      const exited = Promise.race([
        compositor.exited.then((status) => new Error(`nested Hyprland exited with status ${status}`)),
        applicationProcess.exited.then((status) => new Error(`Bot Screen application exited with status ${status}`)),
        startedComputerWorker.exited,
        startedVirtualInput.exited,
      ]);

      let stopped = false;
      let cleanupComplete = false;
      let stopInFlight: Promise<void> | undefined;
      const capture = async (): Promise<BotScreenCapture> => {
        if (stopped || compositor.exitCode !== null) throw new Error("Bot Screen compositor is not running");
        const shot = Bun.spawn([grim, "-o", outputName, "-"], {
          env: childEnv,
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
          throw new Error(`Bot Screen capture failed${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`);
        }
        return { mediaType: "image/png", bytes: image };
      };
      const act = async (
        action: ComputerAction,
        inputAuthority?: ComputerInputAuthority,
      ): Promise<BotScreenActionResult> => {
        if (action.name === "screenshot") return { image: await capture() };
        const result = await startedComputerWorker.act(action, inputAuthority);
        const workerImage = result.image === undefined
          ? undefined
          : {
              mediaType: result.image.mediaType,
              bytes: new Uint8Array(Buffer.from(result.image.base64, "base64")),
            };
        return {
          ...(result.text === undefined ? {} : { text: result.text }),
          ...(result.windowList === undefined ? {} : { windowList: result.windowList }),
          ...(workerImage === undefined && action.name === "observe"
            ? { image: await capture() }
            : workerImage === undefined ? {} : { image: workerImage }),
        };
      };
      return {
        capture,
        act,
        setInputAuthority: (controllerEpoch) => startedVirtualInput.setInputAuthority(controllerEpoch),
        input: (event) => startedVirtualInput.input(event),
        releaseInput: (controllerEpoch) => startedVirtualInput.release(controllerEpoch),
        exited,
        stop: async () => {
          stopped = true;
          if (cleanupComplete) return;
          if (stopInFlight !== undefined) return stopInFlight;
          const cleanup = (async (): Promise<void> => {
            await startedVirtualInput.stop().catch(() => {});
            await Promise.allSettled([
              startedComputerWorker.stop(),
              ...(applicationProcess === undefined ? [] : [terminate(applicationProcess)]),
              terminate(compositor),
            ]);
            await this.#units.stop(provision.surfaceId, provision.generation);
            rmSync(runtimeSurfaceDir, { recursive: true, force: true });
            rmSync(socketRuntimeDir, { recursive: true, force: true });
          })();
          stopInFlight = cleanup;
          try {
            await cleanup;
            cleanupComplete = true;
          } finally {
            stopInFlight = undefined;
          }
        },
      };
    } catch (error) {
      await computerWorker?.stop().catch(() => {});
      await virtualInput?.stop().catch(() => {});
      await Promise.allSettled([
        ...(applicationProcess === undefined ? [] : [terminate(applicationProcess)]),
        terminate(compositor),
      ]);
      await this.#units.stop(provision.surfaceId, provision.generation);
      rmSync(runtimeSurfaceDir, { recursive: true, force: true });
      rmSync(socketRuntimeDir, { recursive: true, force: true });
      throw error;
    }
  }

  async reconcile(provision: BotScreenProvision): Promise<BotScreenRuntime | undefined> {
    // Worker and helper protocols use daemon-owned stdio and cannot be
    // reconstructed honestly. Tear down any surviving partial cgroup before
    // BotScreenManager advances the runtime generation.
    await this.#units.stop(provision.surfaceId);
    this.#removeSocketRuntimeDirs(provision.surfaceId);
    rmSync(path.join(this.options.runtimeRoot, provision.surfaceId), { recursive: true, force: true });
    return undefined;
  }

  async destroy(surfaceId: SurfaceId): Promise<void> {
    await this.#units.stop(surfaceId);
    rmSync(path.join(this.options.runtimeRoot, surfaceId), { recursive: true, force: true });
    this.#removeSocketRuntimeDirs(surfaceId);
    rmSync(path.join(this.options.profileRoot, surfaceId), { recursive: true, force: true });
  }

  #removeSocketRuntimeDirs(surfaceId: SurfaceId): void {
    const hostRuntimeDir = this.options.hostRuntimeDir;
    if (hostRuntimeDir === undefined || !existsSync(hostRuntimeDir)) return;
    rmSync(path.join(hostRuntimeDir, socketRuntimeName(surfaceId)), { recursive: true, force: true });
  }

  async #discover(
    runtimeDir: string,
    compositor: ScreenProcess,
  ): Promise<{ instanceSignature: string; waylandSocket: string }> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (compositor.exitCode !== null) throw new Error("nested Hyprland exited before readiness");
      const hyprDir = path.join(runtimeDir, "hypr");
      const instanceSignature = existsSync(hyprDir)
        ? readdirSync(hyprDir).find((entry) => isSocket(path.join(hyprDir, entry, ".socket.sock")))
        : undefined;
      const waylandSocket = readdirSync(runtimeDir).find((entry) =>
        /^wayland-\d+$/.test(entry) && isSocket(path.join(runtimeDir, entry))
      );
      if (instanceSignature !== undefined && waylandSocket !== undefined) {
        return { instanceSignature, waylandSocket };
      }
      await Bun.sleep(20);
    }
    throw new Error("nested Hyprland did not become ready");
  }

  async #waitForApplication(
    hyprctl: string,
    env: Record<string, string>,
    application: ScreenProcess,
  ): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (application.exitCode !== null) throw new Error("Bot Screen application exited during startup");
      const raw = await this.#hyprctl(hyprctl, env, ["clients"], true);
      const clients: unknown = JSON.parse(raw);
      if (Array.isArray(clients) && clients.length > 0) return;
      await Bun.sleep(20);
    }
    throw new Error("Bot Screen application did not create a window");
  }

  async #waitForHeadlessOutput(
    hyprctl: string,
    env: Record<string, string>,
    outputName: string,
  ): Promise<void> {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const active = (await this.#monitors(hyprctl, env)).filter((monitor) => !monitor.disabled);
      if (active.length === 1 && active[0]?.name === outputName) return;
      await Bun.sleep(20);
    }
    throw new Error("nested Hyprland did not complete its headless output transition");
  }

  async #hyprctl(
    hyprctl: string,
    env: Record<string, string>,
    args: string[],
    json = false,
  ): Promise<string> {
    const result = await command([
      hyprctl,
      ...(json ? ["-j"] : []),
      "-i",
      env.HYPRLAND_INSTANCE_SIGNATURE!,
      ...args,
    ], env);
    if (result.status !== 0) {
      throw new Error(`hyprctl ${args.join(" ")} failed${result.stderr.trim() === "" ? "" : `: ${result.stderr.trim()}`}`);
    }
    return result.stdout;
  }

  async #monitors(hyprctl: string, env: Record<string, string>): Promise<Array<{ name: string; disabled?: boolean }>> {
    const raw = await this.#hyprctl(hyprctl, env, ["monitors", "all"], true);
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("hyprctl returned an invalid monitor list");
    return parsed.filter((monitor): monitor is { name: string; disabled?: boolean } =>
      monitor !== null && typeof monitor === "object" && "name" in monitor && typeof monitor.name === "string"
    );
  }
}
