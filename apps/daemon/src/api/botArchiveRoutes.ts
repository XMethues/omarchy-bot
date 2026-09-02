import { ArchiveBody } from "@omarchy-bot/protocol";
import type { BotsService, BotTurnAborter } from "../modules/bots/bots.ts";
import { HttpError } from "../modules/bots/bots.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const json = (data: unknown): Response => new Response(JSON.stringify(data), { headers: JSON_HEADERS });

/**
 * Self-contained Bot archive/restore route group. The main router delegates
 * matching requests here and retains its shared HttpError boundary.
 */
export async function handleBotArchiveRequest(
  req: Request,
  bots: BotsService,
  turns: BotTurnAborter,
  pathname: string,
): Promise<Response | undefined> {
  const match = /^\/api\/bots\/([\w-]+)\/(archive|restore)$/.exec(pathname);
  if (match === null || req.method !== "POST") return undefined;

  const botId = match[1]!;
  if (match[2] === "restore") return json(bots.restore(botId));

  const raw: unknown = await req.json().catch(() => {
    throw new HttpError(400, "invalid JSON body");
  });
  const body = ArchiveBody.safeParse(raw);
  if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? "invalid body");
  return json(await bots.archive(botId, body.data.confirmStop === undefined ? {} : { confirmStop: body.data.confirmStop }, turns));
}
