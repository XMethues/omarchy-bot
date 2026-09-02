import { AvatarRecipeBody } from "@omarchy-bot/protocol";
import { HttpError } from "../modules/bots/bots.ts";
import { MAX_AVATAR_UPLOAD_BYTES, type AvatarService } from "../modules/avatars/avatarService.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

/**
 * Self-contained profile-avatar route group. Return undefined when pathname is
 * outside this group so the daemon's main router can continue matching.
 */
export async function handleAvatarRequest(req: Request, svc: AvatarService, pathname: string): Promise<Response | undefined> {
  const match = pathname.match(/^\/api\/bots\/([\w-]+)\/avatar(?:\/(generate|upload|recipe))?$/);
  if (match === null) return undefined;
  const botId = match[1]!;
  const operation = match[2];

  if (operation === undefined && req.method === "GET") {
    const file = Bun.file(svc.uploadPath(botId));
    if (!(await file.exists())) throw new HttpError(404, "uploaded avatar file is missing");
    return new Response(file as unknown as BodyInit, {
      headers: { "content-type": "image/png", "cache-control": "no-store", "x-content-type-options": "nosniff" },
    });
  }

  if (operation === "generate" && req.method === "POST") return json(await svc.generate(botId));

  if (operation === "upload" && req.method === "POST") {
    const declaredLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_AVATAR_UPLOAD_BYTES) {
      throw new HttpError(400, "avatar image exceeds 8MB");
    }
    const bytes = new Uint8Array(await req.arrayBuffer());
    return json(await svc.upload(botId, bytes, req.headers.get("content-type") ?? ""));
  }

  if (operation === "recipe" && req.method === "POST") {
    const raw: unknown = await req.json().catch(() => {
      throw new HttpError(400, "invalid JSON body");
    });
    const parsed = AvatarRecipeBody.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "invalid body");
    return json(await svc.recipe(botId, parsed.data.prompt));
  }

  return undefined;
}
