import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { MessageDto, ThreadDto } from "@omarchy-bot/protocol";
import type { EventLog } from "../events/eventLog.ts";

interface ThreadRow {
  id: string; kind: string; title: string; bot_id: string; role_id: string; cwd: string | null; created_at: string; updated_at: string;
}
interface MessageRow {
  id: string; thread_id: string; seq: number; author_kind: string; author_bot_id: string | null; author_role_id: string | null; kind: string; text: string | null; payload: string | null; created_at: string;
}

/** Threads, roles and the message index. Direct threads own a per-thread role session mapping. */
export class ThreadsService {
  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
  ) {}

  ensureRole(botId: string, roleId?: string, name?: string): { id: string; name: string } {
    const id = roleId ?? "default";
    const existing = this.db.query(`SELECT id, name FROM roles WHERE bot_id = ? AND id = ?`).get(botId, id) as { id: string; name: string } | null;
    if (existing) return existing;
    const now = new Date().toISOString();
    this.db
      .query(`INSERT INTO roles (id, bot_id, name, instructions, memory_scope_id, created_at, updated_at) VALUES (?, ?, ?, '', ?, ?, ?)`)
      .run(id, botId, name ?? "Default", `role:${botId}:${id}`, now, now);
    this.events.append("role", id, "role.created", { botId, roleId: id });
    return { id, name: name ?? "Default" };
  }

  createDirectThread(botId: string, opts: { roleId?: string; title?: string; cwd?: string }): ThreadDto {
    const role = this.ensureRole(botId, opts.roleId);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .query(`INSERT INTO threads (id, kind, title, bot_id, role_id, cwd, created_at, updated_at) VALUES (?, 'direct', ?, ?, ?, ?, ?, ?)`)
      .run(id, opts.title ?? `${botId} bot`, botId, role.id, opts.cwd ?? null, now, now);
    this.events.append("thread", id, "thread.created", { botId, roleId: role.id, kind: "direct" });
    return this.getThread(id)!;
  }

  getThread(id: string): ThreadDto | undefined {
    const r = this.db.query(`SELECT * FROM threads WHERE id = ?`).get(id) as ThreadRow | undefined;
    if (!r) return undefined;
    return { id: r.id, kind: r.kind as "direct", title: r.title, botId: r.bot_id, roleId: r.role_id, cwd: r.cwd ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at };
  }

  listThreads(): ThreadDto[] {
    const rows = this.db.query(`SELECT * FROM threads ORDER BY updated_at DESC`).all() as ThreadRow[];
    return rows.map((r) => ({ id: r.id, kind: r.kind as "direct", title: r.title, botId: r.bot_id, roleId: r.role_id, cwd: r.cwd ?? undefined, createdAt: r.created_at, updatedAt: r.updated_at }));
  }

  touch(id: string): void {
    this.db.query(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  }

  private toDto(m: MessageRow): MessageDto {
    const author =
      m.author_kind === "user" ? ({ kind: "user" } as const)
      : m.author_kind === "bot" ? ({ kind: "bot", botId: m.author_bot_id!, roleId: m.author_role_id! } as const)
      : ({ kind: "system" } as const);
    return {
      id: m.id, threadId: m.thread_id, seq: m.seq, author,
      kind: m.kind as MessageDto["kind"],
      text: m.text ?? undefined,
      payload: m.payload ? JSON.parse(m.payload) : undefined,
      createdAt: m.created_at,
    };
  }

  appendMessage(threadId: string, m: { author: MessageDto["author"]; kind: MessageDto["kind"]; text?: string; payload?: unknown }): MessageDto {
    const seq = (this.db.query(`SELECT COALESCE(MAX(seq), 0) AS s FROM messages WHERE thread_id = ?`).get(threadId) as { s: number }).s + 1;
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .query(`INSERT INTO messages (id, thread_id, seq, author_kind, author_bot_id, author_role_id, kind, text, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, threadId, seq, m.author.kind, m.author.kind === "bot" ? m.author.botId : null, m.author.kind === "bot" ? m.author.roleId : null, m.kind, m.text ?? null, m.payload === undefined ? null : JSON.stringify(m.payload), now);
    this.touch(threadId);
    const dto = this.getMessage(id)!;
    this.events.append("thread", threadId, "message.appended", dto);
    return dto;
  }

  getMessage(id: string): MessageDto | undefined {
    const m = this.db.query(`SELECT * FROM messages WHERE id = ?`).get(id) as MessageRow | undefined;
    return m ? this.toDto(m) : undefined;
  }

  listMessages(threadId: string): MessageDto[] {
    const rows = this.db.query(`SELECT * FROM messages WHERE thread_id = ? ORDER BY seq ASC`).all(threadId) as MessageRow[];
    return rows.map((r) => this.toDto(r));
  }

  getNativeSession(roleId: string, threadId: string): string | undefined {
    const r = this.db.query(`SELECT native_session_id FROM role_sessions WHERE role_id = ? AND thread_id = ?`).get(roleId, threadId) as { native_session_id: string } | undefined;
    return r?.native_session_id;
  }

  setNativeSession(roleId: string, threadId: string, nativeSessionId: string): void {
    const now = new Date().toISOString();
    this.db
      .query(`INSERT INTO role_sessions (id, role_id, thread_id, native_session_id, created_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(role_id, thread_id) DO UPDATE SET native_session_id = excluded.native_session_id`)
      .run(randomUUID(), roleId, threadId, nativeSessionId, now);
  }
}
