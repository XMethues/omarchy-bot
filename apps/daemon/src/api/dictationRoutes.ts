import type { DictationService } from "../modules/dictation/dictationService.ts";
import { DictationConflictError } from "../modules/dictation/dictationService.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

/** Return undefined outside the dictation route group so the main router can continue. */
export async function handleDictationRequest(
  request: Request,
  service: DictationService,
  pathname: string,
): Promise<Response | undefined> {
  if (pathname === "/api/dictation" && request.method === "GET") return json(service.state());
  if (pathname === "/api/dictation/start" && request.method === "POST") {
    try {
      return json(await service.start());
    } catch (error) {
      if (error instanceof DictationConflictError) return json({ error: error.message }, 409);
      throw error;
    }
  }
  if (pathname === "/api/dictation/stop" && request.method === "POST") return json(await service.stop());
  if (pathname === "/api/dictation/cancel" && request.method === "POST") return json(await service.cancel());
  return undefined;
}
