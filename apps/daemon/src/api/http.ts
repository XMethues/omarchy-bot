import type { Database } from "bun:sqlite";
import type { Config } from "../bootstrap/config.ts";
import type { EventLog } from "../modules/events/eventLog.ts";
import type { BotRegistry } from "../modules/bots/registry.ts";
import type { ThreadsService } from "../modules/threads/threads.ts";
import type { TaskRunner } from "../modules/tasks/runner.ts";
import type { PermissionsService } from "../modules/permissions/permissions.ts";
import type { ComputerBroker } from "../modules/computer/broker.ts";
import { existsSync } from "node:fs";
import path from "node:path";
import { ComputerStateDto, CreateThreadBody, RespondApprovalBody, SendMessageBody } from "@omarchy-bot/protocol";

export interface DaemonServices {
  cfg: Config;
  db: Database;
  events: EventLog;
  bots: BotRegistry;
  threads: ThreadsService;
  runner: TaskRunner;
  permissions: PermissionsService;
  computer: ComputerBroker;
}

const JSON_HEADERS = { "content-type": "application/json" };
const json = (data: unknown, status = 200): Response => new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });

interface WsData {
  svc: DaemonServices;
  sub?: () => void;
}


/**
 * Localhost REST + WS. Mutating commands are accepted -> completed-via-events;
 * desktop-input commands are never retried. MVP binds 127.0.0.1 only.
 */
export function startHttp(svc: DaemonServices): { stop: () => Promise<void>; port: number } {
  const server = Bun.serve<WsData>({
    port: svc.cfg.port,
    hostname: "127.0.0.1",
    async fetch(req): Promise<Response> {
      const { pathname } = new URL(req.url);

      if (pathname === "/api/events") {
        const upgraded = server.upgrade(req, { data: { svc } as WsData });
        if (upgraded) return undefined as unknown as Response;
        return json({ error: "expected websocket upgrade" }, 426);
      }

      if (pathname === "/api/health" && req.method === "GET") return json({ ok: true, ts: new Date().toISOString() });

      if (pathname === "/api/bots" && req.method === "GET") return json(svc.bots.list());

      const m = (re: RegExp): RegExpMatchArray | null => pathname.match(re);

      const botRecheck = m(/^\/api\/bots\/([\w-]+)\/recheck$/);
      if (botRecheck && req.method === "POST") return json(await svc.bots.recheck(botRecheck[1]!));

      const botPatch = m(/^\/api\/bots\/([\w-]+)$/);
      if (botPatch && req.method === "PATCH") {
        const body = (await req.json()) as { enabled?: boolean; permissionPolicy?: "ask" | "trusted" };
        if (body.enabled !== undefined) svc.bots.setEnabled(botPatch[1]!, body.enabled);
        if (body.permissionPolicy !== undefined) svc.bots.setPolicy(botPatch[1]!, body.permissionPolicy);
        return json(svc.bots.get(botPatch[1]!));
      }

      if (pathname === "/api/threads" && req.method === "GET") return json(svc.threads.listThreads());
      if (pathname === "/api/threads" && req.method === "POST") {
        const body = CreateThreadBody.parse(await req.json());
        if (!svc.bots.isEnabled(body.botId)) return json({ error: `bot ${body.botId} not enabled` }, 400);
        return json(
          svc.threads.createDirectThread(body.botId, {
            ...(body.roleId !== undefined ? { roleId: body.roleId } : {}),
            ...(body.title !== undefined ? { title: body.title } : {}),
            ...(body.cwd !== undefined ? { cwd: body.cwd } : {}),
          }),
        );
      }

      const threadMsgs = m(/^\/api\/threads\/([\w-]+)\/messages$/);
      if (threadMsgs && req.method === "GET") return json(svc.threads.listMessages(threadMsgs[1]!));
      if (threadMsgs && req.method === "POST") {
        const body = SendMessageBody.parse(await req.json());
        const msg = await svc.runner.sendUserMessage(threadMsgs[1]!, body.text);
        return json(msg, 202);
      }

      if (pathname === "/api/tasks" && req.method === "GET") return json(taskList(svc.db));
      const taskAbort = m(/^\/api\/tasks\/([\w-]+)\/abort$/);
      if (taskAbort && req.method === "POST") {
        await svc.runner.abortTask(taskAbort[1]!, "user abort");
        return new Response(null, { status: 202 });
      }

      if (pathname === "/api/permissions" && req.method === "GET") return json(svc.permissions.list());
      const permRespond = m(/^\/api\/permissions\/([\w-]+)\/respond$/);
      if (permRespond && req.method === "POST") {
        const body = RespondApprovalBody.parse(await req.json());
        const updated = svc.permissions.respond(permRespond[1]!, {
          decision: body.decision,
          ...(body.note !== undefined ? { note: body.note } : {}),
        });
        if (!updated) return json({ error: "unknown permission" }, 404);
        return json(updated);
      }

      if (pathname === "/api/computer/state" && req.method === "GET") return json(ComputerStateDto.parse(svc.computer.state()));
      if (pathname === "/api/computer/take-over" && req.method === "POST") {
        svc.computer.takeOver();
        return json(ComputerStateDto.parse(svc.computer.state()));
      }
      if (pathname === "/api/computer/release" && req.method === "POST") {
        svc.computer.release("human", "");
        return json(ComputerStateDto.parse(svc.computer.state()));
      }
      if (pathname === "/api/computer/im-done" && req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as { note?: string };
        await svc.computer.imDone(body.note);
        return json(ComputerStateDto.parse(svc.computer.state()));
      }
      if (pathname === "/api/computer/emergency-stop" && req.method === "POST") {
        svc.computer.emergencyStop();
        return json(ComputerStateDto.parse(svc.computer.state()));
      }
      if (pathname === "/api/computer/resume" && req.method === "POST") {
        svc.computer.resumeAfterEmergencyStop();
        return json(ComputerStateDto.parse(svc.computer.state()));
      }
      if (pathname === "/api/computer/snapshot" && req.method === "GET") {
        const snap = await svc.computer.snapshot();
        if (!snap) return new Response("no snapshot", { status: 503 });
        return new Response(snap.bytes as unknown as BodyInit, { headers: { "content-type": snap.mediaType, "cache-control": "no-store" } });
      }

      if (pathname === "/api/attachments" && req.method === "POST") return json({ error: "attachments land with M2 conformance" }, 501);

      // Release: serve the built web UI if present.
      const dist = path.resolve(import.meta.dir, "../../../web/dist");
      if (existsSync(dist) && req.method === "GET" && !pathname.startsWith("/api/")) {
        const file = pathname === "/" ? "/index.html" : pathname;
        const f = Bun.file(path.join(dist, file));
        if (await f.exists()) return new Response(f);
        return new Response(Bun.file(path.join(dist, "index.html")));
      }

      return json({ error: "not found" }, 404);
    },
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

function taskList(db: Database) {
  const rows = db
    .query(`SELECT id, thread_id, owner_bot_id, owner_role_id, title, status, created_at, updated_at FROM tasks ORDER BY updated_at DESC LIMIT 200`)
    .all() as Record<string, string>[];
  return rows.map((r) => ({
    id: r.id,
    threadId: r.thread_id,
    owner: { botId: r.owner_bot_id, roleId: r.owner_role_id },
    title: r.title,
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}
