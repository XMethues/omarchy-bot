/** Supported Agent execution backends. Never fork this union per Bot. */
export const AGENT_IDS = ["pi", "omp", "codex", "claude", "grok", "opencode", "gemini", "copilot", "crush"] as const;
export type AgentId = (typeof AGENT_IDS)[number];

/**
 * User-created Bot id: `bot_<32hex>`. NEVER aliases an AgentId — Bots
 * reference Agents, they are not Agents.
 */
export type BotId = string;

/** Turn id: `turn_<32hex>`. */
export type TurnId = string;

export function isBotId(id: string): boolean {
  return /^bot_[0-9a-f]{32}$/.test(id);
}
