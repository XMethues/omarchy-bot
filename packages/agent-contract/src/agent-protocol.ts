import type { ActorRef, Decision } from "@omarchy-bot/domain";
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

export type AgentCommand =
  | { type: "probe"; requestId: string }
  | { type: "session.open"; requestId: string; actor: ActorRef; options: OpenSessionOptionsLike }
  | { type: "session.resume"; requestId: string; actor: ActorRef; nativeSessionId: string; options: OpenSessionOptionsLike }
  | { type: "message.send"; requestId: string; sessionId: string; runId: string; message: WorkerUserMessage }
  | { type: "permission.respond"; requestId: string; sessionId: string; permissionId: string; decision: Decision }
  | { type: "turn.abort"; requestId: string; sessionId: string }
  | { type: "session.history"; requestId: string; sessionId: string }
  | { type: "session.close"; requestId: string; sessionId: string };

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
