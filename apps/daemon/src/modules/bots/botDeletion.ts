import { rm } from "node:fs/promises";
import type { Database } from "bun:sqlite";
import type { AgentId, SurfaceId } from "@omarchy-bot/domain";
import type { DeleteBotFailureDto, DeleteBotResultDto } from "@omarchy-bot/protocol";
import type { AttachmentsService } from "../attachments/attachments.ts";
import type { AvatarService } from "../avatars/avatarService.ts";
import type { EventLog } from "../events/eventLog.ts";
import type { AgentsRegistry } from "../agents/registry.ts";
import type { Supervisor } from "../../supervision/supervisor.ts";
import type { BotScreenManager } from "../computer/botScreenManager.ts";
import { HttpError } from "./bots.ts";

interface DeletionBotRow {
  id: string;
  surface_id: string;
  name: string;
  agent_id: string;
  avatar_kind: string;
  avatar_file: string | null;
  archived: number;
}

interface NativeSessionRow {
  native_session_id: string;
}

interface ComputerArtifactRow {
  id: string;
  path: string;
}

interface CountRow {
  count: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}


/**
 * Coordinates irreversible Bot-owned cleanup. External/native/filesystem work
 * finishes before the SQLite delete transaction, so any failure retains an
 * archived Bot that can be retried without claiming success.
 */
