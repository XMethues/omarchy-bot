import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { api, apiStatus, makeBot, sendToBot, sendToThread, startDaemon, waitThreadIdle, type Harness } from "./helpers/harness.ts";

interface MessageView {
  id: string;
  seq: number;
  author: { kind: "user" | "bot" | "system" };
  kind: "text" | "tool" | "approval" | "event";
  text?: string;
  payload?: Record<string, unknown>;
}

interface TurnRow {
  id: string;
  status: string;
  worker_session_id: string | null;
  native_session_id: string | null;
  steer_count: number;
  outcome_reason: string | null;
}

let h: Harness;

beforeAll(async () => {
  h = await startDaemon();
}, 30_000);

afterAll(async () => {
  await h?.stop();
});
async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (;;) {
    let wake: (() => void) | undefined;
    const nextEvent = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const unsubscribe = h.svc.events.subscribe(() => wake?.());
    try {
      if (await predicate()) return;
      await nextEvent;
    } finally {
      unsubscribe();
    }
  }
}

function rowForTurn(turnId: string): TurnRow {
  const row = h.svc.db.query(`SELECT * FROM turns WHERE id = ?`).get(turnId) as TurnRow | undefined;
  if (!row) throw new Error(`missing turn ${turnId}`);
  return row;
}

async function messages(threadId: string): Promise<MessageView[]> {
  return api(h, "GET", `/api/threads/${threadId}/messages`);
}

async function abort(turnId: string): Promise<void> {
  const response = await fetch(`${h.baseUrl}/api/turns/${turnId}/abort`, {
    method: "POST",
    headers: { "x-command-id": crypto.randomUUID() },
  });
  expect(response.status).toBe(202);
}

