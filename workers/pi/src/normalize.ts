import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@omarchy-bot/agent-contract";

const PI_TOOL_ERROR_SUMMARY = "Tool call failed.";

/**
 * Pi AgentSession events -> normalized AgentEvents (agents-integration.md §2).
 * Terminal `turn.completed`/`turn.cancelled` is emitted only on the native
 * settled boundary (agent_settled / post-abort), guarded by `running`.
 */
interface TrackedThinkingBlock {
  blockId: string;
  text: string;
}

export interface AgentBlockTracker {
  responseBlockIds: Map<number, string>;
  thinkingBlocks: Map<number, TrackedThinkingBlock>;
  toolCalls: Map<string, { name: string; startedAt: number }>;
}

export interface SessionRuntime extends AgentBlockTracker {
  sessionId: string;
  nativeSessionId: string;
  running: boolean;
  finished: boolean;
  aborted: boolean;
}

export function normalizeSessionEvent(
  ev: unknown,
  sessionId: string,
  tracker?: AgentBlockTracker,
): AgentEvent[] {
  const e = ev as { type: string; [k: string]: unknown };
  switch (e.type) {
    case "message_start": {
      const message = e.message as { role?: string } | undefined;
      if (message?.role === "assistant") {
        tracker?.responseBlockIds.clear();
        tracker?.thinkingBlocks.clear();
      }
      return [];
    }
    case "message_update": {
      const ame = e.assistantMessageEvent as {
        type?: string;
        contentIndex?: number;
        delta?: string;
        content?: string;
        partial?: { content?: unknown[] };
      } | undefined;
      if (
        ame === undefined ||
        typeof ame.contentIndex !== "number" ||
        !Number.isSafeInteger(ame.contentIndex) ||
        tracker === undefined
      ) return [];
      const contentIndex = ame.contentIndex;
      if (ame.type === "text_start") {
        if (tracker.responseBlockIds.has(contentIndex)) return [];
        const blockId = `response_${randomUUID().replace(/-/g, "")}`;
        tracker.responseBlockIds.set(contentIndex, blockId);
        return [{ type: "response.start", sessionId, blockId, startedAt: new Date().toISOString() }];
      }
      if (ame.type === "thinking_start") {
        if (tracker.thinkingBlocks.has(contentIndex)) return [];
        const blockId = `thinking_${randomUUID().replace(/-/g, "")}`;
        const initial = thinkingContentAt(ame.partial, contentIndex);
        tracker.thinkingBlocks.set(contentIndex, { blockId, text: initial });
        const startedAt = new Date().toISOString();
        return [
          { type: "thinking.start", sessionId, blockId, startedAt },
          ...(initial.length > 0
            ? [{ type: "thinking.delta" as const, sessionId, blockId, text: initial }]
            : []),
        ];
      }
      const blockId = tracker.responseBlockIds.get(contentIndex);
      if (blockId !== undefined) {
        if (ame.type === "text_delta" && typeof ame.delta === "string" && ame.delta.length > 0) {
          return [{ type: "response.delta", sessionId, blockId, text: ame.delta }];
        }
        if (ame.type === "text_end") {
          tracker.responseBlockIds.delete(contentIndex);
          return [{ type: "response.end", sessionId, blockId, completedAt: new Date().toISOString() }];
        }
      }
      const thinking = tracker.thinkingBlocks.get(contentIndex);
      if (thinking !== undefined) {
        if (ame.type === "thinking_delta" && typeof ame.delta === "string" && ame.delta.length > 0) {
          thinking.text += ame.delta;
          return [{ type: "thinking.delta", sessionId, blockId: thinking.blockId, text: ame.delta }];
        }
        if (ame.type === "thinking_end") {
          tracker.thinkingBlocks.delete(contentIndex);
          const officialSuffix =
            typeof ame.content === "string" &&
              ame.content.length > thinking.text.length &&
              ame.content.startsWith(thinking.text)
              ? ame.content.slice(thinking.text.length)
              : "";
          return [
            ...(officialSuffix.length > 0
              ? [{ type: "thinking.delta" as const, sessionId, blockId: thinking.blockId, text: officialSuffix }]
              : []),
            {
              type: "thinking.end",
              sessionId,
              blockId: thinking.blockId,
              completedAt: new Date().toISOString(),
            },
          ];
        }
      }
      return [];
    }
    case "message_end": {
      const message = e.message as { role?: string } | undefined;
      if (message?.role === "assistant") {
        tracker?.responseBlockIds.clear();
        tracker?.thinkingBlocks.clear();
      }
      return [];
    }
    case "tool_execution_start": {
      const id = String(e.toolCallId);
      const name = String(e.toolName);
      if (tracker === undefined || tracker.toolCalls.has(id)) return [];
      tracker.toolCalls.set(id, { name, startedAt: Date.now() });
      return [{ type: "tool.started", sessionId, id, name, status: "running" }];
    }
    case "tool_execution_update": {
      const id = String(e.toolCallId);
      const call = tracker?.toolCalls.get(id);
      return call === undefined
        ? []
        : [{ type: "tool.updated", sessionId, id, name: call.name, status: "running" }];
    }
    case "tool_execution_end": {
      const id = String(e.toolCallId);
      const call = tracker?.toolCalls.get(id);
      if (call === undefined) return [];
      tracker?.toolCalls.delete(id);
      const isError = Boolean(e.isError);
      const durationMs = Math.max(0, Date.now() - call.startedAt);
      return [{
        type: "tool.completed",
        sessionId,
        id,
        name: call.name,
        status: isError ? "error" : "completed",
        durationMs,
        ...(isError ? { errorSummary: PI_TOOL_ERROR_SUMMARY } : {}),
      }];
    }
    case "auto_retry_end": {
      if (e.success === false) {
        return [{ type: "error", sessionId, message: `native retry failed: ${String(e.finalError ?? "unknown")}`, retryable: false }];
      }
      return [];
    }
    default:
      return [];
  }
}

