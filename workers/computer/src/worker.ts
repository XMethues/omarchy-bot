#!/usr/bin/env bun
/**
 * Computer worker (ADR-0001): MCP client over @agent-sh/computer-use-linux
 * plus native extras (open_app/open_url/notify). Speaks the Bot Screen worker
 * protocol (LF-JSONL over stdio, hello first) and rejects input without
 * authoritative Bot/Surface context.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  HEARTBEAT_MS,
  PROTOCOL_VERSION,
  readJsonl,
  stderr,
  writeJsonl,
  type ComputerActPayload,
  type ComputerCommand,
  type ComputerResult,
} from "@omarchy-bot/agent-contract";
import { isInputAction, isSurfaceId } from "@omarchy-bot/domain";
import { McpClient, type McpCallResult } from "./mcp.ts";

const AGENT_ID = "computer";
const EXPECTED_SURFACE_ID = process.env.OMARCHY_BOT_SURFACE_ID;
const EXPECTED_RUNTIME_GENERATION = Number(process.env.OMARCHY_BOT_RUNTIME_GENERATION);

function resolveBinary(): string | undefined {
  const envOverride = process.env.OMARCHY_COMPUTER_BIN ?? process.env.OMARCHY_BOT_COMPUTER_BIN;
  if (envOverride && existsSync(envOverride)) return envOverride;
  const onPath = Bun.which("computer-use-linux");
  if (onPath) return onPath;
  const candidates = [
    `${process.env.HOME}/.pi/agent/npm/node_modules/@agent-sh/computer-use-linux/npm/bin/computer-use-linux-linux-x64`,
    new URL("../../node_modules/@agent-sh/computer-use-linux/npm/bin/computer-use-linux-linux-x64", import.meta.url).pathname,
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

function textOf(result: McpCallResult): string {
  return result.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n");
}

function imageOf(result: McpCallResult): { mediaType: "image/png" | "image/jpeg"; base64: string } | undefined {
  const img = result.content.find((c) => c.type === "image" && typeof c.data === "string");
  if (!img?.data) return undefined;
  const mediaType = img.mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
  return { mediaType, base64: img.data };
}

type WindowRow = { id: string; title: string; appId?: string; focused: boolean };

function windowsOf(result: McpCallResult): WindowRow[] {
  const structured = result.structured as { windows?: unknown[] } | undefined;
  const list = Array.isArray(structured?.windows) ? structured.windows : Array.isArray(result.structured) ? (result.structured as unknown[]) : [];
  const out: WindowRow[] = [];
  for (const raw of list) {
    const w = raw as Record<string, unknown>;
    if (typeof w !== "object" || w === null) continue;
    out.push({
      id: String(w.window_id ?? w.id ?? ""),
      title: String(w.title ?? ""),
      ...(w.app_id !== undefined || w.appId !== undefined || w.wm_class !== undefined ? { appId: String(w.app_id ?? w.appId ?? w.wm_class) } : {}),
      focused: w.focused === true,
    });
  }
  return out;
}

let client: McpClient | undefined;

async function getClient(): Promise<McpClient> {
  if (client) return client;
  const bin = resolveBinary();
  if (!bin) throw new Error("computer-use-linux binary not found (set OMARCHY_COMPUTER_BIN or install @agent-sh/computer-use-linux)");
  client = new McpClient([bin, "mcp"]);
  await client.initialize();
  return client;
}
type LaunchedApplication = Bun.Subprocess<"ignore", "ignore", "ignore">;
const launchedApplications = new Set<LaunchedApplication>();

async function stopLaunchedApplications(): Promise<void> {
  await Promise.all([...launchedApplications].map(async (application) => {
    if (application.exitCode !== null) return;
    try {
      process.kill(-application.pid, "SIGTERM");
    } catch {
      application.kill("SIGTERM");
    }
    const stopped = await Promise.race([
      application.exited.then(() => true),
      Bun.sleep(1_000).then(() => false),
    ]);
    if (stopped) return;
    try {
      process.kill(-application.pid, "SIGKILL");
    } catch {
      application.kill("SIGKILL");
    }
    await application.exited;
  }));
  launchedApplications.clear();
}


async function runNative(command: string[]): Promise<string> {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${command[0]} exited ${code}: ${err.trim().slice(0, 200)}`);
  return out.trim();
}

function parseDesktopExec(value: string): string[] {
  const argv: string[] = [];
  let argument = "";
  let quoted = false;
  let escaped = false;
  const finishArgument = (): void => {
    if (argument !== "") argv.push(argument);
    argument = "";
  };
  for (const character of value.trim()) {
    if (escaped) {
      argument += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "\"") {
      quoted = !quoted;
    } else if (!quoted && /\s/.test(character)) {
      finishArgument();
    } else {
      argument += character;
    }
  }
  if (escaped || quoted) throw new Error("application desktop entry has an invalid Exec command");
  finishArgument();
  return argv
    .filter((argument) => !/^%[fFuUick]$/.test(argument))
    .map((argument) => argument.replaceAll("%%", "%"));
}

function desktopApplicationCommand(application: string): string[] {
  if (!application.endsWith(".desktop")) return [application];
  const dataHomes = [
    process.env.XDG_DATA_HOME ?? path.join(process.env.HOME ?? "", ".local", "share"),
    ...(process.env.XDG_DATA_DIRS ?? "/usr/local/share:/usr/share").split(":"),
  ];
  const entryPath = dataHomes
    .map((directory) => path.join(directory, "applications", application))
    .find((candidate) => existsSync(candidate));
  if (entryPath === undefined) throw new Error(`application desktop entry not found: ${application}`);
  const lines = readFileSync(entryPath, "utf8").split(/\r?\n/);
  let inDesktopEntry = false;
  let type: string | undefined;
  let command: string | undefined;
  for (const line of lines) {
    if (line.startsWith("[")) {
      inDesktopEntry = line === "[Desktop Entry]";
    } else if (inDesktopEntry && line.startsWith("Type=")) {
      type = line.slice("Type=".length);
    } else if (inDesktopEntry && line.startsWith("Exec=")) {
      command = line.slice("Exec=".length);
    }
  }
  if (type !== "Application" || command === undefined) {
    throw new Error(`invalid application desktop entry: ${application}`);
  }
  const argv = parseDesktopExec(command);
  if (argv.length === 0) throw new Error(`application desktop entry has no executable: ${application}`);
  return argv;
}

function launchApplication(application: string): void {
  const child = Bun.spawn(desktopApplicationCommand(application), {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    detached: true,
  });
  launchedApplications.add(child);
  void child.exited.then(() => launchedApplications.delete(child));
}

async function performAction(action: { name: string; args: Record<string, unknown> }): Promise<ComputerActPayload> {
  const { name, args } = action;

  // Native extras handled without MCP (ADR-0001).
  if (name === "open_app") {
    const app = String(args.app ?? "");
    if (!app) throw new Error("open_app requires args.app");
    launchApplication(app);
    return { done: true, text: `launched ${app}` };
  }
  if (name === "open_url") {
    const url = String(args.url ?? "");
    if (!url) throw new Error("open_url requires args.url");
    await runNative(["xdg-open", url]);
    return { done: true, text: `opened ${url}` };
  }
  if (name === "notify") {
    const title = String(args.title ?? "omarchy-bot");
    const body = String(args.body ?? "");
    await runNative(["notify-send", title, body]);
    return { done: true, text: `notified: ${title}` };
  }

  const mcp = await getClient();
  let result: McpCallResult;
  switch (name) {
    case "observe": {
      const focused = await mcp.callTool("focused_window", {});
      const windows = await mcp.callTool("list_windows", {});
      const payload: ComputerActPayload = {
        done: true,
        text: [textOf(focused), textOf(windows)].filter((t) => t !== "").join("\n"),
        ...(windowsOf(windows).length > 0 ? { windowList: windowsOf(windows) } : {}),
      };
      return payload;
    }
    case "screenshot": {
      result = await mcp.callTool("screenshot", { format: "png", ...args });
      const image = imageOf(result);
      if (!image) throw new Error(`screenshot returned no image: ${textOf(result).slice(0, 200)}`);
      const text = textOf(result);
      return { done: true, ...(text !== "" ? { text } : {}), image };
    }
    case "list_windows": {
      result = await mcp.callTool("list_windows", { ...args });
      const windows = windowsOf(result);
      return { done: true, text: textOf(result), ...(windows.length > 0 ? { windowList: windows } : {}) };
    }
    case "focus_window":
      result = await mcp.callTool("activate_window", { ...args });
      break;
    case "click":
      result = await mcp.callTool("click", { ...args });
      break;
    case "type":
      result = await mcp.callTool("type_text", { text: args.text ?? "", ...args });
      break;
    case "key":
      result = await mcp.callTool("press_key", { key: args.key ?? "", ...args });
      break;
    case "scroll":
      result = await mcp.callTool("scroll", { ...args });
      break;
    default:
      throw new Error(`unsupported action ${name as string}`);
  }
  if (result.isError) throw new Error(textOf(result).slice(0, 500) || "mcp tool error");
  return { done: true, text: textOf(result) };
}

async function handle(cmd: ComputerCommand): Promise<ComputerResult> {
  switch (cmd.type) {
    case "act": {
      if (!isSurfaceId(cmd.surfaceId)) {
        return { requestId: cmd.requestId, ok: false, error: "valid surfaceId is required" };
      }
      if (!isSurfaceId(EXPECTED_SURFACE_ID ?? "") || cmd.surfaceId !== EXPECTED_SURFACE_ID) {
        return { requestId: cmd.requestId, ok: false, error: "command Surface does not match worker context" };
      }
      if (!Number.isInteger(cmd.runtimeGeneration) || cmd.runtimeGeneration !== EXPECTED_RUNTIME_GENERATION) {
        return { requestId: cmd.requestId, ok: false, error: "runtime generation does not match worker context" };
      }
      if (cmd.inputAuthority !== undefined && cmd.inputAuthority.surfaceId !== cmd.surfaceId) {
        return { requestId: cmd.requestId, ok: false, error: "input authority Surface does not match command Surface" };
      }
      if (
        isInputAction(cmd.action.name)
        && (
          cmd.inputAuthority === undefined
          || cmd.inputAuthority.botId.length === 0
          || cmd.inputAuthority.turnId.length === 0
        )
      ) {
        return { requestId: cmd.requestId, ok: false, error: "input action requires explicit Bot Screen authority" };
      }
      try {
        const payload = await performAction(cmd.action);
        return { requestId: cmd.requestId, ok: true, payload };
      } catch (err) {
        return { requestId: cmd.requestId, ok: false, error: String(err).slice(0, 500) };
      }
    }
    case "shutdown": {
      if (client) {
        await client.close();
        client = undefined;
      }
      await stopLaunchedApplications();
      return { requestId: cmd.requestId, ok: true, payload: { done: true } };
    }
    default: {
      const never: never = cmd;
      void never;
      return { requestId: "unknown", ok: false, error: "unsupported command" };
    }
  }
}

writeJsonl({ type: "hello", v: PROTOCOL_VERSION, worker: `computer:${AGENT_ID}`, pid: process.pid });
setInterval(() => writeJsonl({ type: "heartbeat" }), HEARTBEAT_MS).unref();

await readJsonl(
  Bun.stdin.stream(),
  (msg) => {
    if (msg && typeof msg === "object" && "type" in msg) {
      const command = msg as ComputerCommand;
      void handle(command).then((result) => {
        if (command.type !== "shutdown") {
          writeJsonl(result);
          return;
        }
        process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(0));
      }).catch((err) => {
        stderr(`handle failed: ${String(err)}`);
      });
    }
  },
  () => {
    void stopLaunchedApplications().finally(() => process.exit(0));
  },
);
