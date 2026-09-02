import { ApiClient } from "@omarchy-bot/api-client";

export const api = new ApiClient();

/** Strip the visual whitespace the textarea adds; daemon enforces the rest. */
export function trimSendText(text: string): string {
  return text.replace(/\s+$/, "");
}
