import type { ComputerBroker } from "../modules/computer/broker.ts";
import { ScreenProjectionOfferDto } from "@omarchy-bot/protocol";
import type { ScreenProjectionService } from "../modules/computer/screenProjection.ts";

const JSON_HEADERS = { "content-type": "application/json" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

/** Unauthenticated first-release signaling for one validated Bot/Surface pair. */
export async function handleProjectionRequest(
  req: Request,
  computer: ComputerBroker,
  projections: ScreenProjectionService,
): Promise<Response | undefined> {
  const url = new URL(req.url);
  if (url.pathname !== "/api/computer/projection") return undefined;

  const botId = url.searchParams.get("botId");
  const surfaceId = url.searchParams.get("surfaceId");
  if (botId === null || surfaceId === null) return json({ error: "botId and surfaceId are required" }, 400);
  const owner = computer.resolveOwner(botId, surfaceId);
  if (owner === undefined) return json({ error: "Computer Surface was not found for this Bot" }, 404);

  if (req.method === "GET") {
    const sessionId = url.searchParams.get("sessionId");
    if (sessionId === null) return json({ error: "sessionId is required" }, 400);
    const status = projections.status(owner, sessionId);
    if (status === undefined) return json({ error: "Screen Projection was not found" }, 404);
    return json(status);
  }

  if (req.method === "POST") {
    const body: unknown = await req.json().catch(() => undefined);
    const offer = ScreenProjectionOfferDto.safeParse(body);
    if (!offer.success) return json({ error: "a WebRTC SDP offer is required" }, 400);
    try {
      return json(await projections.answer(owner, offer.data), 201);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Screen Projection could not start" }, 503);
    }
  }

  if (req.method === "DELETE") {
    const body = await req.json().catch(() => undefined) as { sessionId?: unknown } | undefined;
    if (typeof body?.sessionId !== "string") return json({ error: "sessionId is required" }, 400);
    if (!await projections.close(owner, body.sessionId)) return json({ error: "Screen Projection was not found" }, 404);
    return new Response(null, { status: 204 });
  }

  return undefined;
}
