import type { AgentEvent } from "@omarchy-bot/agent-contract";

type NativeAgentEvent = Extract<AgentEvent, { type: "native" }>;

/** Secret native payloads stay in the worker; clients only see a redacted envelope. */
export function nativeEventClientPayload(event: NativeAgentEvent): {
  capability: string;
  sensitivity: NativeAgentEvent["sensitivity"];
  payload?: unknown;
  redacted?: true;
} {
  return {
    capability: event.capability,
    sensitivity: event.sensitivity,
    ...(event.sensitivity === "secret" ? { redacted: true as const } : { payload: event.payload }),
  };
}
