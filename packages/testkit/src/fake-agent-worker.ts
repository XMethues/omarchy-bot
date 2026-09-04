// Deterministic agent worker for orchestration tests.
// Scenarios (argv): echo (default), crash, hang, malformed, refuse
import { AGENT_CAPABILITY_INVENTORY_VERSION, PROTOCOL_VERSION, readJsonl, writeJsonl, stderr } from "@omarchy-bot/agent-contract";
import type { AgentCommand, ProbePayload, WorkerOutbound } from "@omarchy-bot/agent-contract";

const scenario = (process.argv[2] ?? "echo").replace(/^--scenario=/, "");
let sessionCounter = 0;
const sessions = new Map<string, { nativeSessionId: string; turnActive: boolean; aborted: boolean }>();
let msgCounter = 0;
let responseCounter = 0;

const out = (m: WorkerOutbound) => writeJsonl(m);
const result = (requestId: string, ok: boolean, payload: unknown) =>
  out(ok ? { requestId, ok: true, payload } : { requestId, ok: false, error: String(payload) });

out({ type: "hello", v: PROTOCOL_VERSION, worker: `fake-agent-${scenario}`, pid: process.pid });
const heartbeat = setInterval(() => out({ type: "heartbeat" }), 10_000);
heartbeat.unref?.();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Stream a scripted turn with ordered Response Blocks and Tool Calls. */
async function runTurn(sessionId: string, turnId: string, text: string): Promise<void> {
  const s = sessions.get(sessionId)!;
  s.turnActive = true;
  s.aborted = false;
  try {
    const firstBlockId = `response-${++responseCounter}`;
    out({
      type: "event",
      event: { type: "response.start", sessionId, blockId: firstBlockId, startedAt: new Date().toISOString() },
    });
    for (const chunk of ["Hello ", "from ", "fake ", "agent."]) {
      if (s.aborted) throw new Error("aborted");
      out({ type: "event", event: { type: "response.delta", sessionId, blockId: firstBlockId, text: chunk } });
      await sleep(20);
    }
    out({
      type: "event",
      event: { type: "response.end", sessionId, blockId: firstBlockId, completedAt: new Date().toISOString() },
    });
    const toolId = `tool-${++msgCounter}`;
    out({ type: "event", event: { type: "tool.started", sessionId, id: toolId, name: "read_file", status: "running", target: "/tmp/fake.txt" } });
    await sleep(20);
    out({ type: "event", event: { type: "tool.completed", sessionId, id: toolId, name: "read_file", status: "completed", target: "/tmp/fake.txt", durationMs: 20 } });

    if (text.includes("!write")) {
      const wId = `tool-${++msgCounter}`;
      out({ type: "event", event: { type: "tool.started", sessionId, id: wId, name: "write_file", status: "running", target: "/tmp/fake.txt" } });
      await sleep(20);
      out({ type: "event", event: { type: "tool.completed", sessionId, id: wId, name: "write_file", status: "completed", target: "/tmp/fake.txt", durationMs: 20, additions: 1, deletions: 0 } });
    }
    if (s.aborted) throw new Error("aborted");
    const finalBlockId = `response-${++responseCounter}`;
    out({
      type: "event",
      event: { type: "response.start", sessionId, blockId: finalBlockId, startedAt: new Date().toISOString() },
    });
    out({ type: "event", event: { type: "response.delta", sessionId, blockId: finalBlockId, text: "Done." } });
    out({
      type: "event",
      event: { type: "response.end", sessionId, blockId: finalBlockId, completedAt: new Date().toISOString() },
    });
    out({ type: "event", event: { type: "turn.completed", sessionId, usage: { turnId, tokens: 42 } } });
  } catch (err) {
    if (String((err as Error).message).includes("aborted")) {
      out({ type: "event", event: { type: "turn.cancelled", sessionId } });
    } else {
      out({ type: "event", event: { type: "error", sessionId, message: String((err as Error).message), retryable: false } });
    }
  } finally {
    s.turnActive = false;
  }
}

readJsonl(Bun.stdin.stream(), async (raw) => {
  if (scenario === "malformed") return; // never parses; daemon must reject clearly
  if (scenario === "refuse") {
    out({ type: "event", event: { type: "error", message: "unknown command", retryable: false } });
    return;
  }
  const cmd = raw as AgentCommand;
  switch (cmd.type) {
    case "probe":
      result(cmd.requestId, true, {
        agentId: "fake",
        installed: true,
        agentVersion: "fake-1.0.0",
        sdkOk: true,
        capabilities: {
          version: AGENT_CAPABILITY_INVENTORY_VERSION,
          steering: true,
          abort: true,
          nativeThreadActions: ["resume", "history", "close"],
          thinking: { supported: true, streaming: true },
          attachments: { text: false, image: false },
          nativeEventFamilies: [],
        },
      } satisfies ProbePayload);
      break;
    case "session.open":
    case "session.resume": {
      const id = `s-${++sessionCounter}`;
      sessions.set(id, { nativeSessionId: cmd.type === "session.resume" ? cmd.nativeSessionId : `native-${id}`, turnActive: false, aborted: false });
      result(cmd.requestId, true, { sessionId: id, nativeSessionId: sessions.get(id)!.nativeSessionId });
      break;
    }
    case "message.send": {
      const s = sessions.get(cmd.sessionId);
      if (!s) return result(cmd.requestId, false, "unknown session");
      result(cmd.requestId, true, { accepted: true });
      if (scenario === "crash") process.exit(9);
      if (scenario === "hang") return; // no terminal event; daemon timeout must fire
      void runTurn(cmd.sessionId, cmd.turnId, cmd.message.text);
      break;
    }
    case "message.steer": {
      const s = sessions.get(cmd.sessionId);
      if (!s || !s.turnActive) return result(cmd.requestId, false, "cannot steer: session is not streaming");
      result(cmd.requestId, true, { steered: true });
      break;
    }
    case "turn.abort": {
      const s = sessions.get(cmd.sessionId);
      if (s) s.aborted = true;
      result(cmd.requestId, true, { done: true });
      break;
    }
    case "session.history":
      result(cmd.requestId, true, { messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "Hello from fake agent." }] });
      break;
    case "session.close":
      sessions.delete(cmd.sessionId);
      result(cmd.requestId, true, { done: true });
      break;
    default: {
      const unknown = cmd as { requestId?: string };
      result(unknown.requestId ?? "unknown", false, "unsupported command");
    }
  }
}, () => {
  stderr("stdin closed; exiting");
  clearInterval(heartbeat);
  process.exit(0);
});
