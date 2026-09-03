import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { ComputerAction } from "@omarchy-bot/domain";
import type { SurfaceComputerWorker, Supervisor } from "../../supervision/supervisor.ts";
import type {
  BotScreenActionResult,
  BotScreenCapture,
  BotScreenInputLease,
  BotScreenProvision,
  BotScreenRuntime,
  BotScreenRuntimeAdapter,
} from "./botScreenManager.ts";

interface HyprlandAdapterOptions {
  runtimeRoot: string;
  profileRoot: string;
  hostRuntimeDir?: string;
  hostWaylandDisplay?: string;
  hyprlandBin?: string;
  hyprctlBin?: string;
  grimBin?: string;
  applicationBin?: string;
  computerWorkers: Pick<Supervisor, "startComputerWorker">;
}

interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

type ScreenProcess = Bun.Subprocess<"ignore", "ignore", "ignore">;

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
  constructor(private readonly options: HyprlandAdapterOptions) {}

  async start(provision: BotScreenProvision): Promise<BotScreenRuntime> {
    const hyprland = executable(this.options.hyprlandBin, "Hyprland");
    const hyprctl = executable(this.options.hyprctlBin, "hyprctl");
    const grim = executable(this.options.grimBin, "grim");
    const application = executable(this.options.applicationBin, "alacritty");
    if (hyprland === undefined || hyprctl === undefined || grim === undefined || application === undefined) {
      throw new Error("Hyprland, hyprctl, grim, and the Bot Screen application are required");
    }

    const hostRuntimeDir = this.options.hostRuntimeDir;
    const hostDisplay = this.options.hostWaylandDisplay;
    if (hostRuntimeDir === undefined || hostDisplay === undefined) {
      throw new Error("a running host Wayland session is required");
    }
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
    const socketRuntimeDir = mkdtempSync(path.join(hostRuntimeDir, ".ob"));
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
    const compositor = Bun.spawn([hyprland, "--config", configPath], {
      env: bootstrapEnv,
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      detached: true,
    });

    let applicationProcess: ScreenProcess | undefined;
    let computerWorker: SurfaceComputerWorker | undefined;
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
      await this.#hyprctl(hyprctl, childEnv, ["output", "create", "headless", outputName]);
      await this.#hyprctl(hyprctl, childEnv, [
        "keyword",
        "monitor",
        `${outputName},${provision.logicalWidth}x${provision.logicalHeight}@${provision.refreshRate},0x0,${provision.scale}`,
      ]);

      const monitors = await this.#monitors(hyprctl, childEnv);
      for (const monitor of monitors) {
        if (monitor.name.startsWith("WAYLAND-")) {
          await this.#hyprctl(hyprctl, childEnv, ["output", "remove", monitor.name]);
        }
      }
      await this.#waitForHeadlessOutput(hyprctl, childEnv, outputName);

      applicationProcess = Bun.spawn([application], {
        env: childEnv,
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
      });
      computerWorker = startedComputerWorker;
      const exited = Promise.race([
        compositor.exited.then((status) => new Error(`nested Hyprland exited with status ${status}`)),
        applicationProcess.exited.then((status) => new Error(`Bot Screen application exited with status ${status}`)),
        startedComputerWorker.exited,
      ]);

      let stopped = false;
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
        lease?: BotScreenInputLease,
      ): Promise<BotScreenActionResult> => {
        const result = await startedComputerWorker.act(action, lease);
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
        exited,
        stop: async () => {
          if (stopped) return;
          stopped = true;
          await Promise.allSettled([
            startedComputerWorker.stop(),
            ...(applicationProcess === undefined ? [] : [terminate(applicationProcess)]),
            terminate(compositor),
          ]);
          rmSync(runtimeSurfaceDir, { recursive: true, force: true });
          rmSync(socketRuntimeDir, { recursive: true, force: true });
        },
      };
    } catch (error) {
      await computerWorker?.stop().catch(() => {});
      await Promise.allSettled([
        ...(applicationProcess === undefined ? [] : [terminate(applicationProcess)]),
        terminate(compositor),
      ]);
      rmSync(runtimeSurfaceDir, { recursive: true, force: true });
      rmSync(socketRuntimeDir, { recursive: true, force: true });
      throw error;
    }
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
