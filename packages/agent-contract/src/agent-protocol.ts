import type { Decision } from "@omarchy-bot/domain";
import type { Hello, OpenSessionOptionsLike, PermissionRequestDetailsLike } from "./shared.ts";

/**
 * Normalized agent events (agents-integration.md §2). Adapters may only emit a
 * unified terminal state after the native protocol's own final event.
 */
export type AgentEvent =
  | { type: "message.delta"; sessionId: string; text: string }
  | { type: "tool.started"; sessionId: string; id: string; name: string; input: unknown }
  | { type: "tool.updated"; sessionId: string; id: string; output?: unknown }
  | { type: "tool.completed"; sessionId: string; id: string; output: unknown; isError: boolean }
  | { type: "permission.requested"; sessionId: string; id: string; tool: string; details: PermissionRequestDetailsLike }
  | { type: "turn.completed"; sessionId: string; usage?: unknown }
  | { type: "turn.cancelled"; sessionId: string }
  | { type: "error"; sessionId?: string; message: string; retryable: boolean }
  | { type: "native"; sessionId?: string; agentId: string; capability: string; payload: unknown; sensitivity: "public" | "diagnostic" | "secret" };

/** Protocol v2: sessions are owned by a Bot+Thread pair; steering is a first-class command. */
export type AgentCommand =
  | { type: "probe"; requestId: string }
  | { type: "session.open"; requestId: string; botId: string; threadId: string; options: OpenSessionOptionsLike }
  | { type: "session.resume"; requestId: string; botId: string; threadId: string; nativeSessionId: string; options: OpenSessionOptionsLike }
  | { type: "message.send"; requestId: string; sessionId: string; turnId: string; message: WorkerUserMessage }
  | { type: "message.steer"; requestId: string; sessionId: string; text: string }
  | { type: "permission.respond"; requestId: string; sessionId: string; permissionId: string; decision: Decision }
  | { type: "turn.abort"; requestId: string; sessionId: string }
  | { type: "session.history"; requestId: string; sessionId: string }
  | { type: "session.close"; requestId: string; sessionId: string }
  | { type: "session.delete"; requestId: string; nativeSessionId: string };

export interface WorkerUserMessage {
  text: string;
  attachments?: { id: string; name: string; path: string; mediaType: string }[];
}

export type AgentResult =
  | { requestId: string; ok: true; payload: unknown }
  | { requestId: string; ok: false; error: string };

export type WorkerOutbound =
  | Hello
  | { type: "heartbeat" }
  | { type: "event"; event: AgentEvent }
  | AgentResult;

export interface ProbePayload {
  agentId: string;
  installed: boolean;
  agentVersion: string;
  sdkOk: boolean;
  reason?: string;
  capabilities: {
    /** True only when the adapter has a tested native operation that permanently removes a session. */
    sessionDeletion: boolean;
  };
}

export interface SessionOpenedPayload {
  sessionId: string;
  nativeSessionId: string;
}

export interface HistoryPayload {
  messages: NormalizedMessage[];
}

export interface NormalizedMessage {
  role: "user" | "assistant" | "toolResult";
  text?: string;
  parts?: unknown[];
  createdAt?: string;
}
