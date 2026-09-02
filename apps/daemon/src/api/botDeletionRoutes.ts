import { DeleteBotBody } from "@omarchy-bot/protocol";
import type { BotDeletionService } from "../modules/bots/botDeletion.ts";
import { HttpError } from "../modules/bots/bots.ts";

const JSON_HEADERS = { "content-type": "application/json" };

/** DELETE is intentionally separate from PATCH/archive: it is irreversible and returns a detailed cleanup result. */
export async function handleBotDeletionRequest(
  req: Request,
  deletions: BotDeletionService,
  pathname: string,
): Promise<Response | undefined> {
  const match = /^\/api\/bots\/([\w-]+)$/.exec(pathname);
  if (match === null || req.method !== "DELETE") return undefined;

  const raw: unknown = await req.json().catch(() => {
    throw new HttpError(400, "invalid JSON body");
  });
  const body = DeleteBotBody.safeParse(raw);
  if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? "invalid body");
  const result = await deletions.delete(match[1]!, body.data.confirmName);
  return new Response(JSON.stringify(result), {
    status: result.status === "deleted" ? 200 : 409,
    headers: JSON_HEADERS,
  });
}
