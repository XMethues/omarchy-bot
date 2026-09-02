import { PinBody } from "@omarchy-bot/protocol";
import type { BotsService } from "../modules/bots/bots.ts";
import { HttpError } from "../modules/bots/bots.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const json = (data: unknown): Response => new Response(JSON.stringify(data), { headers: JSON_HEADERS });

function threadIdBody(value: unknown): { threadId: string } {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
    || !("threadId" in value)
    || typeof value.threadId !== "string"
    || value.threadId.length === 0
  ) {
    throw new HttpError(400, "threadId is required");
  }
  return { threadId: value.threadId };
}

/** Self-contained pin/read route group for delegation from the main router. */
export async function handleBotAttentionRequest(
  req: Request,
  bots: BotsService,
  pathname: string,
): Promise<Response | undefined> {
  const match = /^\/api\/bots\/([\w-]+)\/(pin|read)$/.exec(pathname);
  if (match === null || req.method !== "POST") return undefined;

  const botId = match[1]!;
  const raw: unknown = await req.json().catch(() => {
    throw new HttpError(400, "invalid JSON body");
  });

  if (match[2] === "pin") {
    const body = PinBody.safeParse(raw);
    if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? "invalid body");
    return json(bots.pin(botId, body.data.pinned));
  }

  const body = threadIdBody(raw);
  return json(bots.clearUnread(botId, body.threadId));
}
