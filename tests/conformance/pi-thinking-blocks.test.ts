import { describe, expect, test } from "bun:test";
import { normalizeSessionEvent, type AgentBlockTracker } from "../../workers/pi/src/normalize.ts";

function tracker(): AgentBlockTracker {
  return {
    responseBlockIds: new Map(),
    thinkingBlocks: new Map(),
    toolCalls: new Map(),
  };
}

function nativeThinking(
  type: "thinking_start" | "thinking_delta" | "thinking_end",
  contentIndex: number,
  options: { delta?: string; content?: string; initial?: string } = {},
): unknown {
  return {
    type: "message_update",
    assistantMessageEvent: {
      type,
      contentIndex,
      ...(options.delta === undefined ? {} : { delta: options.delta }),
      ...(options.content === undefined ? {} : { content: options.content }),
      ...(options.initial === undefined
        ? {}
        : { partial: { content: [{ type: "thinking", thinking: options.initial }] } }),
    },
  };
}

describe("Pi Thinking block normalization", () => {
  test("preserves native Thinking boundaries and stable IDs around Response and Tool Call events", () => {
    const state = tracker();
    const sessionId = "session-1";
    const firstStart = normalizeSessionEvent(nativeThinking("thinking_start", 0), sessionId, state)[0];
    expect(firstStart).toMatchObject({ type: "thinking.start", sessionId });
    if (firstStart?.type !== "thinking.start") throw new Error("missing first Thinking start");

    expect(normalizeSessionEvent(
      nativeThinking("thinking_delta", 0, { delta: "Inspect inputs." }),
      sessionId,
      state,
    )).toEqual([{
      type: "thinking.delta",
      sessionId,
      blockId: firstStart.blockId,
      text: "Inspect inputs.",
    }]);
    expect(normalizeSessionEvent({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "read",
    }, sessionId, state)[0]).toMatchObject({ type: "tool.started", id: "tool-1" });
    expect(normalizeSessionEvent(
      nativeThinking("thinking_end", 0, { content: "Inspect inputs." }),
      sessionId,
      state,
    )[0]).toMatchObject({ type: "thinking.end", blockId: firstStart.blockId });

    const responseStart = normalizeSessionEvent({
      type: "message_update",
      assistantMessageEvent: { type: "text_start", contentIndex: 1 },
    }, sessionId, state)[0];
    expect(responseStart).toMatchObject({ type: "response.start" });
    const secondStart = normalizeSessionEvent(nativeThinking("thinking_start", 2), sessionId, state)[0];
    expect(secondStart).toMatchObject({ type: "thinking.start" });
    if (secondStart?.type !== "thinking.start") throw new Error("missing second Thinking start");
    expect(secondStart.blockId).not.toBe(firstStart.blockId);
  });

  test("retains officially exposed raw, summary, and redaction content exactly", () => {
    for (const [index, content] of [
      [0, "Raw model reasoning."],
      [1, "Provider-authored reasoning summary."],
    ] as const) {
      const state = tracker();
      const start = normalizeSessionEvent(nativeThinking("thinking_start", index), "session-2", state)[0];
      if (start?.type !== "thinking.start") throw new Error("missing Thinking start");
      expect(normalizeSessionEvent(
        nativeThinking("thinking_delta", index, { delta: content }),
        "session-2",
        state,
      )).toEqual([{
        type: "thinking.delta",
        sessionId: "session-2",
        blockId: start.blockId,
        text: content,
      }]);
    }

    const redactedState = tracker();
    const redacted = normalizeSessionEvent(
      nativeThinking("thinking_start", 0, { initial: "[Reasoning redacted]" }),
      "session-3",
      redactedState,
    );
    expect(redacted[0]).toMatchObject({ type: "thinking.start" });
    expect(redacted[1]).toMatchObject({
      type: "thinking.delta",
      text: "[Reasoning redacted]",
    });
    expect(normalizeSessionEvent(
      nativeThinking("thinking_end", 0, { content: "[Reasoning redacted]" }),
      "session-3",
      redactedState,
    )).toHaveLength(1);
  });

  test("emits no Thinking for models that expose none and never infers hidden reasoning", () => {
    const state = tracker();
    expect(normalizeSessionEvent({
      type: "message_update",
      assistantMessageEvent: {
        type: "text_start",
        contentIndex: 0,
        partial: { hiddenReasoning: "must not cross" },
      },
    }, "session-no-thinking", state)).toHaveLength(1);
    expect(normalizeSessionEvent({
      type: "message_update",
      assistantMessageEvent: {
        type: "reasoning_delta",
        contentIndex: 1,
        delta: "not an official Pi Thinking event",
      },
    }, "session-no-thinking", state)).toEqual([]);
    expect(state.thinkingBlocks.size).toBe(0);
  });
});
