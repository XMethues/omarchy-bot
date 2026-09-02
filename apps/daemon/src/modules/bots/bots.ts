import { createHash, randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { AgentId } from "@omarchy-bot/domain";
import type { AvatarDto, AvatarRecipeDto, BotDto, BotViewDto, TurnDto } from "@omarchy-bot/protocol";
import type { EventLog } from "../events/eventLog.ts";
import type { AgentsRegistry } from "../agents/registry.ts";
import type { ThreadsService } from "../threads/threads.ts";
import { AVATAR_RENDERER_VERSION } from "../avatars/recipes.ts";

interface BotRow {
  id: string; name: string; instructions: string; agent_id: string;
  avatar_kind: string; avatar_recipe: string; avatar_file: string | null;
  pinned: number; archived: number; archived_at: string | null;
  created_at: string; updated_at: string;
}
interface BotStateRow {
  bot_id: string; last_activity_at: string | null; preview_text: string | null; preview_at: string | null;
  unread_count: number; unread_thread_id: string | null;
}

export interface BotTurnAborter {
  abortTurn(turnId: string, reason: string): Promise<void>;
  waitForTerminal(turnId: string): Promise<TurnDto>;
}

/** A new Bot ships with a deterministic generated avatar recipe. */
export function defaultAvatarRecipe(botId: string): string {
  return JSON.stringify({ rendererVersion: AVATAR_RENDERER_VERSION, style: "shapes", seed: botId, options: {} });
}

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly extra?: Record<string, unknown>) {
    super(message);
  }
}

/**
 * User-created Bots. Each Bot references exactly one Agent; the reference is
 * immutable (ADR 0002). Activity status is derived from the Bot's turns and
 * its Agent's readiness — never stored.
 */
export class BotsService {
  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly agents: AgentsRegistry,
    private readonly threads: ThreadsService,
  ) {}

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
      avatar, pinned: Boolean(r.pinned), archived: Boolean(r.archived),
      createdAt: r.created_at, updatedAt: r.updated_at,
    };
  }

  list(opts: { includeArchived?: boolean } = {}): BotViewDto[] {
    const rows = this.db
      .query(opts.includeArchived ? `SELECT * FROM bots` : `SELECT * FROM bots WHERE archived = 0`)
      .all() as BotRow[];
    const views = rows.map((r) => this.#toView(r));
    // Pinned first, then most recently active; never archived-first.
    views.sort((a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""));
    return views;
  }

  #toView(r: BotRow): BotViewDto {
    const st = this.#stateRow(r.id);
    const active = this.threads.activeTurnForBot(r.id);
    const agentReady = this.agents.status(r.agent_id as AgentId) === "ready";
    let status: BotViewDto["status"] = "idle";
    if (active !== undefined) {
      status =
        active.status === "working" ? "working"
        : active.status === "waiting_for_input" ? "needs_you"
        : active.status === "failed" ? "error"
        : "waiting";
    } else if (!agentReady) {
      status = "unavailable";
    } else if (st?.last_activity_at && Date.now() - new Date(st.last_activity_at).getTime() < 60_000 && this.#recentlyFailed(r.id)) {
      status = "error";
    }
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

  #recentlyFailed(botId: string): boolean {
    const r = this.db
      .query(`SELECT status FROM turns WHERE bot_id = ? AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1`)
      .get(botId) as { status: string } | undefined;
    return r?.status === "failed";
  }

  getView(id: string): BotViewDto {
    const r = this.#row(id);
    if (!r) throw new HttpError(404, `unknown bot ${id}`);
    return this.#toView(r);
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
  /**
   * Archive hides a Bot without changing its Threads, Agent reference, or
   * native sessions. Active turns must reach a persisted terminal state first.
   */
  async archive(id: string, body: { confirmStop?: boolean }, turns: BotTurnAborter): Promise<BotDto> {
    const row = this.#row(id);
    if (!row) throw new HttpError(404, `unknown bot ${id}`);
    if (row.archived) return this.#toDto(row);

    const activeTurns = this.threads
      .listThreads(id)
      .flatMap((thread) => thread.activeTurn === undefined ? [] : [thread.activeTurn]);
    if (activeTurns.length > 0 && body.confirmStop !== true) {
      throw new HttpError(409, "working", { confirmRequired: true });
    }
    if (activeTurns.length > 0) {
      const terminalTurns = activeTurns.map((turn) => turns.waitForTerminal(turn.id));
      await Promise.all(activeTurns.map((turn) => turns.abortTurn(turn.id, "bot archived")));
      await Promise.all(terminalTurns);
    }

    const now = new Date().toISOString();
    this.db.query(`UPDATE bots SET archived = 1, archived_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
    const archived = this.getDto(id);
    this.events.append("bot", id, "bot.archived", archived);
    return archived;
  }

  restore(id: string): BotDto {
    const row = this.#row(id);
    if (!row) throw new HttpError(404, `unknown bot ${id}`);
    if (!row.archived) return this.#toDto(row);

    const now = new Date().toISOString();
    this.db.query(`UPDATE bots SET archived = 0, archived_at = NULL, updated_at = ? WHERE id = ?`).run(now, id);
    const restored = this.getDto(id);
    this.events.append("bot", id, "bot.restored", restored);
    return restored;
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
      rendererVersion: AVATAR_RENDERER_VERSION,
      style: "shapes",
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

  recordActivity(botId: string, threadId: string, previewText: string, assistantMessage: boolean): void {
    const now = new Date().toISOString();
    const preview = previewText.slice(0, 120);
    this.db
      .query(`INSERT INTO bot_state (bot_id, last_activity_at, preview_text, preview_at, unread_count, unread_thread_id)
              VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(bot_id) DO UPDATE SET
                last_activity_at = excluded.last_activity_at,
                preview_text = excluded.preview_text,
                preview_at = excluded.preview_at,
                unread_count = bot_state.unread_count + ?,
                unread_thread_id = excluded.unread_thread_id`)
      .run(botId, now, preview, now, assistantMessage ? 1 : 0, threadId, assistantMessage ? 1 : 0);
    this.events.append("bot", botId, "bot.activity", { threadId, preview, at: now });
  }

  clearUnread(botId: string, threadId: string): void {
    this.db.query(`UPDATE bot_state SET unread_count = 0, unread_thread_id = NULL WHERE bot_id = ? AND unread_thread_id = ?`).run(botId, threadId);
    this.events.append("bot", botId, "bot.read", { threadId });
  }

  unreadCount(botId: string): number {
    return this.#stateRow(botId)?.unread_count ?? 0;
  }
}
