import { lstatSync } from "node:fs";
import path from "node:path";
import type { SurfaceId } from "@omarchy-bot/domain";

function socketExists(candidate: string): boolean {
  try {
    return lstatSync(candidate).isSocket();
  } catch {
    return false;
  }
}

async function run(argv: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { status, stdout, stderr };
}

/**
 * Places every production Bot Screen child in a Surface-owned transient user
 * service when a user systemd manager is available. The service executes
 * through `env -i`, so only the target environment supplied here reaches the
 * child and the daemon never imports values into the global user manager.
 */
export class ApplicationUnits {
  readonly enabled: boolean;
  #systemdRun: string | undefined;
  #systemctl: string | undefined;
  #env: string | undefined;

  constructor(private readonly hostRuntimeDir?: string) {
    this.#systemdRun = Bun.which("systemd-run") ?? undefined;
    this.#systemctl = Bun.which("systemctl") ?? undefined;
    this.#env = Bun.which("env") ?? undefined;
    this.enabled = this.#systemdRun !== undefined
      && this.#systemctl !== undefined
      && this.#env !== undefined
      && hostRuntimeDir !== undefined
      && socketExists(path.join(hostRuntimeDir, "systemd", "private"));
  }

  command(
    surfaceId: SurfaceId,
    generation: number,
    role: "compositor" | "application" | "input" | "worker",
    targetEnvironment: Record<string, string>,
  ): string[] {
    if (!this.enabled) return [];
    const systemdRun = this.#systemdRun;
    const env = this.#env;
    if (systemdRun === undefined || env === undefined) {
      throw new Error("Bot Screen application units are enabled without their required executables");
    }
    const explicitEnvironment = Object.entries(targetEnvironment)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`);
    return [
      systemdRun,
      "--user",
      "--quiet",
      "--collect",
      "--wait",
      "--pipe",
      "--service-type=exec",
      `--unit=${this.#prefix(surfaceId)}-g${generation}-${role}`,
      "--slice=app.slice",
      "--property=KillMode=control-group",
      "--",
      env,
      "-i",
      ...explicitEnvironment,
    ];
  }

  launcherEnvironment(targetEnvironment: Record<string, string>): Record<string, string> {
    if (!this.enabled) return targetEnvironment;
    const hostRuntimeDir = this.hostRuntimeDir;
    if (hostRuntimeDir === undefined) {
      throw new Error("Bot Screen application units are enabled without a host runtime directory");
    }
    const environment: Record<string, string> = {
      HOME: process.env.HOME ?? targetEnvironment.HOME ?? "",
      LANG: process.env.LANG ?? targetEnvironment.LANG ?? "C.UTF-8",
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      USER: process.env.USER ?? targetEnvironment.USER ?? "",
      LOGNAME: process.env.LOGNAME ?? targetEnvironment.LOGNAME ?? "",
      XDG_RUNTIME_DIR: hostRuntimeDir,
    };
    if (process.env.DBUS_SESSION_BUS_ADDRESS !== undefined) {
      environment.DBUS_SESSION_BUS_ADDRESS = process.env.DBUS_SESSION_BUS_ADDRESS;
    }
    return environment;
  }

  async stop(surfaceId: SurfaceId, generation?: number): Promise<void> {
    if (!this.enabled) return;
    const systemctl = this.#systemctl;
    if (systemctl === undefined) {
      throw new Error("Bot Screen application units are enabled without systemctl");
    }
    const prefix = this.#prefix(surfaceId);
    const pattern = generation === undefined ? `${prefix}-g*` : `${prefix}-g${generation}-*`;
    const listed = await run([
      systemctl,
      "--user",
      "list-units",
      "--all",
      "--full",
      "--plain",
      "--no-legend",
      `${pattern}.service`,
    ]);
    if (listed.status !== 0) {
      throw new Error(`could not inspect Bot Screen application units: ${listed.stderr.trim() || `status ${listed.status}`}`);
    }
    const units = listed.stdout
      .split("\n")
      .map((line) => {
        const [unit] = line.trim().split(/\s+/, 1);
        return unit;
      })
      .filter((unit): unit is string => unit !== undefined && unit.endsWith(".service"));
    if (units.length === 0) return;
    const stopped = await run([systemctl, "--user", "stop", ...units]);
    if (stopped.status !== 0) {
      throw new Error(`could not stop Bot Screen application units: ${stopped.stderr.trim() || `status ${stopped.status}`}`);
    }
  }

  #prefix(surfaceId: SurfaceId): string {
    return `omarchy-bot-screen-${surfaceId.slice("surf_".length)}`;
  }
}
