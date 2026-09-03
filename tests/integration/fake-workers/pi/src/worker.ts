/**
 * Scripted fake agent worker for integration tests. Speaks the LF-JSONL
 * worker protocol v2 from packages/agent-contract and behaves according to
 * directives embedded in the message text:
 *
 *   say: <text>      stream deltas, assistant text, turn.completed
 *   tool             tool.started + native activity + tool.completed
 *   hang             streams a delta then waits for turn.abort; steering
 *                    during hang returns an error (failure path is testable)
 *   steer-echo       long atomic tool action; message.steer is acknowledged
 *                    immediately, applied after tool.completed, then completes
 *   attachment-echo validates the daemon's managed worker paths and echoes metadata/content
 *
 * Stays alive until stdin closes (daemon lifecycle contract).
 */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  AGENT_CAPABILITY_INVENTORY_VERSION,
  type AgentCapabilityInventory,
  type ProbePayload,
} from "../../../../../packages/agent-contract/src/agent-protocol.ts";
import { readJsonl } from "../../../../../packages/agent-contract/src/framing.ts";

const write = (msg: unknown): void => {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
};

write({ type: "hello", v: 1, worker: "agent:pi", pid: process.pid });
const heartbeat = setInterval(() => write({ type: "heartbeat" }), 5_000);
heartbeat.unref?.();
const workerHome = dataDir();
if (workerHome !== undefined) {
  appendFileSync(path.join(workerHome, "fake-agent-worker-starts.log"), `${process.pid}\n`);
}

const nativeSessionLog = workerHome === undefined
  ? undefined
  : path.join(workerHome, "fake-agent-native-sessions.log");
const nativeSessions = new Set(
  nativeSessionLog !== undefined && existsSync(nativeSessionLog)
    ? readFileSync(nativeSessionLog, "utf8").split("\n").filter((id) => id.length > 0)
    : [],
);

function rememberNativeSession(nativeSessionId: string): void {
  if (nativeSessions.has(nativeSessionId)) return;
  nativeSessions.add(nativeSessionId);
  if (nativeSessionLog !== undefined) appendFileSync(nativeSessionLog, `${nativeSessionId}\n`);
}

const AGENT_VERSION = "fake-pi-1";

interface FakeProbeControl {
  ok?: unknown;
  image?: unknown;
  fakeProbe?: "invalid" | "offline" | "obsolete-session-deletion";
  fakeCapabilities?: {
    steering?: boolean;
    abort?: boolean;
    nativeThreadActions?: Array<"resume" | "history" | "close" | "rename" | "delete" | "fork" | "compact">;
    nativeEventFamilies?: string[];
  };
  fakeAbortBehavior?: "fail_once" | "ignore_once";
  fakeAbortReleaseFile?: string;
}

function dataDir(): string | undefined {
  return process.env.OMARCHY_BOT_HOME;
}

function probeControl(): FakeProbeControl {
  try {
    const root = dataDir();
    if (root === undefined) return {};
    return JSON.parse(readFileSync(path.join(root, "conformance", `pi-${AGENT_VERSION}.json`), "utf8")) as FakeProbeControl;
  } catch {
    return {};
  }
}

function capabilitiesFor(control: FakeProbeControl): AgentCapabilityInventory {
  return {
    version: AGENT_CAPABILITY_INVENTORY_VERSION,
    steering: control.fakeCapabilities?.steering ?? true,
    abort: control.fakeCapabilities?.abort ?? true,
    nativeThreadActions: control.fakeCapabilities?.nativeThreadActions ?? ["resume", "history", "close"],
    attachments: { text: true, image: control.ok === true && control.image === "verified" },
    nativeEventFamilies: control.fakeCapabilities?.nativeEventFamilies ?? ["message", "tool", "turn", "error", "native"],
  };
}

let currentCapabilities = capabilitiesFor(probeControl());

function recordCommand(command: "message.steer" | "turn.abort"): void {
  const root = dataDir();
  if (root !== undefined) appendFileSync(path.join(root, "fake-worker-commands.log"), `${command}\n`);
}

let sessionCounter = nativeSessions.size;
interface FakeAttachment {
  id: string;
  name: string;
  path: string;
  mediaType: string;
}

interface FakeSession {
  aborted: boolean;
  streaming: boolean;
  directive?: string | undefined;
  steerReply?: ((text: string) => void) | undefined;
}
const sessions = new Map<string, FakeSession>();
const failedOnce = new Set<string>();
const failedAbortOnce = new Set<string>();
const ignoredAbortOnce = new Set<string>();

const respond = (requestId: string, payload: unknown): void => {
  write({ requestId, ok: true, payload });
};
const respondError = (requestId: string, error: string): void => {
  write({ requestId, ok: false, error });
};

