import type { Database } from "bun:sqlite";
import type { DeleteBotFailureDto, DeleteBotResultDto, TurnDto } from "@omarchy-bot/protocol";
import type { AttachmentsService } from "../attachments/attachments.ts";
import type { AvatarService } from "../avatars/avatarService.ts";
import type { EventLog } from "../events/eventLog.ts";
import { HttpError } from "./bots.ts";

interface DeletionBotRow {
  name: string;
  avatar_kind: string;
  avatar_file: string | null;
}

interface CountRow {
  count: number;
}
interface BotComputerCleanup {
  removeBot(botId: string): void;
  resumeQueueAfterBotRemoval(): void;
}
interface BotTurnAborter {
  abortTurn(turnId: string, reason: string): Promise<void>;
  waitForTerminal(turnId: string, timeoutMs?: number): Promise<TurnDto>;
}
interface BotThreadTurns {
  activeTurnIdsForBot(botId: string): string[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Coordinates irreversible Bot-owned cleanup. Filesystem work finishes before
 * the SQLite delete transaction, so any local failure keeps a visible Bot
 * record that can be retried without claiming success. Agent workers and
 * Agent-owned Native Sessions are deliberately outside this boundary.
 */
export class BotDeletionService {
  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly attachments: AttachmentsService,
    private readonly avatars: AvatarService,
    private readonly turns: BotTurnAborter,
    private readonly threads: BotThreadTurns,
    private readonly computer: BotComputerCleanup,
    private readonly terminalWaitTimeoutMs = 30_000,
  ) {}

  async delete(botId: string): Promise<DeleteBotResultDto> {
    const bot = this.db.query(`SELECT name, avatar_kind, avatar_file FROM bots WHERE id = ?`)
      .get(botId) as DeletionBotRow | null;
    if (bot === null) throw new HttpError(404, `unknown bot ${botId}`);

    this.#claim(botId);

    const activeTurnIds = this.threads.activeTurnIdsForBot(botId);

    if (activeTurnIds.length > 0) {
      const cancellationResults = await Promise.allSettled(
        activeTurnIds.map((turnId) => this.turns.abortTurn(turnId, "bot deleted")),
      );
      const cancellationFailures = cancellationResults.flatMap((result, index) =>
        result.status === "rejected"
          ? [{
              stage: "turn_cancellation" as const,
              resource: activeTurnIds[index]!,
              message: errorMessage(result.reason),
            }]
          : []);
      if (cancellationFailures.length > 0) {
        return this.#barrierFailure(botId, bot.name, cancellationFailures);
      }

      const terminalResults = await Promise.allSettled(
        activeTurnIds.map((turnId) => this.turns.waitForTerminal(turnId, this.terminalWaitTimeoutMs)),
      );
      const terminalFailures = terminalResults.flatMap((result, index) =>
        result.status === "rejected"
          ? [{
              stage: "terminal_wait" as const,
              resource: activeTurnIds[index]!,
              message: errorMessage(result.reason),
            }]
          : []);
      const stillActive = this.threads.activeTurnIdsForBot(botId);
      for (const turnId of stillActive) {
        if (terminalFailures.some((failure) => failure.resource === turnId)) continue;
        terminalFailures.push({
          stage: "terminal_wait",
          resource: turnId,
          message: `turn ${turnId} remained active after cancellation`,
        });
      }
      if (terminalFailures.length > 0) {
        return this.#barrierFailure(botId, bot.name, terminalFailures);
      }
    }

    try {
      this.computer.removeBot(botId);
    } catch (error) {
      return this.#barrierFailure(botId, bot.name, [{
        stage: "database",
        resource: botId,
        message: `computer state cleanup failed: ${errorMessage(error)}`,
      }]);
    }


    const threadCount = this.#count(`SELECT COUNT(*) AS count FROM threads WHERE bot_id = ?`, botId);
    const messageCount = this.#count(
      `SELECT COUNT(*) AS count FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE bot_id = ?)`,
      botId,
    );
    const turnCount = this.#count(`SELECT COUNT(*) AS count FROM turns WHERE bot_id = ?`, botId);
    const attachmentCount = this.#count(`SELECT COUNT(*) AS count FROM attachments WHERE bot_id = ?`, botId);

    let attachmentFilesRemoved = 0;
    let avatarRemoved = false;
    const failures: DeleteBotFailureDto[] = [];

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
        },
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
      },
      failures: [],
    };

    try {
      const commit = this.db.transaction(() => {
        this.db.query(
          `DELETE FROM events WHERE
             (aggregate_type = 'bot' AND aggregate_id = ?)
             OR (aggregate_type = 'thread' AND aggregate_id IN (SELECT id FROM threads WHERE bot_id = ?))
             OR (aggregate_type = 'turn' AND aggregate_id IN (SELECT id FROM turns WHERE bot_id = ?))
             OR (
               aggregate_type = 'computer'
               AND (
                 aggregate_id = ?
                 OR json_extract(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END, '$.botId') = ?
               )
             )`,
        ).run(botId, botId, botId, botId, botId);
        this.db.query(`DELETE FROM messages WHERE thread_id IN (SELECT id FROM threads WHERE bot_id = ?)`).run(botId);
        this.db.query(`DELETE FROM attachments WHERE bot_id = ?`).run(botId);
        this.db.query(`DELETE FROM thread_sessions WHERE thread_id IN (SELECT id FROM threads WHERE bot_id = ?)`).run(botId);
        this.db.query(`DELETE FROM turns WHERE bot_id = ?`).run(botId);
        this.db.query(`DELETE FROM computer_leases WHERE holder_bot_id = ?`).run(botId);
        this.db.query(`DELETE FROM threads WHERE bot_id = ?`).run(botId);
        this.db.query(`DELETE FROM bot_state WHERE bot_id = ?`).run(botId);
        this.db.query(`DELETE FROM bot_deletions WHERE bot_id = ?`).run(botId);
        this.db.query(`DELETE FROM bots WHERE id = ?`).run(botId);
        this.events.append("bot", botId, "bot.deleted", deleted);
      });
      commit();
    } catch (error) {
      const databaseFailure: DeleteBotFailureDto = { stage: "database", resource: botId, message: errorMessage(error) };
      this.#recordFailure(botId, [databaseFailure]);
      return {
        ...deleted,
        status: "failed",
        removed: { ...deleted.removed, threads: 0, messages: 0, turns: 0 },
        failures: [databaseFailure],
      };
    }
    this.computer.resumeQueueAfterBotRemoval();
    return deleted;
  }

  #count(sql: string, botId: string): number {
    const row = this.db.query(sql).get(botId) as CountRow;
    return row.count;
  }


  #barrierFailure(
    botId: string,
    botName: string,
    failures: DeleteBotFailureDto[],
  ): DeleteBotResultDto {
    this.#recordFailure(botId, failures);
    return {
      status: "failed",
      botId,
      botName,
      removed: {
        threads: 0,
        messages: 0,
        turns: 0,
        attachments: 0,
        avatar: false,
      },
      failures,
    };
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
