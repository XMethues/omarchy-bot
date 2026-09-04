export interface Thread {
  id: string;
  botId: string;
  title: string;
  cwd?: string;
  createdAt: string;
  updatedAt: string;
}

/** The thread owns the Bot; messages carry no per-author Bot/Role identity. */
export type Author = { kind: "user" } | { kind: "bot" } | { kind: "system" };

export type MessageKind = "text" | "response" | "thinking" | "tool" | "event";

export type ResponseState = "streaming" | "completed";

export interface ResponseBlock {
  blockId: string;
  state: ResponseState;
  startedAt: string;
  completedAt?: string;
}

export function canTransitionResponse(from: ResponseState, event: "delta" | "end"): boolean {
  return from === "streaming" && (event === "delta" || event === "end");
}

export type ThinkingState = "streaming" | "completed";

export interface ThinkingBlock {
  blockId: string;
  state: ThinkingState;
  startedAt: string;
  completedAt?: string;
}

export function canTransitionThinking(from: ThinkingState, event: "delta" | "end"): boolean {
  return from === "streaming" && (event === "delta" || event === "end");
}

export const TOOL_CALL_ERROR_SUMMARY_MAX_LENGTH = 500;
export const TOOL_CALL_INTERRUPTED_ERROR_SUMMARY = "Interrupted before completion.";

export type ToolCallStatus = "running" | "completed" | "error";

/**
 * Transcript-safe Tool Call projection. Agent-native arguments, results, logs,
 * JSON, and detailed diffs never belong to this common model.
 */
export interface ToolCallSummary {
  id: string;
  name: string;
  status: ToolCallStatus;
  target?: string;
  durationMs?: number;
  additions?: number;
  deletions?: number;
  errorSummary?: string;
}

const TOOL_CALL_SUMMARY_KEYS: Record<keyof ToolCallSummary, true> = {
  id: true,
  name: true,
  status: true,
  target: true,
  durationMs: true,
  additions: true,
  deletions: true,
  errorSummary: true,
};

export function isToolCallSummary(value: unknown): value is ToolCallSummary {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const summary = value as Partial<ToolCallSummary>;
  if (Object.keys(value).some((key) => !(key in TOOL_CALL_SUMMARY_KEYS))) return false;
  if (
    typeof summary.id !== "string" ||
    summary.id.length === 0 ||
    typeof summary.name !== "string" ||
    summary.name.length === 0 ||
    (summary.status !== "running" && summary.status !== "completed" && summary.status !== "error")
  ) return false;
  if (summary.target !== undefined && (typeof summary.target !== "string" || summary.target.length === 0)) return false;
  if (
    summary.durationMs !== undefined &&
    (typeof summary.durationMs !== "number" || !Number.isSafeInteger(summary.durationMs) || summary.durationMs < 0)
  ) return false;
  if (
    summary.additions !== undefined &&
    (typeof summary.additions !== "number" || !Number.isSafeInteger(summary.additions) || summary.additions < 0)
  ) return false;
  if (
    summary.deletions !== undefined &&
    (typeof summary.deletions !== "number" || !Number.isSafeInteger(summary.deletions) || summary.deletions < 0)
  ) return false;
  if (
    summary.errorSummary !== undefined &&
    (
      summary.status !== "error" ||
      typeof summary.errorSummary !== "string" ||
      summary.errorSummary.length === 0 ||
      summary.errorSummary.length > TOOL_CALL_ERROR_SUMMARY_MAX_LENGTH
    )
  ) return false;
  return true;
}

export function canTransitionToolCall(from: ToolCallStatus, to: ToolCallStatus): boolean {
  return from === "running" && (to === "running" || to === "completed" || to === "error");
}


interface MessageBase {
  id: string;
  threadId: string;
  seq: number;
  createdAt: string;
}

/** Ordered transcript records. Bot output can never use the user/system text shape. */
export type Message =
  | (MessageBase & {
      author: { kind: "user" } | { kind: "system" };
      kind: "text";
      text: string;
      payload?: unknown;
    })
  | (MessageBase & {
      author: { kind: "bot" };
      kind: "response";
      text: string;
      response: ResponseBlock;
    })
  | (MessageBase & {
      author: { kind: "bot" };
      kind: "thinking";
      text: string;
      thinking: ThinkingBlock;
    })
  | (MessageBase & {
      author: { kind: "bot" };
      kind: "tool";
      toolCall: ToolCallSummary;
    })
  | (MessageBase & {
      author: { kind: "bot" };
      kind: "event";
      payload: unknown;
    });
