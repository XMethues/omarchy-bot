import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { AttachmentDto, MessageDto, ThreadDto, TurnDto } from "@omarchy-bot/protocol";
import type { EventLog } from "../events/eventLog.ts";

interface ThreadRow {
  id: string; bot_id: string; title: string; cwd: string | null; created_at: string; updated_at: string;
}
interface MessageRow {
  id: string; thread_id: string; seq: number; author_kind: string; kind: string; text: string | null; payload: string | null; created_at: string;
}
interface MessageAttachmentRow {
  id: string; name: string; media_type: string; size: number;
}
interface TurnRow {
  id: string; thread_id: string; bot_id: string; status: string; worker_session_id: string | null; native_session_id: string; steer_count: number; started_at: string; finished_at: string | null; outcome_reason: string | null;
}

export interface NativeThreadTitleUpdater {
  renameThread(input: {
    agentId: string;
    threadId: string;
    title: string;
    nativeSessionId?: string;
  }): Promise<void>;
}

/**
 * Descriptive adapter inventory. An absent entry means the Agent has no
 * truthful native rename operation; local display metadata is never used as a
 * substitute.
 */
export type ThreadTitleCapabilityInventory = Readonly<
  Record<string, NativeThreadTitleUpdater | undefined>
>;

const NO_NATIVE_THREAD_RENAME: ThreadTitleCapabilityInventory = Object.freeze({});

export class ThreadTitleConflict extends Error {
  readonly status = 409;
  readonly code = "THREAD_TITLE_RENAME_UNSUPPORTED";

  constructor(readonly agentId: string) {
    super(`rename not supported by ${agentId}`);
    this.name = "ThreadTitleConflict";
  }
}

