/**
 * Scripted fake agent worker for integration tests. Speaks the LF-JSONL
 * worker protocol v2 from packages/agent-contract and behaves according to
 * directives embedded in the message text:
 *
 *   say: <text>      stream deltas, assistant text, turn.completed
 *   ask              tool.started(bash) + permission.requested, waits for a
 *                    decision, then tool.completed + turn.completed
 *   deny-tool        like ask but only proceeds if the decision is allowed
 *   tool             tool.started + tool.completed (no approval)
 *   hang             streams a delta then waits for turn.abort; steering
 *                    during hang returns an error (failure path is testable)
 *   steer-echo       long atomic tool action; message.steer is acknowledged
 *                    immediately, applied after tool.completed, then completes
 *   attachment-echo validates the daemon's managed worker paths and echoes metadata/content
 *
 * Stays alive until stdin closes (daemon lifecycle contract).
 */
import { readJsonl } from "../../../../../packages/agent-contract/src/framing.ts";

const write = (msg: unknown): void => {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
};

write({ type: "hello", v: 1, worker: "agent:pi", pid: process.pid });
const heartbeat = setInterval(() => write({ type: "heartbeat" }), 5_000);
heartbeat.unref?.();

let sessionCounter = 0;
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
  permissionReply?: ((allowed: boolean) => void) | undefined;
}
const sessions = new Map<string, FakeSession>();

const respond = (requestId: string, payload: unknown): void => {
  write({ requestId, ok: true, payload });
};
const respondError = (requestId: string, error: string): void => {
  write({ requestId, ok: false, error });
};

readJsonl(Bun.stdin.stream(), (raw) => {
  const msg = raw as Record<string, unknown> & { type: string; requestId?: string };
  switch (msg.type) {
    case "probe":
      respond(msg.requestId!, { agentId: "pi", installed: true, sdkOk: true, agentVersion: "fake-pi-1" });
      break;
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
        if (text.startsWith("tool") || text.startsWith("ask") || text.startsWith("deny-tool")) {
          const needApproval = text.startsWith("ask") || text.startsWith("deny-tool");
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
          if (needApproval) {
            const allowed = await new Promise<boolean>((resolve) => {
              s.permissionReply = (a) => resolve(a);
              write({
                type: "event",
                event: {
                  type: "permission.requested",
                  sessionId,
                  id: "p1",
                  tool: "bash",
                  details: { summary: "fake bash request", command: "echo fake" },
                },
              });
            });
            write({ type: "event", event: { type: "tool.updated", sessionId, id: "t1", output: `decision: ${allowed}` } });
            if (text.startsWith("deny-tool") && !allowed) {
              write({ type: "event", event: { type: "tool.completed", sessionId, id: "t1", output: "denied", isError: false } });
              write({ type: "event", event: { type: "turn.completed", sessionId } });
              respond(msg.requestId!, { accepted: true });
              return;
            }
          }
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
    case "permission.respond": {
      const { sessionId, decision } = msg as unknown as { sessionId: string; decision: { allow: boolean } };
      const s = sessions.get(sessionId);
      s?.permissionReply?.(decision.allow);
      respond(msg.requestId!, {});
      break;
    }
    case "turn.abort": {
      const { sessionId } = msg as unknown as { sessionId: string };
      const s = sessions.get(sessionId);
      if (s?.streaming) {
        s.aborted = true;
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
    case "session.delete":
      respond(msg.requestId!, { deleted: true });
      break;
    default:
      if (msg.requestId) respondError(msg.requestId, `unknown command ${msg.type}`);
  }
});
