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
 *   computer:<action> invokes the daemon-owned Bot Screen tool bridge
 *
 * Stays alive until stdin closes (daemon lifecycle contract).
 */
import { appendFileSync, readFileSync } from "node:fs";
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

const AGENT_VERSION = "fake-pi-1";

interface FakeProbeControl {
  ok?: unknown;
  image?: unknown;
  fakeProbe?: "invalid" | "offline";
  fakeCapabilities?: {
    steering?: boolean;
    abort?: boolean;
    sessionDeletion?: boolean;
    nativeThreadActions?: Array<"resume" | "history" | "close" | "rename" | "delete" | "fork" | "compact">;
    nativeEventFamilies?: string[];
  };
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
    sessionDeletion: control.fakeCapabilities?.sessionDeletion ?? true,
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

let sessionCounter = 0;
interface FakeAttachment {
  id: string;
  name: string;
  path: string;
  mediaType: string;
}

interface ComputerTurnContext {
  botId: string;
  turnId: string;
  workerSessionId: string;
  surfaceId: string;
}

interface FakeSession {
  aborted: boolean;
  streaming: boolean;
  directive?: string | undefined;
  computerRequestId?: string;
  steerReply?: ((text: string) => void) | undefined;
}
const sessions = new Map<string, FakeSession>();

const respond = (requestId: string, payload: unknown): void => {
  write({ requestId, ok: true, payload });
};
const respondError = (requestId: string, error: string): void => {
  write({ requestId, ok: false, error });
};

const computerRequests = new Map<string, {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
}>();

async function requestComputer(
  context: ComputerTurnContext,
  toolCallId: string,
  action: { name: string; args: Record<string, unknown> },
  onRequest: (requestId: string) => void,
): Promise<unknown> {
  const requestId = crypto.randomUUID();
  onRequest(requestId);
  const pending = Promise.withResolvers<unknown>();
  computerRequests.set(requestId, { resolve: pending.resolve, reject: pending.reject });
  write({
    type: "computer.request",
    requestId,
    context: { ...context, toolCallId },
    action,
  });
  return pending.promise;
}

function cancelComputerRequest(requestId: string): void {
  const pending = computerRequests.get(requestId);
  if (pending === undefined) return;
  computerRequests.delete(requestId);
  write({ type: "computer.cancel", requestId });
  pending.reject(new Error("computer tool call cancelled"));
}

function computerTurnContext(value: unknown): ComputerTurnContext | undefined {
  if (value === null || typeof value !== "object") return undefined;
  if (
    !("botId" in value)
    || !("turnId" in value)
    || !("workerSessionId" in value)
    || !("surfaceId" in value)
    || typeof value.botId !== "string"
    || typeof value.turnId !== "string"
    || typeof value.workerSessionId !== "string"
    || typeof value.surfaceId !== "string"
  ) {
    return undefined;
  }
  return {
    botId: value.botId,
    turnId: value.turnId,
    workerSessionId: value.workerSessionId,
    surfaceId: value.surfaceId,
  };
}

readJsonl(Bun.stdin.stream(), (raw) => {
  const msg = raw as Record<string, unknown> & { type: string; requestId?: string };
  switch (msg.type) {
    case "computer.result": {
      const pending = msg.requestId === undefined ? undefined : computerRequests.get(msg.requestId);
      if (pending === undefined) break;
      computerRequests.delete(msg.requestId!);
      if (msg.ok === true) pending.resolve(msg.payload);
      else pending.reject(new Error(String(msg.error)));
      break;
    }
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
      sessions.set(id, { aborted: false, streaming: false });
      respond(msg.requestId!, { sessionId: id, nativeSessionId: `fake://${id}` });
      break;
    }
    case "session.resume": {
      // A resumed native session keeps its native id — like real pi sessions.
      const resumed = (msg as unknown as { nativeSessionId: string }).nativeSessionId;
      const id = `s${++sessionCounter}`;
      sessions.set(id, { aborted: false, streaming: false });
      respond(msg.requestId!, { sessionId: id, nativeSessionId: resumed });
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
        if (text.startsWith("computer:")) {
          const binding = computerTurnContext(msg.computer);
          const parts = text.split(":");
          const toolCallId = `computer-${command.turnId}`;
          write({
            type: "event",
            event: {
              type: "tool.started",
              sessionId,
              id: toolCallId,
              name: "computer",
              input: { action: parts[1] },
            },
          });
          if (parts[1] === "crash-agent") process.exit(17);
          try {
            if (binding === undefined) throw new Error("computer tool binding missing");
            const context = { ...binding };
            if (parts[2] === "mismatch") context.surfaceId = parts[3] ?? "";
            if (parts[2] === "stale") context.turnId = `stale-${context.turnId}`;
            if (parts[2] === "wrong-bot") context.botId = `wrong-${context.botId}`;
            if (parts[2] === "wrong-session") {
              context.workerSessionId = `wrong-${context.workerSessionId}`;
            }
            const requestToolCallId = parts[2] === "missing-tool-call"
              ? ""
              : toolCallId;
            const action = parts[1] === "click"
              ? { name: "click", args: { marker: parts[2] ?? "" } }
              : {
                  name: "observe",
                  args: parts[2] === "fail" ? { fail: true } : {},
                };
            s.streaming = true;
            const result = await requestComputer(
              context,
              requestToolCallId,
              action,
              (requestId) => {
                s.computerRequestId = requestId;
              },
            );
            write({
              type: "event",
              event: {
                type: "tool.completed",
                sessionId,
                id: toolCallId,
                output: result,
                isError: false,
              },
            });
            write({
              type: "event",
              event: {
                type: "message.delta",
                sessionId,
                text: JSON.stringify(result),
              },
            });
            write({ type: "event", event: { type: "turn.completed", sessionId } });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            write({
              type: "event",
              event: {
                type: "tool.completed",
                sessionId,
                id: toolCallId,
                output: message,
                isError: true,
              },
            });
            write({
              type: "event",
              event: { type: "error", sessionId, message, retryable: false },
            });
          } finally {
            s.streaming = false;
            delete s.computerRequestId;
          }
          respond(msg.requestId!, { accepted: true });
          return;
        }
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
      if (text === "crash-agent") process.exit(17);
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
      const s = sessions.get(sessionId);
      if (s?.streaming) {
        s.aborted = true;
        if (s.computerRequestId !== undefined) {
          cancelComputerRequest(s.computerRequestId);
          delete s.computerRequestId;
        }
        s.streaming = false;
        s.steerReply?.("");
        s.steerReply = undefined;
        s.directive = undefined;
        write({ type: "event", event: { type: "turn.cancelled", sessionId } });
      }
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
    case "session.delete": {
      const nativeSessionId = typeof msg.nativeSessionId === "string" ? msg.nativeSessionId : "";
      if (nativeSessionId.includes("fail-delete")) {
        respondError(msg.requestId!, `native session deletion failed for ${nativeSessionId}`);
      } else {
        respond(msg.requestId!, { deleted: true });
      }
      break;
    }
    default:
      if (msg.requestId) respondError(msg.requestId, `unknown command ${msg.type}`);
  }
});