export class BotDeletionService {
  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly attachments: AttachmentsService,
    private readonly avatars: AvatarService,
    private readonly agents: AgentsRegistry,
    private readonly supervisor: Supervisor,
    private readonly screens: BotScreenManager,
  ) {}

  async delete(botId: string, confirmName: string): Promise<DeleteBotResultDto> {
    const bot = this.db
      .query(
        `SELECT bots.id, bots.name, bots.agent_id, bots.avatar_kind, bots.avatar_file, bots.archived,
                bot_surfaces.surface_id
         FROM bots JOIN bot_surfaces ON bot_surfaces.bot_id = bots.id
         WHERE bots.id = ?`,
      )
      .get(botId) as DeletionBotRow | null;
    if (bot === null) throw new HttpError(404, `unknown bot ${botId}`);
    if (!bot.archived) throw new HttpError(409, "only archived bots can be permanently deleted");
    if (confirmName !== bot.name) throw new HttpError(400, "confirmation name does not match the archived bot");

    this.#claim(botId);

    const threadCount = this.#count(`SELECT COUNT(*) AS count FROM threads WHERE bot_id = ?`, botId);
    const messageCount = this.#count(
      `SELECT COUNT(*) AS count FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE bot_id = ?)`,
      botId,
    );
    const turnCount = this.#count(`SELECT COUNT(*) AS count FROM turns WHERE bot_id = ?`, botId);
    const attachmentCount = this.#count(`SELECT COUNT(*) AS count FROM attachments WHERE bot_id = ?`, botId);
    const computerArtifacts = this.db
      .query(`SELECT artifacts.id, artifacts.path FROM artifacts WHERE surface_id = ?`)
      .all(bot.surface_id) as ComputerArtifactRow[];
    const nativeSessions = this.db.query(
      `SELECT native_session_id FROM thread_sessions
       WHERE thread_id IN (SELECT id FROM threads WHERE bot_id = ?) AND native_session_id <> ''
       UNION
       SELECT native_session_id FROM turns WHERE bot_id = ? AND native_session_id <> ''`,
    ).all(botId, botId) as NativeSessionRow[];

    let nativeSupported = false;
    let nativeRemoved = 0;
    let nativeSkipped = 0;
    let attachmentFilesRemoved = 0;
    let avatarRemoved = false;
    let computerArtifactsRemoved = 0;
    const failures: DeleteBotFailureDto[] = [];

    try {
      await this.screens.destroy(bot.surface_id as SurfaceId);
    } catch (error) {
      failures.push({ stage: "surface", resource: bot.surface_id, message: errorMessage(error) });
    }

    if (nativeSessions.length > 0) {
      const capabilities = this.agents.capabilityInventory(bot.agent_id as AgentId);
      if (capabilities === undefined) {
        failures.push({
          stage: "native_session",
          resource: bot.agent_id,
          message: "validated agent capabilities are unavailable",
        });
      } else if (!capabilities.sessionDeletion) {
        nativeSkipped = nativeSessions.length;
      } else {
        nativeSupported = true;
        try {
          const worker = await this.supervisor.agentWorker(bot.agent_id as AgentId);
          const completed = new Set(
            (this.db.query(`SELECT native_session_id FROM bot_native_session_deletions WHERE bot_id = ?`)
              .all(botId) as NativeSessionRow[]).map((row) => row.native_session_id),
          );
          for (const session of nativeSessions) {
            if (completed.has(session.native_session_id)) {
              nativeRemoved += 1;
              continue;
            }
            try {
              await worker.request({ type: "session.delete", nativeSessionId: session.native_session_id }, 30_000);
              this.db.query(
                `INSERT OR IGNORE INTO bot_native_session_deletions (bot_id, native_session_id, deleted_at) VALUES (?, ?, ?)`,
              ).run(botId, session.native_session_id, new Date().toISOString());
              nativeRemoved += 1;
            } catch (error) {
              failures.push({ stage: "native_session", resource: session.native_session_id, message: errorMessage(error) });
            }
          }
        } catch (error) {
          failures.push({ stage: "native_session", resource: bot.agent_id, message: errorMessage(error) });
        }
      }
    }

    if (failures.length === 0) {
      const attachmentCleanup = this.attachments.deleteOwnedFiles(botId);
      attachmentFilesRemoved = attachmentCleanup.removed;
      failures.push(...attachmentCleanup.failures.map((failure) => ({ stage: "attachment" as const, ...failure })));

      if (bot.avatar_kind === "upload" && bot.avatar_file !== null) {
        try {
          await this.avatars.deleteUploadedFile(bot.avatar_file);
          avatarRemoved = true;
        } catch (error) {
          failures.push({ stage: "avatar", resource: bot.avatar_file, message: errorMessage(error) });
        }
      }
    }
    if (failures.length === 0) {
      for (const artifact of computerArtifacts) {
        try {
          await rm(artifact.path, { force: true });
          computerArtifactsRemoved += 1;
        } catch (error) {
          failures.push({ stage: "surface", resource: artifact.id, message: errorMessage(error) });
        }
      }
    }

    if (failures.length > 0) {
      const failed: DeleteBotResultDto = {
        status: "failed",
        botId,
        botName: bot.name,
        removed: {
          threads: 0,
          messages: 0,
          turns: 0,
          attachments: attachmentFilesRemoved,
          avatar: avatarRemoved,
          nativeSessions: nativeRemoved,
          computerArtifacts: computerArtifactsRemoved,
          surface: false,
        },
        nativeSessionCleanup: { supported: nativeSupported, skipped: nativeSkipped },
        failures,
      };
      this.#recordFailure(botId, failures);
      return failed;
    }

    const deleted: DeleteBotResultDto = {
      status: "deleted",
      botId,
      botName: bot.name,
      removed: {
        threads: threadCount,
        messages: messageCount,
        turns: turnCount,
        attachments: attachmentCount,
        avatar: avatarRemoved,
        computerArtifacts: computerArtifacts.length,
        surface: true,
        nativeSessions: nativeRemoved,
      },
      nativeSessionCleanup: { supported: nativeSupported, skipped: nativeSkipped },
      failures: [],
    };

    try {
      const commit = this.db.transaction(() => {
        this.db.query(
          `DELETE FROM events WHERE
             (aggregate_type = 'bot' AND aggregate_id = ?)
             OR (aggregate_type = 'computer' AND aggregate_id = ?)
             OR (aggregate_type = 'thread' AND aggregate_id IN (SELECT id FROM threads WHERE bot_id = ?))
             OR (aggregate_type = 'turn' AND aggregate_id IN (SELECT id FROM turns WHERE bot_id = ?))`,
        ).run(botId, bot.surface_id, botId, botId);
        this.db.query(`DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE bot_id = ?)`).run(botId);
        this.db.query(`DELETE FROM attachments WHERE bot_id = ?`).run(botId);
        this.db.query(`DELETE FROM thread_sessions WHERE thread_id IN (SELECT id FROM threads WHERE bot_id = ?)`).run(botId);
        this.db.query(`DELETE FROM turns WHERE bot_id = ?`).run(botId);
        this.db.query(`DELETE FROM artifacts WHERE surface_id = ?`).run(bot.surface_id);
        this.db.query(`DELETE FROM input_diagnostics WHERE surface_id = ?`).run(bot.surface_id);
        this.db.query(`DELETE FROM threads WHERE bot_id = ?`).run(botId);
        this.db.query(`DELETE FROM bot_state WHERE bot_id = ?`).run(botId);
        this.db.query(`DELETE FROM bot_native_session_deletions WHERE bot_id = ?`).run(botId);
        this.db.query(`DELETE FROM bot_deletions WHERE bot_id = ?`).run(botId);
        this.db.query(`DELETE FROM bot_surfaces WHERE surface_id = ?`).run(bot.surface_id);
        this.db.query(`DELETE FROM bots WHERE id = ?`).run(botId);
        this.events.append("bot", botId, "bot.deleted", { ...deleted, surfaceId: bot.surface_id });
      });
      commit();
      return deleted;
    } catch (error) {
      const databaseFailure: DeleteBotFailureDto = { stage: "database", resource: botId, message: errorMessage(error) };
      this.#recordFailure(botId, [databaseFailure]);
      return {
        ...deleted,
        status: "failed",
        removed: { ...deleted.removed, threads: 0, messages: 0, turns: 0, surface: false },
        failures: [databaseFailure],
      };
    }
  }

  #count(sql: string, botId: string): number {
    const row = this.db.query(sql).get(botId) as CountRow;
    return row.count;
  }

  #claim(botId: string): void {
    const existing = this.db.query(`SELECT state FROM bot_deletions WHERE bot_id = ?`).get(botId) as { state: string } | null;
    if (existing?.state === "cleaning") throw new HttpError(409, "permanent deletion is already in progress");
    const now = new Date().toISOString();
    this.db.query(
      `INSERT INTO bot_deletions (bot_id, state, failure_json, started_at, updated_at)
       VALUES (?, 'cleaning', NULL, ?, ?)
       ON CONFLICT(bot_id) DO UPDATE SET state='cleaning', failure_json=NULL, started_at=excluded.started_at, updated_at=excluded.updated_at`,
    ).run(botId, now, now);
  }

  #recordFailure(botId: string, failures: readonly DeleteBotFailureDto[]): void {
    this.db.query(`UPDATE bot_deletions SET state='failed', failure_json=?, updated_at=? WHERE bot_id = ?`)
      .run(JSON.stringify(failures), new Date().toISOString(), botId);
  }
}
