#!/usr/bin/env bun
/**
 * Real Pi worker (agents-integration.md §4): LF-JSONL over stdio, `hello` first.
 * Each omarchy-bot thread maps to one native pi AgentSession with its own
 * session file; events are normalized. Pi keeps its native approval behavior —
 * NO omarchy-bot permission gate sits on this path (ADR 0003).
 */
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
  type AgentCommand,
  type AgentEvent,
  type AgentResult,
  type HistoryPayload,
  type ProbePayload,
  type SessionOpenedPayload,
} from "@omarchy-bot/agent-contract";
import { normalizeSessionEvent, toNormalizedMessages, type SessionRuntime } from "./normalize.ts";
import { sdkVersion } from "./sdk-version.ts";

const AGENT_ID = "pi";

interface SessionEntry extends SessionRuntime {
  session: AgentSession;
}

const sessions = new Map<string, SessionEntry>();

let modelRuntimePromise: Promise<ModelRuntime> | undefined;
function getModelRuntime(): Promise<ModelRuntime> {
  modelRuntimePromise ??= ModelRuntime.create();
  return modelRuntimePromise;
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
    for (const event of normalizeSessionEvent(ev, sessionId)) emit(event);
    if (ev.type === "agent_settled" && entry.running && !entry.finished) {
      entry.running = false;
      entry.finished = true;
      if (entry.aborted) emit({ type: "turn.cancelled", sessionId });
      else emit({ type: "turn.completed", sessionId });
    }
  });
}

async function openSession(
  requestId: string,
  options: { cwd: string; instructions: string; model?: string },
  existing?: SessionEntry | undefined,
): Promise<void> {
  const sessionId = `s_${crypto.randomUUID()}`;

  // Bot Job/Instructions are injected into the system prompt; pi itself keeps
  // deciding when to ask for approvals.
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
  });

  const nativeSessionId = session.sessionFile ?? `mem:${sessionId}`;
  const newEntry: SessionEntry = {
    sessionId,
    nativeSessionId,
    session,
    running: false,
    finished: false,
    aborted: false,
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
        const payload: ProbePayload = {
          agentId: AGENT_ID,
          installed: sdkOk,
          agentVersion: sdkVersion(),
          sdkOk,
          ...(authed ? {} : { reason: "no authenticated model provider (run `pi` once or fill ~/.pi/agent/auth.json)" }),
        };
        reply({ requestId: cmd.requestId, ok: true, payload });
        return;
      }
      case "session.open":
        await openSession(cmd.requestId, {
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
        entry.running = true;
        entry.finished = false;
        entry.aborted = false;
        void entry.session
          .prompt(promptText, images && images.length > 0 ? { images } : undefined)
          .catch((err: unknown) => {
            entry.running = false;
            entry.finished = true;
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
      case "permission.respond": {
        // Pi's native approvals surface through permission.requested only when
        // the adapter has them; without a gate there is nothing to forward.
        throw new Error("pi does not route omarchy-bot permission decisions");
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
      case "session.delete": {
        // Honest capability answer: pi has no native session deletion.
        reply({ requestId: cmd.requestId, ok: false, error: "pi does not support native session deletion" });
        return;
      }
      default: {
        const never: never = cmd;
        void never;
        reply({ requestId: "unknown", ok: false, error: "unsupported command" });
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
    if (msg && typeof msg === "object" && "type" in msg) void handleMessage(msg as AgentCommand);
  },
  () => process.exit(0),
);
