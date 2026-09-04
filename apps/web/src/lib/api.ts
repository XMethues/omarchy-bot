import { ApiClient, randomUuid } from "@omarchy-bot/api-client";
export { randomUuid };

/**
 * The browser talks to the daemon it was served from — no hardcoded origin.
 * In dev the Vite proxy forwards /api to 127.0.0.1:7321.
 */
export const api = new ApiClient({ baseUrl: "" });

export function trimSendText(text: string): string {
  return text.replace(/\s+$/, "");
}

export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && "body" in error) {
    const body = error.body;
    if (body !== null && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  }
  return error instanceof Error ? error.message : fallback;
}
