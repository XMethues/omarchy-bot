/** One Agent runtime === one Bot. Never fork this union per role. */
export const AGENT_IDS = ["pi", "omp", "codex", "claude", "grok", "opencode", "gemini", "copilot", "crush"] as const;
export type AgentId = (typeof AGENT_IDS)[number];
export type BotId = AgentId;
export type RoleId = string;

/** A Bot+Role pair. The only actor type that can own tasks, leases or messages. */
export interface ActorRef {
  botId: BotId;
  roleId: RoleId;
}

export function actorEquals(a: ActorRef, b: ActorRef): boolean {
  return a.botId === b.botId && a.roleId === b.roleId;
}
