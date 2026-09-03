import type { AgentDto, AgentStatusDto } from "@omarchy-bot/protocol";

const AGENT_STATUS_DESCRIPTION: Record<AgentStatusDto, string> = {
  ready: "Ready to work",
  checking: "Checking availability",
  missing: "Not available in this installation",
  unconfigured: "Needs setup before it can run a bot",
  incompatible: "Needs an update or setup check before it can run a bot",
  offline: "Not responding right now",
};

export function agentAvailabilityDescription(agent: AgentDto): string {
  const status = AGENT_STATUS_DESCRIPTION[agent.status];
  if (agent.status === "ready" || agent.guidance === undefined || agent.guidance.trim().length === 0) return status;
  return `${status}. ${agent.guidance}`;
}
