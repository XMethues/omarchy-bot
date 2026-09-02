import type { AgentEvent } from "@omarchy-bot/agent-contract";

/**
 * Pi AgentSession events -> normalized AgentEvents (agents-integration.md §2).
 * Terminal `turn.completed`/`turn.cancelled` is emitted only on the native
 * settled boundary (agent_settled / post-abort), guarded by `running`.
 */
export interface SessionRuntime {
  sessionId: string;
  nativeSessionId: string;
  running: boolean;
  finished: boolean;
  aborted: boolean;
}

export function normalizeSessionEvent(ev: unknown, sessionId: string): AgentEvent[] {
  const e = ev as { type: string; [k: string]: unknown };
  switch (e.type) {
    case "message_update": {
      const ame = e.assistantMessageEvent as { type?: string; delta?: string } | undefined;
      if (ame?.type === "text_delta" && typeof ame.delta === "string" && ame.delta.length > 0) {
        return [{ type: "message.delta", sessionId, text: ame.delta }];
      }
      return [];
    }
    case "tool_execution_start":
      return [{ type: "tool.started", sessionId, id: String(e.toolCallId), name: String(e.toolName), input: e.args }];
    case "tool_execution_update":
      return [{ type: "tool.updated", sessionId, id: String(e.toolCallId), output: summarizeToolResult(e.partialResult) }];
    case "tool_execution_end":
      return [{ type: "tool.completed", sessionId, id: String(e.toolCallId), output: summarizeToolResult(e.result), isError: Boolean(e.isError) }];
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

export function summarizeToolResult(result: unknown): unknown {
  const r = result as { content?: unknown; details?: unknown } | null | undefined;
  if (r === undefined || r === null) return null;
  const text = textOf(r.content);
  return {
    ...(text !== "" ? { text } : {}),
    ...(r.details !== undefined ? { details: r.details } : {}),
  };
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
