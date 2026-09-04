#!/usr/bin/env bun
/**
 * Real Pi worker (agents-integration.md §4): LF-JSONL over stdio, `hello` first.
 * Each omarchy-bot thread maps to one native Pi AgentSession with its own
 * session file; normalized events preserve Pi's native runtime behavior.
 */
import os from "node:os";
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  HEARTBEAT_MS,
  PROTOCOL_VERSION,
  readJsonl,
  writeJsonl,
  AGENT_CAPABILITY_INVENTORY_VERSION,
  type AgentCommand,
  type AgentComputerToolContext,
  type AgentComputerToolOutput,
  type AgentComputerToolResult,
  type AgentComputerTurnContext,
  type AgentEvent,
  type AgentResult,
  type HistoryPayload,
  type ProbePayload,
  type SessionOpenedPayload,
} from "@omarchy-bot/agent-contract";
import { isSurfaceId, type ComputerAction } from "@omarchy-bot/domain";
import { normalizeSessionEvent, toNormalizedMessages, type SessionRuntime } from "./normalize.ts";
import { sdkVersion } from "./sdk-version.ts";
import { createComputerTool } from "./computer-tool.ts";
import { thinkingCapabilityForProbe } from "./thinking-capability.ts";

const AGENT_ID = "pi";

interface SessionEntry extends SessionRuntime {
  session: AgentSession;
  botId: string;
  computer?: AgentComputerTurnContext;
}

const sessions = new Map<string, SessionEntry>();

let modelRuntimePromise: Promise<ModelRuntime> | undefined;
function getModelRuntime(): Promise<ModelRuntime> {
  modelRuntimePromise ??= ModelRuntime.create();
  return modelRuntimePromise;
}

interface PendingComputerRequest {
  resolve: (output: AgentComputerToolOutput) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
}

const computerRequests = new Map<string, PendingComputerRequest>();

function requestComputer(
  context: AgentComputerToolContext,
  action: ComputerAction,
  signal: AbortSignal | undefined,
): Promise<AgentComputerToolOutput> {
  signal?.throwIfAborted();
  const requestId = crypto.randomUUID();
  return new Promise<AgentComputerToolOutput>((resolve, reject) => {
    const pending: PendingComputerRequest = { resolve, reject };
    if (signal !== undefined) {
      pending.signal = signal;
      pending.onAbort = () => {
        if (computerRequests.delete(requestId)) {
          writeJsonl({ type: "computer.cancel", requestId });
          reject(new Error("computer tool call cancelled"));
        }
      };
      signal.addEventListener("abort", pending.onAbort, { once: true });
    }
    computerRequests.set(requestId, pending);
    writeJsonl({ type: "computer.request", requestId, context, action });
  });
}

function handleComputerResult(result: AgentComputerToolResult): void {
  const pending = computerRequests.get(result.requestId);
  if (pending === undefined) return;
  computerRequests.delete(result.requestId);
  if (pending.signal !== undefined && pending.onAbort !== undefined) {
    pending.signal.removeEventListener("abort", pending.onAbort);
  }
  if (result.ok === true) pending.resolve(result.payload);
  else pending.reject(new Error(result.error));
}

let authAvailable: boolean | undefined;
async function hasAuthenticatedModel(): Promise<boolean> {
  if (authAvailable !== undefined) return authAvailable;
  try {
    const rt = await getModelRuntime();
    const available = await rt.getAvailable();
    authAvailable = available.length > 0;
  } catch {
    authAvailable = false;
  }
  return authAvailable;
}

// Probe has no Bot-scoped model override. Resolve Pi's native default exactly
// as session.open does, using an in-memory native session to avoid persistence.
async function resolveDefaultModel(): Promise<AgentSession["model"]> {
  const cwd = process.cwd();
  const { session } = await createAgentSession({
    cwd,
    agentDir: getAgentDir(),
    sessionManager: SessionManager.inMemory(cwd),
    modelRuntime: await getModelRuntime(),
  });
  try {
    return session.model;
  } finally {
    session.dispose();
  }
}

async function hasVerifiedImageInput(agentVersion: string): Promise<boolean> {
  const dataDir = process.env.OMARCHY_BOT_HOME ?? path.join(os.homedir(), ".local/share/omarchy-bot");
  try {
    const record = await Bun.file(path.join(dataDir, "conformance", `${AGENT_ID}-${agentVersion}.json`)).json() as {
      ok?: unknown;
      image?: unknown;
    };
    return record.ok === true && record.image === "verified";
  } catch {
    return false;
  }
}

function emit(event: AgentEvent): void {
  writeJsonl({ type: "event", event });
}

function reply(result: AgentResult): void {
  writeJsonl(result);
}

function sessionEntry(sessionId: string): SessionEntry {
  const entry = sessions.get(sessionId);
  if (!entry) throw new Error(`unknown session ${sessionId}`);
  return entry;
}

