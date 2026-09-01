import type { ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "@omarchy-bot/agent-contract";

/** Tools that never need approval (agents-integration.md §3: read-only allowlist). */
export const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);

export interface PermissionGateDeps {
  sessionId: string;
  policy: "ask" | "trusted";
  pending: Map<string, (granted: boolean) => void>;
  emit: (event: AgentEvent) => void;
}

/**
 * Inline extension that gates side-effecting tool calls on human approval.
 * The daemon sees `permission.requested`; `permission.respond` resolves the
 * gate. Fail closed: if the operator never answers, the tool never runs.
 */
export function permissionGate(deps: PermissionGateDeps): ExtensionFactory {
  return (pi) => {
    pi.on("tool_call", async (event) => {
      if (deps.policy === "trusted") return {};
      if (READ_ONLY_TOOLS.has(event.toolName)) return {};
      const permissionId = `p_${crypto.randomUUID()}`;
      deps.emit({
        type: "permission.requested",
        sessionId: deps.sessionId,
        id: permissionId,
        tool: event.toolName,
        details: { summary: `${event.toolName} requested by pi bot`, input: event.input },
      });
      const granted = await new Promise<boolean>((resolve) => {
        deps.pending.set(permissionId, resolve);
      });
      return granted ? {} : { block: true, reason: "Denied by operator in omarchy-bot" };
    });
  };
}
