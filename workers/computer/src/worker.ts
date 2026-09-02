#!/usr/bin/env bun
/**
 * Computer worker (ADR-0001): MCP client over @agent-sh/computer-use-linux
 * plus native extras (open_app/open_url/notify). Speaks the omarchy-bot
 * computer protocol (LF-JSONL over stdio, hello first). The daemon is the
 * lease authority; this worker refuses input actions with no lease token
 * purely as defense in depth.
 */
import { existsSync } from "node:fs";
import {
  HEARTBEAT_MS,
  PROTOCOL_VERSION,
  readJsonl,
  stderr,
  writeJsonl,
  type ComputerActPayload,
  type ComputerCommand,
  type ComputerProbePayload,
  type ComputerResult,
} from "@omarchy-bot/agent-contract";
import { isInputAction } from "@omarchy-bot/domain";
import { McpClient, type McpCallResult } from "./mcp.ts";

const AGENT_ID = "computer";

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

async function runNative(command: string[]): Promise<string> {
  const proc = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${command[0]} exited ${code}: ${err.trim().slice(0, 200)}`);
  return out.trim();
}

async function performAction(action: { name: string; args: Record<string, unknown> }, leaseToken?: string): Promise<ComputerActPayload> {
  const { name, args } = action;

  // Native extras handled without MCP (ADR-0001).
  if (name === "open_app") {
    const app = String(args.app ?? "");
    if (!app) throw new Error("open_app requires args.app");
    try {
      await runNative(["gtk-launch", app.replace(/\.desktop$/, "")]);
    } catch {
      await runNative(["sh", "-c", `exec setsid ${JSON.stringify(app)} >/dev/null 2>&1 &`]);
    }
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

  if (isInputAction(name as never) && !leaseToken) {
    throw new Error("input action refused: no lease token provided");
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
    case "probe": {
      const bin = resolveBinary();
      if (!bin) {
        return {
          requestId: cmd.requestId,
          ok: true,
          payload: {
            agentId: AGENT_ID,
            installed: false,
            agentVersion: "unknown",
            sdkOk: false,
            reason: "computer-use-linux binary not found",
          } satisfies ComputerProbePayload,
        };
      }
      const probeClient = new McpClient([bin, "mcp"]);
      try {
        await probeClient.initialize();
        await probeClient.listTools();
        const payload: ComputerProbePayload = { agentId: AGENT_ID, installed: true, agentVersion: "0.5.0", sdkOk: true };
        return { requestId: cmd.requestId, ok: true, payload };
      } catch (err) {
        return {
          requestId: cmd.requestId,
          ok: true,
          payload: { agentId: AGENT_ID, installed: true, agentVersion: "unknown", sdkOk: false, reason: String(err).slice(0, 200) },
        };
      } finally {
        await probeClient.close();
      }
    }
    case "act": {
      try {
        const payload = await performAction(cmd.action, cmd.lease?.token);
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
      void handle(msg as ComputerCommand).then((result) => writeJsonl(result)).catch((err) => {
        stderr(`handle failed: ${String(err)}`);
      });
    }
  },
  () => process.exit(0),
);
