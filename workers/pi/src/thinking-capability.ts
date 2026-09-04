import type { Model } from "@earendil-works/pi-ai/compat";
import type { AgentCapabilityInventory } from "@omarchy-bot/agent-contract";

/**
 * Pi 0.84.4 exposes reasoning support on the resolved Model and streams native
 * thinking_start/delta/end events for reasoning models. A missing model is the
 * SDK's honest no-model state, not evidence of Thinking support.
 */
export function thinkingCapabilityForResolvedModel(
  model: Pick<Model<any>, "reasoning"> | undefined,
): AgentCapabilityInventory["thinking"] {
  const supported = model?.reasoning === true;
  return { supported, streaming: supported };
}

export async function thinkingCapabilityForProbe(
  authenticated: boolean,
  resolveDefaultModel: () => Promise<Pick<Model<any>, "reasoning"> | undefined>,
): Promise<AgentCapabilityInventory["thinking"]> {
  if (!authenticated) return thinkingCapabilityForResolvedModel(undefined);
  return thinkingCapabilityForResolvedModel(await resolveDefaultModel());
}
