import { createHash, randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { AgentId } from "@omarchy-bot/domain";
import {
  AVATAR_RENDERER_ID,
  AVATAR_STYLE_IDS,
  DEFAULT_AVATAR_STYLE_ID,
  type AvatarDto,
  type AvatarRecipeDto,
  type BotActivityEventPayload,
  type BotDto,
  type BotViewDto,
} from "@omarchy-bot/protocol";
import type { EventLog } from "../events/eventLog.ts";
import type { AgentsRegistry } from "../agents/registry.ts";
import type { ThreadsService } from "../threads/threads.ts";

interface BotRow {
  id: string; name: string; instructions: string; agent_id: string;
  avatar_kind: string; avatar_recipe: string; avatar_file: string | null;
  pinned: number;
  created_at: string; updated_at: string;
}
interface BotStateRow {
  bot_id: string; last_activity_at: string | null; preview_text: string | null; preview_at: string | null;
  unread_count: number; unread_thread_id: string | null;
}


/** A new Bot ships with a deterministic generated avatar recipe. */
export function defaultAvatarRecipe(botId: string): string {
  return JSON.stringify({ rendererVersion: AVATAR_RENDERER_ID, style: DEFAULT_AVATAR_STYLE_ID, seed: botId, options: {} });
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

/**
 * User-created Bots. Each Bot references exactly one Agent; the reference is
 * immutable (ADR 0002). Binary activity is derived from all of the Bot's
 * nonterminal Turns and never from Agent Readiness.
 */
export class BotsService {
  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly agents: AgentsRegistry,
    private readonly threads: ThreadsService,
  ) {
    // TurnService already records user/final assistant text. Other Bot and
    // system transcript output has no useful preview, but still needs attention.
    this.events.subscribe((event) => {
      if (event.type !== "message.appended" || event.aggregateType !== "thread") return;
      const message = event.payload as {
        author?: { kind?: unknown };
        kind?: unknown;
        threadId?: unknown;
      } | undefined;
      const isSystemOutput = message?.author?.kind === "system";
      const isNonTextBotOutput = message?.author?.kind === "bot" && message.kind !== "text";
      if (!isSystemOutput && !isNonTextBotOutput) return;
      const threadId = typeof message?.threadId === "string" ? message.threadId : event.aggregateId;
      const thread = this.threads.getThread(threadId);
      if (thread !== undefined) this.#recordUnreadOutput(thread.botId, threadId);
    });
  }

  #row(id: string): BotRow | undefined {
    return this.db.query(`SELECT * FROM bots WHERE id = ?`).get(id) as BotRow | undefined;
  }

  #stateRow(botId: string): BotStateRow | undefined {
    return this.db.query(`SELECT * FROM bot_state WHERE bot_id = ?`).get(botId) as BotStateRow | undefined;
  }

  create(input: { name: string; instructions?: string | undefined; agentId: AgentId }): BotDto {
    const readiness = this.agents.get(input.agentId);
    if (!readiness) throw new HttpError(400, `unknown agent '${input.agentId}'`);
    if (readiness.status !== "ready") {
      throw new HttpError(
        400,
        readiness.guidance ?? `agent '${input.agentId}' is not ready (${readiness.status})`,
        { agentStatus: readiness.status },
      );
    }
    const id = `bot_${randomUUID().replace(/-/g, "")}`;
    const now = new Date().toISOString();
    const tx = this.db.transaction(() => {
      this.db
        .query(`INSERT INTO bots (id, name, instructions, agent_id, avatar_kind, avatar_recipe, created_at, updated_at) VALUES (?, ?, ?, ?, 'generated', ?, ?, ?)`)
        .run(id, input.name, input.instructions ?? "", input.agentId, defaultAvatarRecipe(id), now, now);
      this.db.query(`INSERT INTO bot_state (bot_id) VALUES (?)`).run(id);
    });
    tx();
    this.events.append("bot", id, "bot.created", this.getDto(id));
    return this.getDto(id);
  }

  getDto(id: string): BotDto {
    const r = this.#row(id);
    if (!r) throw new HttpError(404, `unknown bot ${id}`);
    return this.#toDto(r);
  }

  #toDto(r: BotRow): BotDto {
    const avatar: AvatarDto =
      r.avatar_kind === "upload" && r.avatar_file
        ? { kind: "upload", url: `/api/bots/${r.id}/avatar` }
        : { kind: r.avatar_kind === "recipe" ? "recipe" : "generated", recipe: JSON.parse(r.avatar_recipe || defaultAvatarRecipe(r.id)) };
    return {
      id: r.id, name: r.name, instructions: r.instructions, agentId: r.agent_id as AgentId,
      avatar, pinned: Boolean(r.pinned),
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  list(): BotViewDto[] {
    const rows = this.db.query(`SELECT * FROM bots`).all() as BotRow[];
    const views = rows.map((r) => this.#toView(r));
    views.sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned)
        || (b.lastActivityAt ?? b.createdAt).localeCompare(a.lastActivityAt ?? a.createdAt)
        || a.id.localeCompare(b.id),
    );
    return views;
  }

  #toView(r: BotRow): BotViewDto {
    const st = this.#stateRow(r.id);
    const status: BotViewDto["status"] =
      this.threads.activeTurnForBot(r.id) === undefined ? "inactive" : "active";
    return {
      ...this.#toDto(r),
      status,
      unreadCount: st?.unread_count ?? 0,
      ...(st?.unread_thread_id !== undefined && st.unread_thread_id !== null ? { unreadThreadId: st.unread_thread_id } : {}),
      ...(st?.preview_text !== undefined && st.preview_text !== null ? { previewText: st.preview_text } : {}),
      ...(st?.preview_at !== undefined && st.preview_at !== null ? { previewAt: st.preview_at } : {}),
      ...(st?.last_activity_at !== undefined && st.last_activity_at !== null ? { lastActivityAt: st.last_activity_at } : {}),
    };
  }


  getView(id: string): BotViewDto {
    const r = this.#row(id);
    if (!r) throw new HttpError(404, `unknown bot ${id}`);
    return this.#toView(r);
  }

  recordActivityStatus(botId: string, threadId: string, turnId: string): void {
    const payload: BotActivityEventPayload = {
      status: this.getView(botId).status,
      threadId,
      turnId,
    };
    this.events.append("bot", botId, "bot.activity", payload);
  }

  /** Agent reference is fixed: any attempt to change it is a 400. */
  patch(id: string, body: { name?: string | undefined; instructions?: string | undefined; agentId?: unknown }): BotDto {
    const r = this.#row(id);
    if (!r) throw new HttpError(404, `unknown bot ${id}`);
    if (body.agentId !== undefined) throw new HttpError(400, "agent cannot change");
    const name = body.name ?? r.name;
    const instructions = body.instructions ?? r.instructions;
    this.db.query(`UPDATE bots SET name = ?, instructions = ?, updated_at = ? WHERE id = ?`).run(name, instructions, new Date().toISOString(), id);
    this.events.append("bot", id, "bot.updated", { name, instructions });
    return this.getDto(id);
  }

  /** Pinning changes navigation placement only; it never touches a Thread. */
  pin(id: string, pinned: boolean): BotDto {
    if (!this.#row(id)) throw new HttpError(404, `unknown bot ${id}`);
    this.db.query(`UPDATE bots SET pinned = ? WHERE id = ?`).run(pinned ? 1 : 0, id);
    const bot = this.getDto(id);
    this.events.append("bot", id, "bot.pinned", { pinned });
    return bot;
  }

  agentId(id: string): AgentId {
    const r = this.#row(id);
    if (!r) throw new HttpError(404, `unknown bot ${id}`);
    return r.agent_id as AgentId;
  }

  avatarFile(id: string): string | undefined {
    const r = this.#row(id);
    if (!r) throw new HttpError(404, `unknown bot ${id}`);
    return r.avatar_kind === "upload" ? r.avatar_file ?? undefined : undefined;
  }

  generateAvatarVariation(id: string): BotDto {
    this.getDto(id);
    const generated = this.db
      .query(`SELECT COUNT(*) AS count FROM events WHERE aggregate_type = 'bot' AND aggregate_id = ? AND type = 'bot.avatar_generated'`)
      .get(id) as { count: number };
    const variation = generated.count + 1;
    const recipe: AvatarRecipeDto = {
      rendererVersion: AVATAR_RENDERER_ID,
      style: AVATAR_STYLE_IDS[(variation - 1) % AVATAR_STYLE_IDS.length] ?? DEFAULT_AVATAR_STYLE_ID,
      seed: createHash("sha256").update(`${id}:${variation}`).digest("hex"),
      options: {},
    };
    this.#setAvatar(id, "generated", recipe, null);
    this.events.append("bot", id, "bot.avatar_generated", { avatar: this.getDto(id).avatar, variation });
    return this.getDto(id);
  }

  setRecipeAvatar(id: string, recipe: AvatarRecipeDto): BotDto {
    this.#setAvatar(id, "recipe", recipe, null);
    this.events.append("bot", id, "bot.avatar_recipe_updated", { avatar: this.getDto(id).avatar });
    return this.getDto(id);
  }

  setUploadedAvatar(id: string, relativeFile: string): BotDto {
    if (relativeFile !== `${id}.png`) throw new HttpError(400, "invalid local avatar file");
    this.#setAvatar(id, "upload", undefined, relativeFile);
    this.events.append("bot", id, "bot.avatar_uploaded", { avatar: this.getDto(id).avatar });
    return this.getDto(id);
  }

  #setAvatar(id: string, kind: "generated" | "recipe" | "upload", recipe: AvatarRecipeDto | undefined, avatarFile: string | null): void {
    if (!this.#row(id)) throw new HttpError(404, `unknown bot ${id}`);
    const now = new Date().toISOString();
    this.db
      .query(`UPDATE bots SET avatar_kind = ?, avatar_recipe = ?, avatar_file = ?, updated_at = ? WHERE id = ?`)
      .run(kind, recipe === undefined ? "" : JSON.stringify(recipe), avatarFile, now, id);
  }

  recordAssistantOutput(botId: string, threadId: string, text: string): void {
    const now = new Date().toISOString();
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 120);
    this.db
      .query(`INSERT INTO bot_state (bot_id, last_activity_at, preview_text, preview_at, unread_count, unread_thread_id)
              VALUES (?, ?, ?, ?, 1, ?)
              ON CONFLICT(bot_id) DO UPDATE SET
                last_activity_at = excluded.last_activity_at,
                preview_text = excluded.preview_text,
                preview_at = excluded.preview_at,
                unread_count = bot_state.unread_count + 1,
                unread_thread_id = excluded.unread_thread_id`)
      .run(botId, now, preview, now, threadId);
    this.events.append("bot", botId, "bot.attention", { threadId, preview, at: now });
  }

  /** User input changes recency without replacing the latest Agent output. */
  recordUserMessage(botId: string, threadId: string): void {
    const now = new Date().toISOString();
    this.db
      .query(`INSERT INTO bot_state (bot_id, last_activity_at)
              VALUES (?, ?)
              ON CONFLICT(bot_id) DO UPDATE SET
                last_activity_at = excluded.last_activity_at`)
      .run(botId, now);
    this.events.append("bot", botId, "bot.attention", { threadId, at: now });
  }

  #recordUnreadOutput(botId: string, threadId: string): void {
    const now = new Date().toISOString();
    this.db
      .query(`INSERT INTO bot_state (bot_id, last_activity_at, unread_count, unread_thread_id)
              VALUES (?, ?, 1, ?)
              ON CONFLICT(bot_id) DO UPDATE SET
                last_activity_at = excluded.last_activity_at,
                unread_count = bot_state.unread_count + 1,
                unread_thread_id = excluded.unread_thread_id`)
      .run(botId, now, threadId);
    this.events.append("bot", botId, "bot.attention", { threadId, at: now });
  }

  clearUnread(botId: string, threadId: string): BotViewDto {
    this.getView(botId);
    this.db.query(`UPDATE bot_state SET unread_count = 0, unread_thread_id = NULL WHERE bot_id = ? AND unread_thread_id = ?`).run(botId, threadId);
    this.events.append("bot", botId, "bot.read", { threadId });
    return this.getView(botId);
  }

  unreadCount(botId: string): number {
    return this.#stateRow(botId)?.unread_count ?? 0;
  }
}
