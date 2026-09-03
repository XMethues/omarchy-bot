import type { Database } from "bun:sqlite";
import type { z } from "zod";
import type { Config } from "../bootstrap/config.ts";
import type { EventLog } from "../modules/events/eventLog.ts";
import type { AgentsRegistry } from "../modules/agents/registry.ts";
import type { BotsService } from "../modules/bots/bots.ts";
import type { BotDeletionService } from "../modules/bots/botDeletion.ts";
import type { ThreadsService } from "../modules/threads/threads.ts";
import type { TurnService } from "../modules/turns/turns.ts";
import type { ComputerBroker } from "../modules/computer/broker.ts";
import type { BotScreenManager } from "../modules/computer/botScreenManager.ts";
import type { ScreenProjectionService } from "../modules/computer/screenProjection.ts";
import type { AvatarService } from "../modules/avatars/avatarService.ts";
import type { DictationService } from "../modules/dictation/dictationService.ts";
import type { AttachmentsService } from "../modules/attachments/attachments.ts";
import { handleAvatarRequest } from "./avatarRoutes.ts";
import { handleThreadFeatureRequest } from "./threadRoutes.ts";
import { handleBotArchiveRequest } from "./botArchiveRoutes.ts";
import { handleBotAttentionRequest } from "./botAttentionRoutes.ts";
import { handleBotDeletionRequest } from "./botDeletionRoutes.ts";
import { handleComputerRequest } from "./computerRoutes.ts";
import { handleProjectionRequest } from "./projectionRoutes.ts";
import { handleDictationRequest } from "./dictationRoutes.ts";
import { handleAttachmentRequest } from "./attachmentRoutes.ts";
import type { Supervisor } from "../supervision/supervisor.ts";
import { existsSync } from "node:fs";
import path from "node:path";
import { CreateBotBody, PatchBotBody, SendMessageBody } from "@omarchy-bot/protocol";
import { HttpError } from "../modules/bots/bots.ts";

export interface DaemonServices {
  cfg: Config;
  db: Database;
  events: EventLog;
  agents: AgentsRegistry;
  bots: BotsService;
  botDeletions: BotDeletionService;
  threads: ThreadsService;
  turns: TurnService;
  avatars: AvatarService;
  attachments: AttachmentsService;
  dictation: DictationService;
  computer: ComputerBroker;
  screens: BotScreenManager;
  projections: ScreenProjectionService;
  /** Exposed for the conformance suite and advanced embedders; not used by HTTP handlers. */
  supervisor: Supervisor;
}

const JSON_HEADERS = { "content-type": "application/json" };
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

interface WsData {
  svc: DaemonServices;
  sub?: () => void;
}

/** Parse a JSON body with zod; 400 with the first issue on failure. */
async function parseBody<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const raw: unknown = await req.json().catch(() => {
    throw new HttpError(400, "invalid JSON body");
  });
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, parsed.error.issues[0]?.message ?? "invalid body");
  }
  return parsed.data;
}

function notFound(message: string): Response {
  return json({ error: message }, 404);
}


/**
 * Localhost REST + WS. Mutating commands are accepted -> completed-via-events.
 * Binds 127.0.0.1 only; the browser talks to nothing else.
 */
