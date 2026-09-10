import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { writeJsonl, type AgentPluginSnapshot, type AgentPluginToolOutput, type AgentPluginToolResult, type AgentPluginTurnContext } from "@omarchy-bot/agent-contract";

interface PendingPluginCall {
  sessionId: string;
  resolve(output: AgentPluginToolOutput): void;
  reject(error: Error): void;
  detach(): void;
}
const pending = new Map<string, PendingPluginCall>();

export function createPluginTools(snapshot: AgentPluginSnapshot | undefined, turnContext: () => AgentPluginTurnContext | undefined) {
  return (snapshot?.tools ?? []).map((definition) => defineTool({
    name: definition.name,
    label: definition.name,
    description: definition.description,
    parameters: Type.Unsafe<Record<string, unknown>>(definition.inputSchema),
    executionMode: "sequential",
    execute: async (toolCallId, parameters, signal) => {
      const context = turnContext();
      if (!context) throw new Error("Plugin tool has no active Omarchy turn binding");
      signal?.throwIfAborted();
      const requestId = crypto.randomUUID();
      const output = await new Promise<AgentPluginToolOutput>((resolve, reject) => {
        const onAbort = () => {
          if (!pending.delete(requestId)) return;
          writeJsonl({ type: "plugin.cancel", requestId });
          reject(new Error("Plugin tool call cancelled"));
        };
        pending.set(requestId, { sessionId: context.workerSessionId, resolve, reject, detach: () => signal?.removeEventListener("abort", onAbort) });
        signal?.addEventListener("abort", onAbort, { once: true });
        writeJsonl({ type: "plugin.request", requestId, context: { ...context, toolCallId }, name: definition.name, arguments: parameters });
      });
      signal?.throwIfAborted();
      if (output.isError) {
        throw new Error(output.content.filter((part) => part.type === "text").map((part) => part.text).join("\n") || "Remote plugin tool returned an error");
      }
      return { content: output.content, details: output.structuredContent };
    },
  }));
}

export function handlePluginResult(result: AgentPluginToolResult): void {
  const call = pending.get(result.requestId);
  if (!call) return;
  pending.delete(result.requestId);
  call.detach();
  if (result.ok) call.resolve(result.payload);
  else call.reject(new Error(result.error));
}

export function disposePluginCalls(sessionId?: string): void {
  for (const [requestId, call] of pending) {
    if (sessionId !== undefined && call.sessionId !== sessionId) continue;
    pending.delete(requestId);
    call.detach();
    writeJsonl({ type: "plugin.cancel", requestId });
    call.reject(new Error("Plugin tool session closed"));
  }
}
