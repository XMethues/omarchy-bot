/**
 * Scripted fake agent worker for integration tests. Speaks the LF-JSONL
 * worker protocol from packages/agent-contract and behaves according to
 * directives embedded in the message text:
 *
 *   say: <text>      stream deltas, assistant text, turn.completed
 *   ask              tool.started(bash) + permission.requested, waits for a
 *                    decision, then tool.completed + turn.completed
 *   deny-tool        like ask but only proceeds if the decision is allowed
 *   tool             tool.started + tool.completed (no approval)
 *   hang             streams a delta then waits for turn.abort
 *
 * Stays alive until stdin closes (daemon lifecycle contract).
 */
import { readJsonl } from "../../../../../packages/agent-contract/src/framing.ts";

const write = (msg: unknown): void => {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
};

write({ type: "hello", v: 1, worker: "agent:pi", pid: process.pid });

let sessionCounter = 0;
const sessions = new Map<string, { aborted: boolean; permissionReply?: (allowed: boolean) => void }>();

const respond = (requestId: string, payload: unknown): void => {
  write({ requestId, ok: true, payload });
};

readJsonl(Bun.stdin.stream(), (raw) => {
  const msg = raw as Record<string, unknown> & { type: string; requestId?: string };
  switch (msg.type) {
    case "probe":
      respond(msg.requestId!, { agentId: "pi", installed: true, sdkOk: true, agentVersion: "fake-pi-1" });
      break;
    case "session.open":
    case "session.resume": {
      const id = `s${++sessionCounter}`;
      sessions.set(id, { aborted: false });
      respond(msg.requestId!, { sessionId: id, nativeSessionId: `fake://${id}` });
      break;
    }
    case "message.send": {
      const { sessionId, runId, message } = msg as unknown as { sessionId: string; runId: string; message: { text: string } };
      const text = message.text;
      const s = sessions.get(sessionId)!;
      void (async () => {
        if (text.startsWith("say:")) {
          const said = text.slice(4).trim();
          write({ type: "event", event: { type: "message.delta", sessionId, text: said.slice(0, 3) } });
          write({ type: "event", event: { type: "message.delta", sessionId, text: said.slice(3) } });
          write({ type: "event", event: { type: "turn.completed", sessionId, usage: { tokens: 1 } } });
          respond(msg.requestId!, { accepted: true });
          return;
        }
        if (text.startsWith("tool") || text.startsWith("ask") || text.startsWith("deny-tool")) {
          const needApproval = text.startsWith("ask") || text.startsWith("deny-tool");
          write({ type: "event", event: { type: "tool.started", sessionId, id: "t1", name: "bash", input: { command: "echo fake" } } });
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
          write({ type: "event", event: { type: "turn.completed", sessionId } });
          respond(msg.requestId!, { accepted: true });
          return;
        }
        if (text === "hang") {
          write({ type: "event", event: { type: "message.delta", sessionId, text: "hanging…" } });
          // never completes; turn.abort must arrive
          respond(msg.requestId!, { accepted: true });
          return;
        }
        write({ type: "event", event: { type: "turn.completed", sessionId } });
        respond(msg.requestId!, { accepted: true });
        void runId;
      })();
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
      if (s) {
        write({ type: "event", event: { type: "turn.cancelled", sessionId } });
      }
      respond(msg.requestId!, {});
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
      if (msg.requestId) write({ requestId: msg.requestId, ok: false, error: `unknown command ${msg.type}` });
  }
});