function attachSubscription(entry: SessionEntry): void {
  const { session, sessionId } = entry;
  session.subscribe((ev) => {
    if (!sessions.has(sessionId)) return;
    for (const event of normalizeSessionEvent(ev, sessionId, entry)) emit(event);
    if (ev.type === "agent_settled" && entry.running && !entry.finished) {
      entry.running = false;
      entry.finished = true;
      delete entry.computer;
      if (entry.aborted) emit({ type: "turn.cancelled", sessionId });
      else emit({ type: "turn.completed", sessionId });
    }
  });
}

async function openSession(
  requestId: string,
  options: { botId: string; cwd: string; instructions: string; model?: string },
  existing?: SessionEntry | undefined,
): Promise<void> {
  let newEntry: SessionEntry | undefined;
  const computerTool = createComputerTool(
    () => newEntry?.computer,
    { request: requestComputer },
  );
  const sessionId = `s_${crypto.randomUUID()}`;

  // Bot Job/Instructions are injected into Pi's native system prompt.
  const loader = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: getAgentDir(),
    ...(options.instructions.trim() !== ""
      ? { appendSystemPrompt: [`[omarchy-bot] Your Job/Instructions for this Bot:\n\n${options.instructions.trim()}`] }
      : {}),
  });
  await loader.reload();

  // Model resolution: "provider/model" or a bare model id searched across providers.
  const rt = await getModelRuntime();
  let model: ReturnType<typeof rt.getModel> | undefined;
  if (options.model !== undefined) {
    const [provider, id] = options.model.includes("/") ? [options.model.slice(0, options.model.indexOf("/")), options.model.slice(options.model.indexOf("/") + 1)] : [undefined, options.model];
    model = provider ? rt.getModel(provider, id) : rt.getModels().find((m) => m.id === id);
    if (!model) throw new Error(`model not found: ${options.model}`);
  }

  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir: getAgentDir(),
    sessionManager: existing ? SessionManager.open(existing.nativeSessionId) : SessionManager.create(options.cwd),
    modelRuntime: rt,
    ...(model !== undefined ? { model } : {}),
    resourceLoader: loader,
    customTools: [computerTool],
  });

  const nativeSessionId = session.sessionFile ?? `mem:${sessionId}`;
  newEntry = {
    sessionId,
    botId: options.botId,
    nativeSessionId,
    session,
    running: false,
    finished: false,
    aborted: false,
    responseBlockIds: new Map(),
    thinkingBlocks: new Map(),
    toolCalls: new Map(),
  };
  sessions.set(sessionId, newEntry);
  attachSubscription(newEntry);
  reply({
    requestId,
    ok: true,
    payload: { sessionId, nativeSessionId } satisfies SessionOpenedPayload,
  });
}