export function startHttp(svc: DaemonServices): { stop: () => Promise<void>; port: number } {
  const route = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname === "/api/events") {
      const upgraded = server.upgrade(req, { data: { svc } as WsData });
      if (upgraded) return undefined as unknown as Response;
      return json({ error: "expected websocket upgrade" }, 426);
    }

    if (pathname === "/api/health" && req.method === "GET") return json({ ok: true, ts: new Date().toISOString() });

    if (pathname === "/api/agents" && req.method === "GET") return json(svc.agents.list());

    if (pathname === "/api/bots" && req.method === "GET") {
      return json(svc.bots.list({ includeArchived: url.searchParams.get("includeArchived") === "1" }));
    }
    if (pathname === "/api/bots" && req.method === "POST") {
      const body = await parseBody(req, CreateBotBody);
      return json(svc.bots.create(body), 201);
    }

    const m = (re: RegExp): RegExpMatchArray | null => pathname.match(re);

    const botGet = m(/^\/api\/bots\/([\w-]+)$/);
    if (botGet && req.method === "GET") return json(svc.bots.getView(botGet[1]!));
    if (botGet && req.method === "PATCH") {
      const raw = (await req.json().catch(() => {
        throw new HttpError(400, "invalid JSON body");
      })) as Record<string, unknown>;
      if ("agentId" in raw && raw.agentId !== undefined) return json({ error: "agent cannot change" }, 400);
      const body = PatchBotBody.safeParse(raw);
      if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? "invalid body");
      return json(svc.bots.patch(botGet[1]!, body.data));
    }
    const deletionResponse = await handleBotDeletionRequest(req, svc.botDeletions, pathname);
    if (deletionResponse) return deletionResponse;

    const attentionResponse = await handleBotAttentionRequest(req, svc.bots, pathname);
    if (attentionResponse) return attentionResponse;

    const archiveResponse = await handleBotArchiveRequest(req, svc.bots, svc.turns, pathname);
    if (archiveResponse) return archiveResponse;

    const avatarResponse = await handleAvatarRequest(req, svc.avatars, pathname);
    if (avatarResponse) return avatarResponse;

    const threadFeatureResponse = await handleThreadFeatureRequest(req, svc.threads, pathname);
    if (threadFeatureResponse) return threadFeatureResponse;


    const attachmentResponse = await handleAttachmentRequest(req, svc.attachments, pathname);
    if (attachmentResponse) return attachmentResponse;

    const botMessages = m(/^\/api\/bots\/([\w-]+)\/messages$/);
    if (botMessages && req.method === "POST") {
      // Lazy threads: first send atomically creates thread+message+turn.
      const body = await parseBody(req, SendMessageBody);
      const result = await svc.turns.send(
        botMessages[1]!,
        null,
        body.text.trim(),
        body.attachmentIds ?? [],
        body.attachmentDraftToken,
      );
      return json(result, 202);
    }

    const threadGet = m(/^\/api\/threads\/([\w-]+)$/);
    if (threadGet && req.method === "GET") {
      const t = svc.threads.getThread(threadGet[1]!);
      return t ? json(t) : notFound(`unknown thread ${threadGet[1]}`);
    }

    const threadMsgs = m(/^\/api\/threads\/([\w-]+)\/messages$/);
    if (threadMsgs && req.method === "GET") return json(svc.threads.listMessages(threadMsgs[1]!));
    if (threadMsgs && req.method === "POST") {
      const body = await parseBody(req, SendMessageBody);
      const thread = svc.threads.getThread(threadMsgs[1]!);
      if (!thread) return notFound(`unknown thread ${threadMsgs[1]}`);
      const result = await svc.turns.send(
        thread.botId,
        thread.id,
        body.text.trim(),
        body.attachmentIds ?? [],
        body.attachmentDraftToken,
      );
      return json(result, 202);
    }


    const dictationResponse = await handleDictationRequest(req, svc.dictation, pathname);
    if (dictationResponse) return dictationResponse;

    const projectionResponse = await handleProjectionRequest(req, svc.computer, svc.projections);
    if (projectionResponse) return projectionResponse;

    const computerResponse = await handleComputerRequest(req, svc.computer, svc.screens);
    if (computerResponse) return computerResponse;

    // Release: serve the built web UI if present.
    const dist = path.resolve(import.meta.dir, "../../../web/dist");
    if (existsSync(dist) && req.method === "GET" && !pathname.startsWith("/api/")) {
      const file = pathname === "/" ? "/index.html" : pathname;
      const f = Bun.file(path.join(dist, file));
      if (await f.exists()) return new Response(f);
      return new Response(Bun.file(path.join(dist, "index.html")));
    }

    return notFound("not found");
  };

  const handle = async (req: Request): Promise<Response> => {
    try {
      return await route(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message, ...(err.extra ?? {}) }, err.status);
      return json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }
  };

  const server = Bun.serve<WsData>({
    port: svc.cfg.port,
    hostname: "127.0.0.1",
    fetch: handle,
    websocket: {
      open(_ws) {},
      message(ws, raw) {
        const data = (ws.data as WsData)!;
        let msg: { type: string; lastCursor?: number };
        try {
          msg = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (msg.type === "hello") {
          const last = msg.lastCursor ?? 0;
          const { events, snapshotRequired } = data.svc.events.replay(last, data.svc.events.oldestCursor());
          if (snapshotRequired) {
            ws.send(JSON.stringify({ type: "snapshot_required" }));
          } else {
            for (const e of events) ws.send(JSON.stringify({ type: "event", envelope: e }));
          }
          data.sub = data.svc.events.subscribe((env) => ws.send(JSON.stringify({ type: "event", envelope: env })));
          ws.send(JSON.stringify({ type: "hello", cursor: data.svc.events.oldestCursor() }));
        }
      },
      close(ws) {
        (ws.data as WsData | undefined)?.sub?.();
      },
    },
  });

  return { port: server.port ?? svc.cfg.port, stop: () => server.stop(true) };
}
