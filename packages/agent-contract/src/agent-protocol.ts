import type { Hello, OpenSessionOptionsLike } from "./shared.ts";

/**
 * Normalized agent events (agents-integration.md §2). Adapters may only emit a
 * unified terminal state after the native protocol's own final event.
 */
export type AgentEvent =
  | { type: "message.delta"; sessionId: string; text: string }
  | { type: "tool.started"; sessionId: string; id: string; name: string; input: unknown }
  | { type: "tool.updated"; sessionId: string; id: string; output?: unknown }
  | { type: "tool.completed"; sessionId: string; id: string; output: unknown; isError: boolean }
  | { type: "turn.completed"; sessionId: string; usage?: unknown }
  | { type: "turn.cancelled"; sessionId: string }
  | { type: "error"; sessionId?: string; message: string; retryable: boolean }
  | { type: "native"; sessionId?: string; agentId: string; capability: string; payload: unknown; sensitivity: "public" | "diagnostic" | "secret" };

/** Sessions are owned by a Bot+Thread pair; steering is a first-class command. */
export type AgentCommand =
  | { type: "probe"; requestId: string }
  | { type: "session.open"; requestId: string; botId: string; threadId: string; options: OpenSessionOptionsLike }
  | { type: "session.resume"; requestId: string; botId: string; threadId: string; nativeSessionId: string; options: OpenSessionOptionsLike }
  | { type: "message.send"; requestId: string; sessionId: string; turnId: string; message: WorkerUserMessage }
  | { type: "message.steer"; requestId: string; sessionId: string; text: string }
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

export const AGENT_CAPABILITY_INVENTORY_VERSION = 1 as const;

export const NATIVE_THREAD_ACTIONS = ["resume", "history", "close", "rename", "delete", "fork", "compact"] as const;
export type NativeThreadAction = (typeof NATIVE_THREAD_ACTIONS)[number];

/** Versioned facts reported by an adapter about behavior its native surface actually supports. */
export interface AgentCapabilityInventory {
  version: typeof AGENT_CAPABILITY_INVENTORY_VERSION;
  steering: boolean;
  abort: boolean;
  sessionDeletion: boolean;
  nativeThreadActions: NativeThreadAction[];
  attachments: {
    text: boolean;
    image: boolean;
    /** Adapter input bound for inlined text. Omitted when only the daemon upload bound applies. */
    maxTextBytes?: number;
  };
  nativeEventFamilies: string[];
}

export function isAgentCapabilityInventory(value: unknown): value is AgentCapabilityInventory {
  if (value === null || typeof value !== "object") return false;
  const inventory = value as Partial<AgentCapabilityInventory>;
  const attachments = inventory.attachments as Partial<AgentCapabilityInventory["attachments"]> | null | undefined;
  return inventory.version === AGENT_CAPABILITY_INVENTORY_VERSION &&
    typeof inventory.steering === "boolean" &&
    typeof inventory.abort === "boolean" &&
    typeof inventory.sessionDeletion === "boolean" &&
    Array.isArray(inventory.nativeThreadActions) &&
    inventory.nativeThreadActions.every((action) => NATIVE_THREAD_ACTIONS.includes(action)) &&
    attachments !== null &&
    attachments !== undefined &&
    typeof attachments.text === "boolean" &&
    typeof attachments.image === "boolean" &&
    (attachments.maxTextBytes === undefined ||
      (Number.isSafeInteger(attachments.maxTextBytes) && attachments.maxTextBytes > 0)) &&
    Array.isArray(inventory.nativeEventFamilies) &&
    inventory.nativeEventFamilies.every((family) => typeof family === "string" && family.length > 0);
}

export interface ProbePayload {
  agentId: string;
  installed: boolean;
  agentVersion: string;
  sdkOk: boolean;
  reason?: string;
  capabilities: AgentCapabilityInventory;
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