/** Threads are created lazily on first send; the message index is the source of truth. */
export class ThreadsService {
  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly titleCapabilities: ThreadTitleCapabilityInventory = NO_NATIVE_THREAD_RENAME,
  ) {}

  /** Insert without events — used inside multi-row transactions. */
  insertThreadRow(threadId: string, botId: string, title: string, cwd?: string): void {
    const now = new Date().toISOString();
    this.db
      .query(`INSERT INTO threads (id, bot_id, title, cwd, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(threadId, botId, title, cwd ?? null, now, now);
  }

  createThread(botId: string, opts: { title?: string; cwd?: string }): ThreadDto {
    const id = randomUUID();
    this.insertThreadRow(id, botId, opts.title ?? "New conversation", opts.cwd);
    this.events.append("thread", id, "thread.created", { botId });
    return this.getThread(id)!;
  }

  getThread(id: string): ThreadDto | undefined {
    const r = this.db.query(`SELECT * FROM threads WHERE id = ?`).get(id) as ThreadRow | undefined;
    if (!r) return undefined;
    const active = this.activeTurn(id);
    return {
      id: r.id, botId: r.bot_id, title: r.title,
      ...(r.cwd !== null ? { cwd: r.cwd } : {}),
      createdAt: r.created_at, updatedAt: r.updated_at,
      ...(active !== undefined ? { activeTurn: active } : {}),
    };
  }

  listThreads(botId?: string): ThreadDto[] {
    const rows = (
      botId !== undefined
        ? this.db.query(`SELECT * FROM threads WHERE bot_id = ? ORDER BY updated_at DESC, created_at DESC, id DESC`).all(botId)
        : this.db.query(`SELECT * FROM threads ORDER BY updated_at DESC, created_at DESC, id DESC`).all()
    ) as ThreadRow[];
    return rows.map((r) => {
      const active = this.activeTurn(r.id);
      return {
        id: r.id, botId: r.bot_id, title: r.title,
        ...(r.cwd !== null ? { cwd: r.cwd } : {}),
        createdAt: r.created_at, updatedAt: r.updated_at,
        ...(active !== undefined ? { activeTurn: active } : {}),
      };
    });
  }

  listThreadsForBot(botId: string, q?: string): ThreadDto[] {
    const all = this.listThreads(botId);
    const needle = q?.trim().toLowerCase() ?? "";
    if (needle === "") return all;
    return all.filter((thread) => thread.title.toLowerCase().includes(needle));
  }

  /**
   * Rename only through an Agent operation declared by the adapter inventory.
   * The local title changes after the native operation succeeds, never before.
   */
  async updateTitle(id: string, title: string): Promise<ThreadDto | undefined> {
    const normalizedTitle = title.trim();
    if (normalizedTitle.length === 0 || normalizedTitle.length > 120) {
      throw new RangeError("title must contain 1 to 120 characters");
    }

    const identity = this.db
      .query(`
        SELECT bots.agent_id, thread_sessions.native_session_id
        FROM threads
        JOIN bots ON bots.id = threads.bot_id
        LEFT JOIN thread_sessions ON thread_sessions.thread_id = threads.id
        WHERE threads.id = ?
      `)
      .get(id) as { agent_id: string; native_session_id: string | null } | undefined;
    if (identity === undefined) return undefined;

    const updater = this.titleCapabilities[identity.agent_id];
    if (updater === undefined) throw new ThreadTitleConflict(identity.agent_id);

    await updater.renameThread({
      agentId: identity.agent_id,
      threadId: id,
      title: normalizedTitle,
      ...(identity.native_session_id !== null ? { nativeSessionId: identity.native_session_id } : {}),
    });

    const now = new Date().toISOString();
    this.db.query(`UPDATE threads SET title = ?, updated_at = ? WHERE id = ?`).run(normalizedTitle, now, id);
    this.events.append("thread", id, "thread.updated", { title: normalizedTitle });
    return this.getThread(id);
  }

  touch(id: string): void {
    this.db.query(`UPDATE threads SET updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id);
  }

  private toMessageDto(m: MessageRow): MessageDto {
    const attachmentRows = this.db
      .query(`SELECT id, name, media_type, size FROM attachments WHERE message_id = ? AND kind = 'managed' ORDER BY created_at, id`)
      .all(m.id) as MessageAttachmentRow[];
    const attachments: AttachmentDto[] = attachmentRows.map((attachment) => ({
      id: attachment.id,
      kind: "managed",
      name: attachment.name,
      mediaType: attachment.media_type,
      size: attachment.size,
      url: `/api/attachments/${attachment.id}`,
    }));
    return {
      id: m.id, threadId: m.thread_id, seq: m.seq,
      author: m.author_kind === "user" ? { kind: "user" } : m.author_kind === "bot" ? { kind: "bot" } : { kind: "system" },
      kind: m.kind as MessageDto["kind"],
      ...(m.text !== null ? { text: m.text } : {}),
      ...(attachments.length > 0 ? { attachments } : {}),
      ...(m.payload !== null ? { payload: JSON.parse(m.payload) } : {}),
      createdAt: m.created_at,
    };
  }

  /**
   * Append without emitting an event — callers inside a turn own the event
   * shape (delta flush, tool cards). Used by TurnService.
   */
  appendMessageQuiet(threadId: string, m: { author: MessageDto["author"]; kind: MessageDto["kind"]; text?: string; payload?: unknown }): MessageDto {
    const seq = (this.db.query(`SELECT COALESCE(MAX(seq), 0) AS s FROM messages WHERE thread_id = ?`).get(threadId) as { s: number }).s + 1;
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .query(`INSERT INTO messages (id, thread_id, seq, author_kind, author_bot_id, author_role_id, kind, text, payload, created_at) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`)
      .run(id, threadId, seq, m.author.kind, m.kind, m.text ?? null, m.payload === undefined ? null : JSON.stringify(m.payload), now);
    this.touch(threadId);
    return this.getMessage(id)!;
  }

  appendMessage(threadId: string, m: { author: MessageDto["author"]; kind: MessageDto["kind"]; text?: string; payload?: unknown }): MessageDto {
    const dto = this.appendMessageQuiet(threadId, m);
    this.events.append("thread", threadId, "message.appended", dto);
    return dto;
  }

  updateToolMessage(
    threadId: string,
    toolId: string,
    update: { state: "running" | "complete" | "error"; output?: unknown; isError?: boolean },
  ): MessageDto | undefined {
    const row = this.db
      .query(
        `SELECT id, payload FROM messages
         WHERE thread_id = ? AND kind = 'tool' AND json_extract(payload, '$.toolId') = ?
         ORDER BY seq DESC LIMIT 1`,
      )
      .get(threadId, toolId) as { id: string; payload: string } | undefined;
    if (row === undefined) return undefined;
    const stored: unknown = JSON.parse(row.payload);
    if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return undefined;
    this.db.query(`UPDATE messages SET payload = ? WHERE id = ?`).run(JSON.stringify({ ...stored, ...update }), row.id);
    return this.getMessage(row.id);
  }

  getMessage(id: string): MessageDto | undefined {
    const m = this.db.query(`SELECT * FROM messages WHERE id = ?`).get(id) as MessageRow | undefined;
    return m ? this.toMessageDto(m) : undefined;
  }

  listMessages(threadId: string): MessageDto[] {
    const rows = this.db.query(`SELECT * FROM messages WHERE thread_id = ? ORDER BY seq ASC`).all(threadId) as MessageRow[];
    return rows.map((r) => this.toMessageDto(r));
  }

  getNativeSession(threadId: string): string | undefined {
    const r = this.db.query(`SELECT native_session_id FROM thread_sessions WHERE thread_id = ?`).get(threadId) as { native_session_id: string } | undefined;
    return r?.native_session_id;
  }

  setNativeSession(threadId: string, nativeSessionId: string): void {
    const now = new Date().toISOString();
    this.db
      .query(`INSERT INTO thread_sessions (thread_id, native_session_id, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(thread_id) DO UPDATE SET native_session_id = excluded.native_session_id, updated_at = excluded.updated_at`)
      .run(threadId, nativeSessionId, now);
  }

  // ----- turns -----

  insertTurnRow(turn: { id: string; threadId: string; botId: string; nativeSessionId: string }): void {
    this.db
      .query(`INSERT INTO turns (id, thread_id, bot_id, status, native_session_id, started_at) VALUES (?, ?, ?, 'working', ?, ?)`)
      .run(turn.id, turn.threadId, turn.botId, turn.nativeSessionId, new Date().toISOString());
  }

  turnRow(id: string): TurnRow | undefined {
    return this.db.query(`SELECT * FROM turns WHERE id = ?`).get(id) as TurnRow | undefined;
  }

  activeTurn(threadId: string): TurnDto | undefined {
    const r = this.db
      .query(`SELECT * FROM turns WHERE thread_id = ? AND status NOT IN ('completed','cancelled','failed') ORDER BY started_at DESC LIMIT 1`)
      .get(threadId) as TurnRow | undefined;
    return r ? this.turnToDto(r) : undefined;
  }

  activeTurnForBot(botId: string): TurnDto | undefined {
    const r = this.db
      .query(`SELECT * FROM turns WHERE bot_id = ? AND status NOT IN ('completed','cancelled','failed') ORDER BY started_at DESC LIMIT 1`)
      .get(botId) as TurnRow | undefined;
    return r ? this.turnToDto(r) : undefined;
  }

  turnToDto(r: TurnRow): TurnDto {
    return {
      id: r.id, threadId: r.thread_id, botId: r.bot_id, status: r.status as TurnDto["status"],
      steerCount: r.steer_count, startedAt: r.started_at,
      ...(r.finished_at !== null ? { finishedAt: r.finished_at } : {}),
      ...(r.outcome_reason !== null ? { reason: r.outcome_reason } : {}),
    };
  }
}
