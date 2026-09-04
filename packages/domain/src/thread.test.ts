import { describe, expect, test } from "bun:test";
import {
  TOOL_CALL_ERROR_SUMMARY_MAX_LENGTH,
  canTransitionResponse,
  canTransitionThinking,
  canTransitionToolCall,
  isToolCallSummary,
} from "./thread.ts";

describe("Response lifecycle", () => {
  test("only a streaming Response accepts deltas or completion", () => {
    expect(canTransitionResponse("streaming", "delta")).toBeTrue();
    expect(canTransitionResponse("streaming", "end")).toBeTrue();
    expect(canTransitionResponse("completed", "delta")).toBeFalse();
    expect(canTransitionResponse("completed", "end")).toBeFalse();
  });
});

describe("Thinking lifecycle", () => {
  test("only a streaming Thinking Block accepts deltas or completion", () => {
    expect(canTransitionThinking("streaming", "delta")).toBeTrue();
    expect(canTransitionThinking("streaming", "end")).toBeTrue();
    expect(canTransitionThinking("completed", "delta")).toBeFalse();
    expect(canTransitionThinking("completed", "end")).toBeFalse();
  });
});

describe("Tool Call summary lifecycle", () => {
  test("accepts only safe summary fields and valid optional statistics", () => {
    expect(isToolCallSummary({
      id: "tool-1",
      name: "edit",
      status: "completed",
      target: "src/file.ts",
      durationMs: 17,
      additions: 2,
      deletions: 1,
    })).toBeTrue();
    expect(isToolCallSummary({
      id: "tool-1",
      name: "edit",
      status: "completed",
      input: { secret: true },
    })).toBeFalse();
    expect(isToolCallSummary({
      id: "tool-1",
      name: "edit",
      status: "error",
      errorSummary: "x".repeat(TOOL_CALL_ERROR_SUMMARY_MAX_LENGTH + 1),
    })).toBeFalse();
  });

  test("keeps terminal Tool Calls terminal", () => {
    expect(canTransitionToolCall("running", "running")).toBeTrue();
    expect(canTransitionToolCall("running", "completed")).toBeTrue();
    expect(canTransitionToolCall("running", "error")).toBeTrue();
    expect(canTransitionToolCall("completed", "running")).toBeFalse();
    expect(canTransitionToolCall("error", "completed")).toBeFalse();
  });
});