async function handleMessage(cmd: AgentCommand): Promise<void> {
  try {
    switch (cmd.type) {
      case "probe": {
        const sdkOk = true; // reaching here means the SDK imported and ran
        const authed = await hasAuthenticatedModel();
        const agentVersion = sdkVersion();
        const thinking = await thinkingCapabilityForProbe(authed, resolveDefaultModel);
        const payload: ProbePayload = {
          agentId: AGENT_ID,
          installed: sdkOk,
          agentVersion,
          sdkOk,
          capabilities: {
            version: AGENT_CAPABILITY_INVENTORY_VERSION,
            steering: true,
            abort: true,
            nativeThreadActions: ["resume", "history", "close"],
            thinking,
            attachments: {
              text: true,
              image: await hasVerifiedImageInput(agentVersion),
              maxTextBytes: 64 * 1024,
            },
            nativeEventFamilies: [],
          },
          ...(authed ? {} : { reason: "no authenticated model provider (run `pi` once or fill ~/.pi/agent/auth.json)" }),
        };
        reply({ requestId: cmd.requestId, ok: true, payload });
        return;
      }
      case "session.open":
        await openSession(cmd.requestId, {
          botId: cmd.botId,
          cwd: cmd.options.cwd,
          instructions: cmd.options.instructions,
          ...(cmd.options.model !== undefined ? { model: cmd.options.model } : {}),
        });
        return;
      case "session.resume": {
        // Validate the native session file before rebuilding state on it.
        const f = Bun.file(cmd.nativeSessionId);
        if (!(await f.exists())) throw new Error(`native session not found: ${cmd.nativeSessionId}`);
        const holder = { nativeSessionId: cmd.nativeSessionId } as SessionEntry;
        await openSession(cmd.requestId, {
          botId: cmd.botId,
          cwd: cmd.options.cwd,
          instructions: cmd.options.instructions,
          ...(cmd.options.model !== undefined ? { model: cmd.options.model } : {}),
        }, holder);
        return;
      }
      case "message.send": {
        // The daemon only sends on idle sessions; mid-turn user input arrives
        // as message.steer. A busy session is therefore an error, never a crash.
        const entry = sessionEntry(cmd.sessionId);
        if (entry.session.isStreaming) throw new Error("session busy: a turn is already running");
        if (
          cmd.computer === undefined
          || cmd.computer.botId !== entry.botId
          || cmd.computer.workerSessionId !== cmd.sessionId
          || cmd.computer.turnId !== cmd.turnId
          || !isSurfaceId(cmd.computer.surfaceId)
        ) {
          throw new Error("Bot Screen binding is required and must match the Agent command");
        }
        const images =
          cmd.message.attachments && cmd.message.attachments.length > 0
            ? await Promise.all(
                cmd.message.attachments
                  .filter((a) => a.mediaType.startsWith("image/"))
                  .map(async (a) => ({
                    type: "image" as const,
                    data: Buffer.from(await Bun.file(a.path).arrayBuffer()).toString("base64"),
                    mimeType: a.mediaType,
                  })),
              )
            : undefined;
        // Text attachments are inlined into the prompt (bounded).
        let promptText = cmd.message.text;
        for (const a of cmd.message.attachments ?? []) {
          if (!a.mediaType.startsWith("text/") && a.mediaType !== "application/json") continue;
          const stat = await Bun.file(a.path).stat();
          if (stat.size > 64 * 1024) throw new Error(`attachment ${a.name} too large for inline text (${stat.size} bytes)`);
          const content = await Bun.file(a.path).text();
          promptText += `\n\n[attachment ${a.name}]\n${content}\n[/attachment ${a.name}]`;
        }
        entry.computer = cmd.computer;
        entry.running = true;
        entry.finished = false;
        entry.aborted = false;
        void entry.session
          .prompt(promptText, images && images.length > 0 ? { images } : undefined)
          .catch((err: unknown) => {
            entry.running = false;
            entry.finished = true;
            delete entry.computer;
            emit({ type: "error", sessionId: entry.sessionId, message: String(err), retryable: false });
          });
        reply({ requestId: cmd.requestId, ok: true, payload: { accepted: true } });
        return;
      }
      case "message.steer": {
        // Native pi steering queues the redirect for pi's safe boundary between
        // atomic tool calls. It never opens, prompts, or aborts a session.
        const entry = sessionEntry(cmd.sessionId);
        if (!entry.running || entry.finished || !entry.session.isStreaming) {
          throw new Error("cannot steer: session is not streaming");
        }
        await entry.session.steer(cmd.text);
        reply({ requestId: cmd.requestId, ok: true, payload: { steered: true } });
        return;
      }
      case "turn.abort": {
        const entry = sessionEntry(cmd.sessionId);
        if (entry.running && !entry.finished) {
          entry.aborted = true;
          await entry.session.abort();
          // agent_settled may not fire on hard aborts; settle here and guard.
          if (entry.running && !entry.finished) {
            entry.running = false;
            entry.finished = true;
            emit({ type: "turn.cancelled", sessionId: entry.sessionId });
          }
        }
        reply({ requestId: cmd.requestId, ok: true, payload: { aborted: true } });
        return;
      }
      case "session.history": {
        const entry = sessionEntry(cmd.sessionId);
        const payload: HistoryPayload = { messages: toNormalizedMessages(entry.session.messages) };
        reply({ requestId: cmd.requestId, ok: true, payload });
        return;
      }
      case "session.close": {
        const entry = sessionEntry(cmd.sessionId);
        entry.session.dispose();
        sessions.delete(cmd.sessionId);
        reply({ requestId: cmd.requestId, ok: true, payload: { closed: true } });
        return;
      }
      default: {
        const unknown = cmd as { requestId?: string };
        reply({
          requestId: unknown.requestId ?? "unknown",
          ok: false,
          error: "unsupported command",
        });
      }
    }
  } catch (err) {
    const requestId = (cmd as { requestId?: string }).requestId ?? "unknown";
    reply({ requestId, ok: false, error: String(err) });
  }
}

writeJsonl({ type: "hello", v: PROTOCOL_VERSION, worker: `agent:${AGENT_ID}`, pid: process.pid });
setInterval(() => writeJsonl({ type: "heartbeat" }), HEARTBEAT_MS).unref();

await readJsonl(
  Bun.stdin.stream(),
  (msg) => {
    if (msg && typeof msg === "object" && "type" in msg) {
      if (msg.type === "computer.result") {
        handleComputerResult(msg as AgentComputerToolResult);
      } else {
        void handleMessage(msg as AgentCommand);
      }
    }
  },
  () => {
    for (const pending of computerRequests.values()) {
      pending.reject(new Error("daemon connection closed during computer tool call"));
    }
    computerRequests.clear();
    process.exit(0);
  },
);
