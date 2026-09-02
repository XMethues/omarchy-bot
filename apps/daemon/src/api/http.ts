import type { Database } from "bun:sqlite";
import type { z } from "zod";
import type { Config } from "../bootstrap/config.ts";
import type { EventLog } from "../modules/events/eventLog.ts";
import type { AgentsRegistry } from "../modules/agents/registry.ts";
import type { BotsService } from "../modules/bots/bots.ts";
import type { ThreadsService } from "../modules/threads/threads.ts";
import type { TurnService } from "../modules/turns/turns.ts";
import type { ApprovalsService } from "../modules/approvals/approvals.ts";
import type { ComputerBroker } from "../modules/computer/broker.ts";
import type { Supervisor } from "../supervision/supervisor.ts";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  CreateBotBody,
  PatchBotBody,
  PatchThreadBody,
  RespondApprovalBody,
  SendMessageBody,
  type ComputerViewDto,
} from "@omarchy-bot/protocol";
import { HttpError } from "../modules/bots/bots.ts";

export interface DaemonServices {
  cfg: Config;
  db: Database;
  events: EventLog;
  agents: AgentsRegistry;
  bots: BotsService;
  threads: ThreadsService;
  turns: TurnService;
  approvals: ApprovalsService;
  computer: ComputerBroker;
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

/** Plain-language computer view (ADR 0004): no lease/TTL/queue mechanics. */
function computerView(svc: DaemonServices): ComputerViewDto {
  const state = svc.computer.state();
  if (state.emergencyStopped) return { state: "emergency-stopped", activity: "All computer control is stopped." };
  if (state.lease !== null) {
    if (state.lease.holder === "human") {
      return { state: "user-control", activity: "You are using the computer. Return it to the bots when done." };
    }
    return { state: "bot-using", botId: state.lease.holder.botId, activity: "A bot is using the computer." };
  }
  if (state.queueDepth > 0) return { state: "waiting", activity: "A bot is waiting for the computer." };
  const previewAt = state.lastImageAt;
  return { state: "idle", activity: "The computer is free.", ...(previewAt !== undefined ? { previewAt } : {}) };
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
      if (raw.agentId !== undefined) throw new HttpError(400, "a bot's agent cannot change; create another bot instead");
      const body = PatchBotBody.safeParse(raw);
      if (!body.success) throw new HttpError(400, body.error.issues[0]?.message ?? "invalid body");
      return json(svc.bots.patch(botGet[1]!, body.data));
    }

    const botThreads = m(/^\/api\/bots\/([\w-]+)\/threads$/);
    if (botThreads && req.method === "GET") {
      const q = url.searchParams.get("q");
      return json(svc.threads.listThreadsForBot(botThreads[1]!, q ?? undefined));
    }

    const botMessages = m(/^\/api\/bots\/([\w-]+)\/messages$/);
    if (botMessages && req.method === "POST") {
      // Lazy threads: first send atomically creates thread+message+turn.
      const body = await parseBody(req, SendMessageBody);
      const result = await svc.turns.send(botMessages[1]!, null, body.text.trim());
      return json(result, 202);
    }

    const threadGet = m(/^\/api\/threads\/([\w-]+)$/);
    if (threadGet && req.method === "GET") {
      const t = svc.threads.getThread(threadGet[1]!);
      return t ? json(t) : notFound(`unknown thread ${threadGet[1]}`);
    }
    if (threadGet && req.method === "PATCH") {
      await parseBody(req, PatchThreadBody);
      const thread = svc.threads.getThread(threadGet[1]!);
      if (!thread) return notFound(`unknown thread ${threadGet[1]}`);
      // pi has no native rename in its capability inventory; unsupported ops
      // are never simulated (agents-integration.md).
      return json({ error: `rename not supported by ${svc.bots.getDto(thread.botId).agentId}` }, 409);
    }

    const threadMsgs = m(/^\/api\/threads\/([\w-]+)\/messages$/);
    if (threadMsgs && req.method === "GET") return json(svc.threads.listMessages(threadMsgs[1]!));
    if (threadMsgs && req.method === "POST") {
      const body = await parseBody(req, SendMessageBody);
      const thread = svc.threads.getThread(threadMsgs[1]!);
      if (!thread) return notFound(`unknown thread ${threadMsgs[1]}`);
      const result = await svc.turns.send(thread.botId, thread.id, body.text.trim());
      return json(result, 202);
    }

    const turnAbort = m(/^\/api\/turns\/([\w-]+)\/abort$/);
    if (turnAbort && req.method === "POST") {
      await svc.turns.abortTurn(turnAbort[1]!, "user abort");
      return new Response(null, { status: 202 });
    }

    if (pathname === "/api/approvals" && req.method === "GET") return json(svc.approvals.list());
    const approvalRespond = m(/^\/api\/approvals\/([\w-]+)\/respond$/);
    if (approvalRespond && req.method === "POST") {
      const body = await parseBody(req, RespondApprovalBody);
      const updated = svc.approvals.respond(approvalRespond[1]!, {
        decision: body.decision,
        ...(body.note !== undefined ? { note: body.note } : {}),
      });
      if (!updated) return notFound("unknown approval");
      return json(updated);
    }

    if (pathname === "/api/computer/state" && req.method === "GET") return json(computerView(svc));
    if (pathname === "/api/computer/take-control" && req.method === "POST") {
      svc.computer.takeOver();
      return json(computerView(svc));
    }
    if (pathname === "/api/computer/return-to-bot" && req.method === "POST") {
      await svc.computer.imDone();
      return json(computerView(svc));
    }
    if (pathname === "/api/computer/emergency-stop" && req.method === "POST") {
      svc.computer.emergencyStop();
      return json(computerView(svc));
    }
    if (pathname === "/api/computer/resume" && req.method === "POST") {
      svc.computer.resumeAfterEmergencyStop();
      return json(computerView(svc));
    }
    if (pathname === "/api/computer/snapshot" && req.method === "GET") {
      const snap = await svc.computer.snapshot();
      if (!snap) return new Response("no snapshot", { status: 503 });
      return new Response(snap.bytes as unknown as BodyInit, { headers: { "content-type": snap.mediaType, "cache-control": "no-store" } });
    }

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