readJsonl(Bun.stdin.stream(), (raw) => {
  const msg = raw as Record<string, unknown> & { type: string; requestId?: string };
  switch (msg.type) {
    case "probe": {
      const control = probeControl();
      if (control.fakeProbe === "offline") {
        respondError(msg.requestId!, "fake probe offline");
        break;
      }
      if (control.fakeProbe === "invalid") {
        respond(msg.requestId!, {
          agentId: "pi",
          installed: true,
          sdkOk: true,
          agentVersion: AGENT_VERSION,
          capabilities: { version: 999 },
        });
        break;
      }
      if (control.fakeProbe === "obsolete-session-deletion") {
        respond(msg.requestId!, {
          agentId: "pi",
          installed: true,
          sdkOk: true,
          agentVersion: AGENT_VERSION,
          capabilities: { ...capabilitiesFor(control), sessionDeletion: true },
        });
        break;
      }
      currentCapabilities = capabilitiesFor(control);
      respond(msg.requestId!, {
        agentId: "pi",
        installed: true,
        sdkOk: true,
        agentVersion: AGENT_VERSION,
        capabilities: currentCapabilities,
      } satisfies ProbePayload);
      break;
    }
    case "session.open": {
      const id = `s${++sessionCounter}`;
      const nativeSessionId = `fake://${id}`;
      sessions.set(id, { aborted: false, streaming: false });
      rememberNativeSession(nativeSessionId);
      respond(msg.requestId!, { sessionId: id, nativeSessionId });
      break;
    }
    case "session.resume": {
      const nativeSessionId = msg.nativeSessionId;
      if (typeof nativeSessionId !== "string" || !nativeSessions.has(nativeSessionId)) {
        respondError(msg.requestId!, `native session not found: ${String(nativeSessionId)}`);
        break;
      }
      const id = `s${++sessionCounter}`;
      sessions.set(id, { aborted: false, streaming: false });
      respond(msg.requestId!, { sessionId: id, nativeSessionId });
      break;
    }
    case "message.send": {
      const command = msg as unknown as {
        sessionId: string;
        turnId: string;
        message: { text: string; attachments?: FakeAttachment[] };
      };
      const { sessionId, message } = command;
      const text = message.text;
      const s = sessions.get(sessionId)!;
      s.aborted = false;
      s.directive = undefined;
      s.steerReply = undefined;
      void (async () => {
        if (text === "attachment-echo") {
          const summaries = await Promise.all((message.attachments ?? []).map(async (attachment) => {
            const file = Bun.file(attachment.path);
            const content = attachment.mediaType === "text/plain" || attachment.mediaType === "application/json"
              ? await file.text()
              : `${file.size} bytes`;
            return `${attachment.id}|${attachment.name}|${attachment.mediaType}|${content}`;
          }));
          write({ type: "event", event: { type: "message.delta", sessionId, text: summaries.join("\n") } });
          write({ type: "event", event: { type: "turn.completed", sessionId, usage: { tokens: 1 } } });
          respond(msg.requestId!, { accepted: true });
          return;
        }
        if (text.startsWith("say:")) {
          const said = text.slice(4).trim();
          write({ type: "event", event: { type: "message.delta", sessionId, text: said.slice(0, 3) } });
          await Bun.sleep(350);
          write({ type: "event", event: { type: "message.delta", sessionId, text: said.slice(3) } });
          await Bun.sleep(350);
          write({ type: "event", event: { type: "turn.completed", sessionId, usage: { tokens: 1 } } });
          respond(msg.requestId!, { accepted: true });
          return;
        }
        if (text === "undeclared-events") {
          write({ type: "event", event: { type: "tool.started", sessionId, id: "undeclared-tool", name: "secret-tool", input: { token: "must-not-leak" } } });
          write({
            type: "event",
            event: {
              type: "native",
              sessionId,
              agentId: "pi",
              capability: "fake.secret-progress",
              payload: { token: "must-not-leak" },
              sensitivity: "secret",
            },
          });
          write({ type: "event", event: { type: "message.delta", sessionId, text: "declared message" } });
          write({ type: "event", event: { type: "turn.completed", sessionId } });
          respond(msg.requestId!, { accepted: true });
          return;
        }
        if (text.startsWith("tool")) {
          write({ type: "event", event: { type: "tool.started", sessionId, id: "t1", name: "bash", input: { command: "echo fake" } } });
          write({
            type: "event",
            event: {
              type: "native",
              sessionId,
              agentId: "pi",
              capability: "fake.progress",
              payload: { stage: "tool-running" },
              sensitivity: "public",
            },
          });
          write({ type: "event", event: { type: "tool.completed", sessionId, id: "t1", output: "fake output", isError: false } });
          write({ type: "event", event: { type: "message.delta", sessionId, text: "tool finished" } });
          await Bun.sleep(150);
          write({ type: "event", event: { type: "turn.completed", sessionId } });
          respond(msg.requestId!, { accepted: true });
          return;
        }
        if (text === "fail-once") {
          if (!failedOnce.has(text)) {
            failedOnce.add(text);
            write({ type: "event", event: { type: "error", sessionId, message: "fake failure", retryable: true } });
          } else {
            write({ type: "event", event: { type: "message.delta", sessionId, text: "recovered" } });
            write({ type: "event", event: { type: "turn.completed", sessionId } });
          }
          respond(msg.requestId!, { accepted: true });
          return;
        }
        if (text === "timeout-failure") {
          write({ type: "event", event: { type: "error", sessionId, message: "timed out after 30s", retryable: true } });
          respond(msg.requestId!, { accepted: true });
          return;
        }
        if (text === "fail") {
          write({ type: "event", event: { type: "error", sessionId, message: "fake failure", retryable: false } });
          respond(msg.requestId!, { accepted: true });
          return;
        }
        if (text === "hang") {
          s.streaming = true;
          s.directive = "hang";
          write({ type: "event", event: { type: "message.delta", sessionId, text: "hanging…" } });
          // never completes; turn.abort must arrive. steering is unsupported here.
          respond(msg.requestId!, { accepted: true });
          return;
        }
        if (text === "steer-echo") {
          s.streaming = true;
          s.directive = "steer-echo";
          write({
            type: "event",
            event: {
              type: "tool.started",
              sessionId,
              id: "steer-boundary",
              name: "fake-atomic-action",
              input: { boundary: "after-steer-queued" },
            },
          });
          // The worker can receive a steer while this atomic action is active.
          // Resolving is queued as a microtask, so message.steer is acknowledged
          // before the action completes at its safe boundary.
          const steered = await new Promise<string>((resolve) => {
            s.steerReply = resolve;
          });
          if (s.aborted) return;
          write({
            type: "event",
            event: {
              type: "tool.completed",
              sessionId,
              id: "steer-boundary",
              output: "safe boundary reached",
              isError: false,
            },
          });
          if (s.aborted) return;
          write({ type: "event", event: { type: "message.delta", sessionId, text: `steered: ${steered}` } });
          write({ type: "event", event: { type: "turn.completed", sessionId } });
          s.streaming = false;
          s.directive = undefined;
          s.steerReply = undefined;
          respond(msg.requestId!, { accepted: true });
          return;
        }
        write({ type: "event", event: { type: "turn.completed", sessionId } });
        respond(msg.requestId!, { accepted: true });
      })();
      break;
    }
    case "message.steer": {
      recordCommand("message.steer");
      const { sessionId, text } = msg as unknown as { sessionId: string; text: string };
      const s = sessions.get(sessionId);
      if (!s || !s.streaming) {
        respondError(msg.requestId!, "cannot steer: session is not streaming");
        break;
      }
      if (s.directive === "hang") {
        respondError(msg.requestId!, "fake hang is not steerable");
        break;
      }
      if (s.directive !== "steer-echo" || !s.steerReply) {
        respondError(msg.requestId!, "fake session has no steering boundary");
        break;
      }
      s.steerReply(text);
      respond(msg.requestId!, { steered: true });
      break;
    }
    case "turn.abort": {
      recordCommand("turn.abort");
      const { sessionId } = msg as unknown as { sessionId: string };
      const control = probeControl();
      if (control.fakeAbortBehavior === "fail_once" && !failedAbortOnce.has(sessionId)) {
        failedAbortOnce.add(sessionId);
        respondError(msg.requestId!, "simulated turn abort failure");
        break;
      }
      if (control.fakeAbortBehavior === "ignore_once" && !ignoredAbortOnce.has(sessionId)) {
        ignoredAbortOnce.add(sessionId);
        respond(msg.requestId!, { aborted: true });
        break;
      }

      const cancel = (): void => {
        const s = sessions.get(sessionId);
        if (!s?.streaming) return;
        s.aborted = true;
        s.streaming = false;
        s.steerReply?.("");
        s.steerReply = undefined;
        s.directive = undefined;
        write({ type: "event", event: { type: "turn.cancelled", sessionId } });
      };
      const root = dataDir();
      if (
        root !== undefined
        && typeof control.fakeAbortReleaseFile === "string"
        && control.fakeAbortReleaseFile.length > 0
      ) {
        respond(msg.requestId!, { aborted: true });
        void (async () => {
          const releasePath = path.join(root, control.fakeAbortReleaseFile!);
          while (!existsSync(releasePath)) await Bun.sleep(10);
          cancel();
        })();
        break;
      }
      cancel();
      respond(msg.requestId!, { aborted: true });
      break;
    }
    case "session.history":
      respond(msg.requestId!, {
        messages: [
          { role: "user", text: "history-user" },
          { role: "assistant", text: "history-assistant" },
        ],
      });
      break;
    case "session.close":
      respond(msg.requestId!, {});
      break;
    default:
      if (msg.requestId) respondError(msg.requestId, `unknown command ${msg.type}`);
  }
});
