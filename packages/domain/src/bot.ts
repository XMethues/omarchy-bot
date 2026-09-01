import type { AgentId, BotId } from "./ids.ts";

export type PermissionPolicy = "ask" | "trusted";

export type BotStatus =
  | "missing"
  | "unconfigured"
  | "checking"
  | "ready"
  | "working"
  | "waiting_for_input"
  | "waiting_for_computer"
  | "blocked"
  | "incompatible"
  | "offline";

export interface Bot {
  id: BotId;
  displayName: string;
  agentVersion: string;
  status: BotStatus;
  defaultCwd: string;
  defaultModel?: string;
  permissionPolicy: PermissionPolicy;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BotRole {
  id: string;
  botId: BotId;
  name: string;
  instructions: string;
  defaultCwd?: string;
  defaultModel?: string;
  permissionPolicy?: PermissionPolicy;
  memoryScopeId: string;
  createdAt: string;
  updatedAt: string;
}

export interface RoleSession {
  roleId: string;
  threadId: string;
  nativeSessionId: string;
}

/** Probe result from an Agent worker. Only `ready` Bots get a chat entry. */
export interface ProbeResult {
  agentId: AgentId;
  installed: boolean;
  agentVersion: string;
  sdkOk: boolean;
  conformanceOk: boolean;
  /** Set when status is `missing` or `incompatible`. */
  reason?: string;
}