function thinkingContentAt(partial: { content?: unknown[] } | undefined, contentIndex: number): string {
  const content = partial?.content?.[contentIndex] as { type?: unknown; thinking?: unknown } | undefined;
  return content?.type === "thinking" && typeof content.thinking === "string"
    ? content.thinking
    : "";
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c): c is { type: "text"; text: string } => (c as { type?: string; text?: unknown })?.type === "text" && typeof (c as { text?: unknown }).text === "string")
      .map((c) => c.text)
      .join("");
  }
  return "";
}

export function toNormalizedMessages(messages: readonly unknown[]): { role: "user" | "assistant" | "toolResult"; text?: string; parts?: unknown[]; createdAt?: string }[] {
  const out: { role: "user" | "assistant" | "toolResult"; text?: string; parts?: unknown[]; createdAt?: string }[] = [];
  for (const m of messages) {
    const msg = m as { role?: string; content?: unknown; timestamp?: number; isError?: boolean; errorMessage?: string };
    if (msg.role === "user" || msg.role === "assistant") {
      out.push({
        role: msg.role,
        ...(textOf(msg.content) !== "" ? { text: textOf(msg.content) } : {}),
        ...(msg.role === "assistant" && Array.isArray(msg.content) ? { parts: msg.content } : {}),
        ...(typeof msg.timestamp === "number" ? { createdAt: new Date(msg.timestamp).toISOString() } : {}),
      });
    } else if (msg.role === "toolResult") {
      out.push({
        role: "toolResult",
        ...(textOf(msg.content) !== "" ? { text: textOf(msg.content) } : {}),
        ...(typeof msg.timestamp === "number" ? { createdAt: new Date(msg.timestamp).toISOString() } : {}),
      });
    }
  }
  return out;
}
