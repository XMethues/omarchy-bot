import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { MessageDto, ToolCallSummaryDto } from "../../packages/protocol/src/index.ts";
import { TOOL_CALL_INTERRUPTED_ERROR_SUMMARY } from "../../packages/domain/src/index.ts";
import {
  makeBot,
  messages,
  sendToBot,
  startDaemon,
  waitThreadIdle,
  type Harness,
} from "./helpers/harness.ts";

// Worker events cross a real subprocess; poll the public API rather than guessing a fixed completion delay.
async function waitForTool(
  h: Harness,
  threadId: string,
  status?: ToolCallSummaryDto["status"],
): Promise<MessageDto> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const tool = (await messages(h, threadId)).find((message) =>
      message.kind === "tool" && (status === undefined || message.toolCall?.status === status)
    );
    if (tool !== undefined) return tool;
    if (Date.now() > deadline) throw new Error(`Tool Call did not reach ${status ?? "any status"}`);
    await Bun.sleep(25);
  }
}

function expectInterrupted(tool: MessageDto): void {
  expect(tool.toolCall).toMatchObject({
    name: "bash",
    status: "error",
    target: "safe interrupted operation",
    errorSummary: TOOL_CALL_INTERRUPTED_ERROR_SUMMARY,
  });
  expect(tool.payload).toBeUndefined();
}

describe("integration: native Tool Call summaries", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await startDaemon();
  });

  afterEach(async () => {
    await h.stop();
    rmSync(h.home, { recursive: true, force: true });
  });

  test("retains safe fields without native input, output, logs, or arbitrary JSON", async () => {
    const botId = await makeBot(h, "Safe Tool Bot");
    const sent = await sendToBot(h, botId, "tool please");
    await waitThreadIdle(h, sent.threadId);

    const tool = await waitForTool(h, sent.threadId, "completed");
    expect(tool.toolCall).toEqual({
      id: expect.any(String),
      name: "bash",
      status: "completed",
      target: "echo fake",
      durationMs: 12,
    });
    expect(tool.payload).toBeUndefined();
    expect(JSON.stringify(tool)).not.toContain("fake output");
  });

  test("finalizes a started call when its Turn fails", async () => {
    const botId = await makeBot(h, "Failed Tool Bot");
    const sent = await sendToBot(h, botId, "tool-fail");
    await waitThreadIdle(h, sent.threadId);
    expectInterrupted(await waitForTool(h, sent.threadId, "error"));
  });

  test("finalizes a started call when its Turn is cancelled", async () => {
    const botId = await makeBot(h, "Cancelled Tool Bot");
    const sent = await sendToBot(h, botId, "tool-hang");
    await waitForTool(h, sent.threadId, "running");
    await h.svc.turns.abortTurn(sent.turnId, "test cancellation");
    await waitThreadIdle(h, sent.threadId);
    expectInterrupted(await waitForTool(h, sent.threadId, "error"));
  });

  test("finalizes a started call after Agent process loss", async () => {
    const botId = await makeBot(h, "Lost Tool Bot");
    const sent = await sendToBot(h, botId, "tool-crash");
    await waitThreadIdle(h, sent.threadId);
    expectInterrupted(await waitForTool(h, sent.threadId, "error"));
  });

  test("startup recovery finalizes a call belonging to the failed Turn", async () => {
    const botId = await makeBot(h, "Recovered Tool Bot");
    const sent = await sendToBot(h, botId, "tool-hang");
    await waitForTool(h, sent.threadId, "running");

    const home = h.home;
    await h.disconnectForRestart();
    h = await startDaemon(home);

    expectInterrupted(await waitForTool(h, sent.threadId, "error"));
  });
});
