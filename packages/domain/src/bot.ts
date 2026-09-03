import type { AgentId, BotId, SurfaceId } from "./ids.ts";

/** Agent installation/readiness as reported by the Agent registry. */
export type AgentStatus = "ready" | "missing" | "unconfigured" | "incompatible" | "checking" | "offline";

export interface AgentReadiness {
  id: AgentId;
  displayName: string;
  version: string;
  status: AgentStatus;
  reason?: string;
  /** Plain-language setup guidance shown when the Agent is not ready. */
  guidance?: string;
}

/** Bot activity as derived from its active turn + Agent readiness. */
export type BotActivityStatus = "idle" | "working" | "waiting" | "needs_you" | "error" | "unavailable";

export interface AvatarRecipe {
  rendererVersion: string;
  style: string;
  seed: string;
  options: Record<string, string | number | boolean>;
}

export type Avatar =
  | { kind: "generated" | "recipe"; recipe: AvatarRecipe }
  | { kind: "upload"; file: string };

/** A user-created teammate. References exactly one Agent; immutable reference. */
export interface Bot {
  id: BotId;
  surfaceId: SurfaceId;
  name: string;
  instructions: string;
  agentId: AgentId;
  avatar: Avatar;
  pinned: boolean;
  archived: boolean;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Probe result from an Agent worker. Only `ready` Agents can back new Bots. */
export interface ProbeResult {
  agentId: AgentId;
  installed: boolean;
  agentVersion: string;
  sdkOk: boolean;
  conformanceOk: boolean;
  /** Set when status is `missing` or `incompatible`. */
  reason?: string;
}