describe("integration: native turn steering", () => {
  test("idle send starts a new turn, then active send steers the same worker and native session after a safe boundary", async () => {
    const botId = await makeBot(h, "Steering boundaries");
    const first = await sendToBot(h, botId, "say: first turn");
    expect(first.action).toBe("sent");
    await waitThreadIdle(h, first.threadId);

    const firstRow = rowForTurn(first.turnId);
    const active = await sendToThread(h, first.threadId, "steer-echo");
    expect(active.action).toBe("sent");
    expect(active.turnId).not.toBe(first.turnId);

    await until(async () => {
      const current = await messages(first.threadId);
      return current.some((message) => message.kind === "tool" && message.payload?.toolId === "steer-boundary" && message.payload.state === "running");
    });

    const beforeSteer = rowForTurn(active.turnId);
    const steered = await sendToThread(h, first.threadId, "redirect at boundary");
    expect(steered.action).toBe("steered");
    expect(steered.messageId).toBeTruthy();
    expect(steered.threadId).toBe(first.threadId);
    expect(steered.turnId).toBe(active.turnId);

    const immediate = await messages(first.threadId);
    const steeringMessage = immediate.find((message) => message.id === steered.messageId);
    expect(steeringMessage?.author.kind).toBe("user");
    expect(steeringMessage?.text).toBe("redirect at boundary");
    expect(steeringMessage?.payload?.turnId).toBe(active.turnId);

    await waitThreadIdle(h, first.threadId);
    const afterSteer = rowForTurn(active.turnId);
    expect(afterSteer.status).toBe("completed");
    expect(afterSteer.steer_count).toBe(1);
    expect(afterSteer.worker_session_id).toBe(beforeSteer.worker_session_id);
    expect(afterSteer.native_session_id).toBe(beforeSteer.native_session_id);

    const turnCount = h.svc.db.query(`SELECT COUNT(*) AS count FROM turns WHERE thread_id = ?`).get(first.threadId) as { count: number };
    expect(turnCount.count).toBe(2);

    const transcript = await messages(first.threadId);
    const activeSend = transcript.find((message) => message.author.kind === "user" && message.text === "steer-echo");
    const finalReply = transcript.find((message) => message.author.kind === "bot" && message.kind === "text" && message.text?.includes("steered: redirect at boundary"));
    expect(activeSend).toBeDefined();
    expect(steeringMessage).toBeDefined();
    expect(finalReply).toBeDefined();
    expect(activeSend!.seq).toBeLessThan(steeringMessage!.seq);
    expect(steeringMessage!.seq).toBeLessThan(finalReply!.seq);

    const logged = h.svc.events.replay(0, h.svc.events.oldestCursor()).events;
    const steeredEvent = logged.find((event) => event.type === "turn.steered" && event.aggregateId === active.turnId);
    expect(steeredEvent?.payload).toEqual({
      turnId: active.turnId,
      threadId: first.threadId,
      messageId: steered.messageId,
    });
    const steeringMessageEvent = logged.find((event) => {
      const payload = event.payload;
      return event.type === "message.appended"
        && payload !== null
        && typeof payload === "object"
        && "id" in payload
        && payload.id === steered.messageId;
    });
    const boundaryEvent = logged.find((event) => {
      const payload = event.payload;
      return event.type === "tool.updated"
        && payload !== null
        && typeof payload === "object"
        && "toolId" in payload
        && payload.toolId === "steer-boundary";
    });
    const redirectedDelta = logged.find((event) => {
      const payload = event.payload;
      return event.type === "message.delta"
        && payload !== null
        && typeof payload === "object"
        && "text" in payload
        && typeof payload.text === "string"
        && payload.text.includes("steered: redirect at boundary");
    });
    expect(steeringMessageEvent).toBeDefined();
    expect(boundaryEvent).toBeDefined();
    expect(redirectedDelta).toBeDefined();
    expect(steeringMessageEvent!.cursor).toBeLessThan(boundaryEvent!.cursor);
    expect(boundaryEvent!.cursor).toBeLessThan(redirectedDelta!.cursor);
  });

  test("a rejected steer is inline and leaves the original turn running", async () => {
    const botId = await makeBot(h, "Rejected steering");
    const sent = await sendToBot(h, botId, "hang");
    await until(() => (rowForTurn(sent.turnId).worker_session_id?.length ?? 0) > 0);
    const before = rowForTurn(sent.turnId);

    const rejected = await apiStatus(h, "POST", `/api/threads/${sent.threadId}/messages`, { text: "do not restart" });
    expect(rejected.status).toBe(409);
    expect(rejected.body).toEqual({ error: "steer unavailable: fake hang is not steerable" });

    const after = rowForTurn(sent.turnId);
    expect(after.status).toBe("working");
    expect(after.steer_count).toBe(0);
    expect(after.worker_session_id).toBe(before.worker_session_id);
    expect(after.native_session_id).toBe(before.native_session_id);
    const turnCount = h.svc.db.query(`SELECT COUNT(*) AS count FROM turns WHERE thread_id = ?`).get(sent.threadId) as { count: number };
    expect(turnCount.count).toBe(1);

    const transcript = await messages(sent.threadId);
    const redirect = transcript.find((message) => message.author.kind === "user" && message.text === "do not restart");
    const inlineError = transcript.find((message) => message.author.kind === "system" && message.text === "steer unavailable: fake hang is not steerable");
    expect(redirect?.payload?.turnId).toBe(sent.turnId);
    expect(inlineError).toBeDefined();
    expect(redirect!.seq).toBeLessThan(inlineError!.seq);

    await abort(sent.turnId);
    await waitThreadIdle(h, sent.threadId);
  });

  test("explicit abort is a separate cancellation path", async () => {
    const botId = await makeBot(h, "Explicit abort");
    const sent = await sendToBot(h, botId, "hang");
    await until(() => (rowForTurn(sent.turnId).worker_session_id?.length ?? 0) > 0);

    await abort(sent.turnId);
    await waitThreadIdle(h, sent.threadId);

    const cancelled = rowForTurn(sent.turnId);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.outcome_reason).toBe("user abort");
    expect(cancelled.steer_count).toBe(0);
    const transcript = await messages(sent.threadId);
    expect(transcript.some((message) => message.author.kind === "system" && message.text === "turn cancelled: user abort")).toBeTrue();
    expect(transcript.some((message) => message.author.kind === "system" && message.text?.startsWith("steer unavailable:"))).toBeFalse();
    expect(transcript.filter((message) => message.author.kind === "user").map((message) => message.text)).toEqual(["hang"]);
  });
});
