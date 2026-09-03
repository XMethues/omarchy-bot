import type { ComputerViewDto } from "@omarchy-bot/protocol";

/** Emergency chrome follows global computer input, not the selected Bot's idle state. */
export function isEmergencyControlVisible(state: ComputerViewDto["state"]): boolean {
  return state !== "idle" && state !== "unavailable";
}
