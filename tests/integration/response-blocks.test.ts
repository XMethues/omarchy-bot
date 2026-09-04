import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { MessageDto } from "../../packages/protocol/src/index.ts";
import {
  api,
  makeBot,
  messages,
  sendToBot,
  startDaemon,
  waitThreadIdle,
  type Harness,
} from "./helpers/harness.ts";

// The worker protocol is a real subprocess boundary; polling the public API observes receipt without an internal hook.
async function waitForResponse(h: Harness, threadId: string): Promise<MessageDto> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const response = (await messages(h, threadId)).find((message) => message.kind === "response");
    if (response !== undefined) return response;
    if (Date.now() > deadline) throw new Error("Response did not start");
    await Bun.sleep(25);
  }
}

describe("integration: ordered Response blocks", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await startDaemon();
  });

  afterEach(async () => {
    await h.stop();
    rmSync(h.home, { recursive: true, force: true });
  });

  test("persists one stable Response incrementally and returns its completed content after refresh", async () => {
    const botId = await makeBot(h, "Response Bot");
    const sent = await sendToBot(h, botId, "say: **streamed** response");

    const streaming = await waitForResponse(h, sent.threadId);
    expect(streaming).toMatchObject({
      kind: "response",
      author: { kind: "bot" },
      response: { state: "streaming" },
    });
    const blockId = streaming.response?.blockId;
    expect(blockId).toBeString();

    await waitThreadIdle(h, sent.threadId);
    const transcript = await messages(h, sent.threadId);
    const completed = transcript.find((message) => message.kind === "response");
    expect(completed).toMatchObject({
      text: "**streamed** response",
      response: { blockId, state: "completed" },
    });
    expect(completed?.response?.completedAt).toBeString();
    expect(
      transcript.some((message) => message.author.kind === "bot" && message.kind === "text"),
    ).toBeFalse();
  });

  test("keeps adjacent native Response blocks as separately ordered records", async () => {
    const botId = await makeBot(h, "Ordered Response Bot");
    const sent = await sendToBot(h, botId, "adjacent-responses");
    await waitThreadIdle(h, sent.threadId);

    const responses = (await messages(h, sent.threadId)).filter((message) => message.kind === "response");
    expect(responses.map((message) => message.text)).toEqual(["First block.", "Second block."]);
    expect(responses[1]!.seq).toBe(responses[0]!.seq + 1);
    expect(responses[1]!.response?.blockId).not.toBe(responses[0]!.response?.blockId);
  });

  test("removes an incomplete Response when a Turn is cancelled", async () => {
    const botId = await makeBot(h, "Cancelled Response Bot");
    const sent = await sendToBot(h, botId, "hang");
    await waitForResponse(h, sent.threadId);

    await h.svc.turns.abortTurn(sent.turnId, "test cancellation");
    await waitThreadIdle(h, sent.threadId);
    expect((await messages(h, sent.threadId)).some((message) => message.kind === "response")).toBeFalse();
  });

  test("removes an incomplete Response when a Turn fails", async () => {
    const botId = await makeBot(h, "Failed Response Bot");
    const sent = await sendToBot(h, botId, "partial-fail");
    await waitThreadIdle(h, sent.threadId);

    expect((await messages(h, sent.threadId)).some((message) => message.kind === "response")).toBeFalse();
  });

  test("removes an incomplete Response after Agent worker loss", async () => {
    const botId = await makeBot(h, "Lost Worker Response Bot");
    const sent = await sendToBot(h, botId, "partial-crash");
    await waitThreadIdle(h, sent.threadId);

    expect((await messages(h, sent.threadId)).some((message) => message.kind === "response")).toBeFalse();
  });

  test("startup recovery removes an incomplete Response from a failed Turn", async () => {
    const botId = await makeBot(h, "Recovered Response Bot");
    const sent = await sendToBot(h, botId, "hang");
    await waitForResponse(h, sent.threadId);

    const home = h.home;
    await h.disconnectForRestart();
    h = await startDaemon(home);

    expect((await messages(h, sent.threadId)).some((message) => message.kind === "response")).toBeFalse();
    expect((await api<{ latestTurn?: { status: string; reason?: string } }>(h, "GET", `/api/threads/${sent.threadId}`)).latestTurn).toMatchObject({
      status: "failed",
      reason: "daemon restart",
    });
  });
});
