import { describe, expect, test } from "bun:test";
import { isAgentToolCallEvent } from "../../packages/agent-contract/src/index.ts";
import { normalizeSessionEvent, type AgentBlockTracker } from "../../workers/pi/src/normalize.ts";

function nativeText(type: "text_start" | "text_delta" | "text_end", contentIndex: number, delta?: string): unknown {
  return {
    type: "message_update",
    assistantMessageEvent: {
      type,
      contentIndex,
      ...(delta === undefined ? {} : { delta }),
    },
  };
}

describe("Pi Response block normalization", () => {
  test("preserves native boundaries, ordering, and one stable ID per content index", () => {
    const tracker: AgentBlockTracker = {
      responseBlockIds: new Map(),
      thinkingBlocks: new Map(),
      toolCalls: new Map(),
    };
    const sessionId = "session-1";

    const firstStart = normalizeSessionEvent(nativeText("text_start", 0), sessionId, tracker)[0];
    expect(firstStart).toMatchObject({ type: "response.start", sessionId });
    if (firstStart?.type !== "response.start") throw new Error("missing first Response start");

    expect(normalizeSessionEvent(nativeText("text_delta", 0, "before tool"), sessionId, tracker)).toEqual([{
      type: "response.delta",
      sessionId,
      blockId: firstStart.blockId,
      text: "before tool",
    }]);
    expect(normalizeSessionEvent({
      type: "tool_execution_start",
      toolCallId: "tool-1",
      toolName: "read",
      args: { path: "/secret/native-input" },
    }, sessionId, tracker)).toEqual([{
      type: "tool.started",
      sessionId,
      id: "tool-1",
      name: "read",
      status: "running",
    }]);
    const terminal = normalizeSessionEvent({
      type: "tool_execution_end",
      toolCallId: "tool-1",
      result: { content: [{ type: "text", text: "full native output" }] },
      isError: false,
    }, sessionId, tracker)[0];
    expect(terminal).toMatchObject({
      type: "tool.completed",
      id: "tool-1",
      name: "read",
      status: "completed",
    });
    expect(terminal).not.toHaveProperty("input");
    expect(terminal).not.toHaveProperty("output");
    expect(terminal).not.toHaveProperty("errorSummary");
    expect(JSON.stringify(terminal)).not.toContain("full native output");
    expect(normalizeSessionEvent(nativeText("text_end", 0), sessionId, tracker)[0]).toMatchObject({
      type: "response.end",
      blockId: firstStart.blockId,
    });

    const secondStart = normalizeSessionEvent(nativeText("text_start", 1), sessionId, tracker)[0];
    expect(secondStart).toMatchObject({ type: "response.start", sessionId });
    if (secondStart?.type !== "response.start") throw new Error("missing second Response start");
    expect(secondStart.blockId).not.toBe(firstStart.blockId);
    expect(normalizeSessionEvent(nativeText("text_delta", 0, "late"), sessionId, tracker)).toEqual([]);
  });

  test("does not retain native tool content when summarizing a failed tool", () => {
    const tracker: AgentBlockTracker = {
      responseBlockIds: new Map(),
      thinkingBlocks: new Map(),
      toolCalls: new Map(),
    };
    const inputSentinel = "PI_TOOL_INPUT_SECRET_8f61";
    const outputSentinel = "PI_TOOL_OUTPUT_SECRET_c093";
    const logSentinel = "PI_TOOL_LOG_SECRET_761b";
    const arbitraryResultSentinel = "PI_TOOL_ARBITRARY_RESULT_SECRET_a440";

    const events = [
      ...normalizeSessionEvent({
        type: "tool_execution_start",
        toolCallId: "tool-error",
        toolName: "bash",
        args: { command: inputSentinel },
      }, "session-error", tracker),
      ...normalizeSessionEvent({
        type: "tool_execution_update",
        toolCallId: "tool-error",
        partialResult: { content: [{ type: "text", text: logSentinel }] },
      }, "session-error", tracker),
      ...normalizeSessionEvent({
        type: "tool_execution_end",
        toolCallId: "tool-error",
        result: {
          content: [{ type: "text", text: outputSentinel }],
          details: {
            log: logSentinel,
            arbitrary: arbitraryResultSentinel,
          },
        },
        isError: true,
        log: logSentinel,
      }, "session-error", tracker),
    ];
    const terminal = events[events.length - 1];

    expect(terminal).toMatchObject({
      type: "tool.completed",
      sessionId: "session-error",
      id: "tool-error",
      name: "bash",
      status: "error",
      errorSummary: "Tool call failed.",
    });
    expect(isAgentToolCallEvent(terminal)).toBeTrue();
    const normalized = JSON.stringify(events);
    for (const sentinel of [
      inputSentinel,
      outputSentinel,
      logSentinel,
      arbitraryResultSentinel,
    ]) {
      expect(normalized).not.toContain(sentinel);
    }
  });
});
