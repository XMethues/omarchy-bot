import { AttachmentDraftToken } from "@omarchy-bot/protocol";
import type { AttachmentsService } from "../modules/attachments/attachments.ts";
import { HttpError } from "../modules/bots/bots.ts";

const JSON_HEADERS = { "content-type": "application/json" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function attachmentDraftToken(req: Request): string {
  const parsed = AttachmentDraftToken.safeParse(req.headers.get("x-attachment-draft-token"));
  if (!parsed.success) throw new HttpError(400, "x-attachment-draft-token header must be a UUID");
  return parsed.data;
}


/** Self-contained attachment route group for delegation from the daemon HTTP switchboard. */
export async function handleAttachmentRequest(
  req: Request,
  attachments: AttachmentsService,
  pathname = new URL(req.url).pathname,
): Promise<Response | undefined> {
  if (pathname === "/api/attachments/stage" && req.method === "POST") {
    const botId = req.headers.get("x-bot-id")?.trim();
    if (!botId) throw new HttpError(400, "x-bot-id header is required");
    const draftToken = attachmentDraftToken(req);
    const form = await req.formData().catch(() => {
      throw new HttpError(400, "invalid multipart form data");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "multipart field 'file' is required");
    return json(await attachments.stage(botId, draftToken, file), 201);
  }

  const staged = pathname.match(/^\/api\/attachments\/staged\/(att_[0-9a-f]{32})$/);
  if (staged && req.method === "GET") {
    const attachment = attachments.getStaged(staged[1]!, attachmentDraftToken(req));
    return attachment === undefined ? json({ error: "staged attachment not found" }, 404) : json(attachment);
  }
  if (staged && req.method === "DELETE") {
    const deleted = attachments.deleteStaged(staged[1]!, attachmentDraftToken(req));
    return deleted
      ? new Response(null, { status: 204 })
      : json({ error: "staged attachment not found" }, 404);
  }

  const managed = pathname.match(/^\/api\/attachments\/(att_[0-9a-f]{32})$/);
  if (managed && req.method === "GET") {
    const attachment = attachments.managedFile(managed[1]!);
    if (attachment === undefined) return json({ error: "managed attachment not found" }, 404);
    const file = Bun.file(attachment.path);
    if (!(await file.exists())) return json({ error: "managed attachment bytes are missing" }, 404);
    return new Response(file, {
      headers: {
        "content-type": attachment.mediaType,
        "content-length": String(attachment.size),
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  }

  return undefined;
}
