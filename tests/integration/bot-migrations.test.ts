import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { MIGRATIONS, openDb } from "../../apps/daemon/src/persistence/db.ts";
import { renderAvatarRecipe } from "../../apps/web/src/components/avatarRenderer.ts";
import { AVATAR_RENDERER_ID, AvatarRecipeDto } from "../../packages/protocol/src/index.ts";
import { api, startDaemon, type Harness } from "./helpers/harness.ts";

function databaseThrough(migrationName: string): { db: Database; dbPath: string; home: string } {
  const home = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-migrations-"));
  const dbPath = path.join(home, "db.sqlite");
  const db = new Database(dbPath, { create: true });
  db.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);

  let found = false;
  for (const migration of MIGRATIONS) {
    db.exec(migration.sql);
    db.query(`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`).run(migration.name, "2026-09-01T00:00:00.000Z");
    if (migration.name === migrationName) {
      found = true;
      break;
    }
  }
  if (!found) {
    db.close();
    rmSync(home, { recursive: true, force: true });
    throw new Error(`migration ${migrationName} is unavailable`);
  }
  return { db, dbPath, home };
}

function finishMigrations(db: Database, dbPath: string): Database {
  db.close();
  return openDb({ dbPath } as never);
}

describe("integration: Bot provenance migrations", () => {
  test("preserves Bot provenance while replacing every legacy avatar recipe", () => {
    const { db, dbPath, home } = databaseThrough("0004-contract-legacy-runtime");
    const now = "2026-09-01T00:02:00.000Z";
    const userRecipe = ` {"rendererVersion":"9.4.3", "style":"micah", "seed":"changed-legacy-seed", "options":{"backgroundColor":["ff0000"],"flip":true}} `;
    const conversationRecipe = `{"options":{"radius":12},"seed":"bot_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","style":"shapes","rendererVersion":"9.4.3"}`;
    const configRecipe = `{"rendererVersion":"9.4.3","style":"pixel-art","seed":"configured-seed","options":{"scale":91}}`;
    const ambiguousRecipe = `{"rendererVersion":"9.4.3","style":"shapes","seed":"unknown-origin","options":{}}`;

    try {
      db.query(`INSERT INTO agents (id, display_name, status, updated_at) VALUES ('pi', 'Pi', 'ready', ?)`).run(now);
      db.query(
        `INSERT INTO bots (id, name, instructions, agent_id, avatar_kind, avatar_recipe, created_at, updated_at)
         VALUES ('bot_user', 'Pi', '', 'pi', 'generated', ?, ?, ?),
                ('bot_shape_only', 'Pi', '', 'pi', 'generated', '{"rendererVersion":"9.4.3","style":"shapes","seed":"bot_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","options":{}}', ?, ?),
                ('bot_ambiguous', 'Pi', '', 'pi', 'generated', ?, ?, ?),
                ('bot_conversation', 'Pi', '', 'pi', 'generated', ?, ?, ?),
                ('bot_config', 'Pi', 'Keep this profile configuration', 'pi', 'recipe', ?, ?, ?)`,
      ).run(userRecipe, now, now, now, now, ambiguousRecipe, now, now, conversationRecipe, now, now, configRecipe, now, now);
      db.query(`INSERT INTO bot_state (bot_id) VALUES ('bot_user')`).run();
      db.query(
        `INSERT INTO threads (id, bot_id, title, created_at, updated_at)
         VALUES ('thread_legacy', 'bot_conversation', 'Data-bearing legacy conversation', ?, ?)`,
      ).run(now, now);

      const migrated = finishMigrations(db, dbPath);
      try {
        const bots = migrated.query<{ id: string; provenance: string; avatar_recipe: string }, []>(
          `SELECT id, provenance, avatar_recipe FROM bots ORDER BY id`,
        ).all();
        expect(bots.map((bot) => [bot.id, bot.provenance])).toEqual([
          ["bot_ambiguous", "user_created"],
          ["bot_config", "legacy_conversation"],
          ["bot_conversation", "legacy_conversation"],
          ["bot_shape_only", "user_created"],
          ["bot_user", "user_created"],
        ]);
        for (const bot of bots) {
          expect(AvatarRecipeDto.parse(JSON.parse(bot.avatar_recipe))).toEqual({
            rendererVersion: AVATAR_RENDERER_ID,
            style: "pixelbot",
            seed: bot.id,
            options: {},
          });
        }
      } finally {
        migrated.close();
      }
    } finally {
      try {
        db.close();
      } catch {
        // finishMigrations already closed the setup connection.
      }
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("resets unsupported generated recipes to the sole current renderer", () => {
    const { db, dbPath, home } = databaseThrough("0008-staged-attachment-draft-ownership");
    const now = "2026-09-01T00:02:00.000Z";
    const currentRenderer = AVATAR_RENDERER_ID;

    try {
      db.query(`INSERT INTO agents (id, display_name, status, updated_at) VALUES ('pi', 'Pi', 'ready', ?)`).run(now);
      db.query(
        `INSERT INTO bots (id, name, instructions, agent_id, avatar_kind, avatar_recipe, created_at, updated_at)
         VALUES ('bot_legacy', 'Legacy', '', 'pi', 'recipe', '{"rendererVersion":"9.4.3","style":"micah","seed":"old-seed","options":{"flip":true}}', ?, ?),
                ('bot_current', 'Current', '', 'pi', 'recipe', '{"rendererVersion":"dicebear-core@10.7.0+styles@10.6.0","style":"thumbs","seed":"current-seed","options":{}}', ?, ?)`,
      ).run(now, now, now, now);

      const migrated = finishMigrations(db, dbPath);
      try {
        const bots = migrated.query<{ id: string; avatar_kind: string; avatar_recipe: string }, []>(
          `SELECT id, avatar_kind, avatar_recipe FROM bots ORDER BY id`,
        ).all();
        expect(bots).toEqual([
          {
            id: "bot_current",
            avatar_kind: "recipe",
            avatar_recipe: `{"rendererVersion":"${currentRenderer}","style":"thumbs","seed":"current-seed","options":{}}`,
          },
          {
            id: "bot_legacy",
            avatar_kind: "generated",
            avatar_recipe: `{"rendererVersion":"${currentRenderer}","style":"pixelbot","seed":"bot_legacy","options":{}}`,
          },
        ]);
      } finally {
        migrated.close();
      }
    } finally {
      try {
        db.close();
      } catch {
        // finishMigrations already closed the setup connection.
      }
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("repairs shorthand v10 avatar recipes after old 0005 was already recorded", () => {
    const { db, dbPath, home } = databaseThrough("0005-created-bots-animated-avatars");
    const now = "2026-09-01T00:02:00.000Z";
    const shorthandRecipe = ` {"options":{"title":"kept"},"seed":"already-upgraded","style":"pixelbot","rendererVersion":"10.7.0"} `;

    try {
      db.query(`INSERT INTO agents (id, display_name, status, updated_at) VALUES ('pi', 'Pi', 'ready', ?)`).run(now);
      db.query(
        `INSERT INTO bots (id, name, instructions, agent_id, avatar_kind, avatar_recipe, created_at, updated_at)
         VALUES ('bot_existing', 'Existing Bot', 'Retain me', 'pi', 'generated', ?, ?, ?)`,
      ).run(shorthandRecipe, now, now);

      const migrated = finishMigrations(db, dbPath);
      try {
        const row = migrated.query<{ avatar_recipe: string }, []>(
          `SELECT avatar_recipe FROM bots WHERE id = 'bot_existing'`,
        ).get();
        const repaired = AvatarRecipeDto.parse(JSON.parse(row!.avatar_recipe));
        expect(repaired).toEqual({
          options: { title: "kept" },
          seed: "already-upgraded",
          style: "pixelbot",
          rendererVersion: AVATAR_RENDERER_ID,
        });
        expect(renderAvatarRecipe(repaired, "static")).not.toBeUndefined();
        expect(
          migrated.query(`SELECT name FROM schema_migrations WHERE name = '0005-created-bots-animated-avatars'`).get(),
        ).not.toBeNull();
      } finally {
        migrated.close();
      }
    } finally {
      try {
        db.close();
      } catch {
        // finishMigrations already closed the setup connection.
      }
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("legacy enabled state alone never creates a Sidebar Bot", () => {
    const { db, dbPath, home } = databaseThrough("0001-initial");
    const now = "2026-09-01T00:02:00.000Z";

    try {
      db.query(
        `INSERT INTO bots (id, display_name, status, default_cwd, enabled, created_at, updated_at)
         VALUES ('pi', 'Pi', 'ready', '', 1, ?, ?),
                ('claude', 'Claude', 'ready', '/workspace/from-legacy-profile', 0, ?, ?)`,
      ).run(now, now, now, now);
      db.query(
        `INSERT INTO roles (id, bot_id, name, instructions, memory_scope_id, created_at, updated_at)
         VALUES ('default', 'claude', 'Default', '', 'role:claude:default', ?, ?)`,
      ).run(now, now);

      const migrated = finishMigrations(db, dbPath);
      try {
        const bots = migrated.query<{ agent_id: string; provenance: string; avatar_recipe: string }, []>(
          `SELECT agent_id, provenance, avatar_recipe FROM bots`,
        ).all();
        expect(bots).toHaveLength(1);
        expect(bots[0]?.agent_id).toBe("claude");
        expect(bots[0]?.provenance).toBe("legacy_conversation");
        expect(JSON.parse(bots[0]!.avatar_recipe)).toMatchObject({
          rendererVersion: AVATAR_RENDERER_ID,
          style: "pixelbot",
          options: {},
        });
      } finally {
        migrated.close();
      }
    } finally {
      try {
        db.close();
      } catch {
        // finishMigrations already closed the setup connection.
      }
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("integration: archived Bot cutover", () => {
  test("restores every legacy Bot, preserves owned data, and removes obsolete lifecycle storage", async () => {
    const { db, home } = databaseThrough("0009-current-avatar-renderer-only");
    const now = "2026-09-01T00:02:00.000Z";
    const botId = "bot_archived_legacy";
    const threadId = "thread_archived_legacy";
    const attachmentId = "att_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const attachmentRelPath = path.join("managed", attachmentId);
    const avatarFile = `${botId}.png`;
    const visibleRecipe = JSON.stringify({
      rendererVersion: AVATAR_RENDERER_ID,
      style: "pixelbot",
      seed: "bot_visible_legacy",
      options: {},
    });
    const archivedShapesRecipe =
      ` {"options":{},"seed":"preserved-shape-seed","style":"shapes","rendererVersion":"${AVATAR_RENDERER_ID}"} `;
    let h: Harness | undefined;

    try {
      db.query(`INSERT INTO agents (id, display_name, status, updated_at) VALUES ('pi', 'Pi', 'ready', ?)`).run(now);
      db.query(
        `INSERT INTO bots (
           id, name, instructions, agent_id, avatar_kind, avatar_recipe, avatar_file,
           pinned, archived, archived_at, created_at, updated_at, provenance
         ) VALUES (?, 'Recovered teammate', 'Keep these instructions', 'pi', 'upload', '', ?, 1, 1, ?, ?, ?, 'user_created')`,
      ).run(botId, avatarFile, now, now, now);
      db.query(
        `INSERT INTO bots (
           id, name, instructions, agent_id, avatar_kind, avatar_recipe, avatar_file,
           pinned, archived, archived_at, created_at, updated_at, provenance
         ) VALUES (
           'bot_visible_legacy', 'Previously visible teammate', '', 'pi', 'generated', ?,
           NULL, 1, 0, NULL, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', 'user_created'
         )`,
      ).run(visibleRecipe);
      db.query(
        `INSERT INTO bots (
           id, name, instructions, agent_id, avatar_kind, avatar_recipe, avatar_file,
           pinned, archived, archived_at, created_at, updated_at, provenance
         ) VALUES (
           'bot_archived_shapes', 'Recovered Shapes', 'Keep this Shapes identity', 'pi',
           'recipe', ?, NULL, 0, 1, ?, '2026-07-01T00:00:00.000Z', ?, 'user_created'
         )`,
      ).run(archivedShapesRecipe, now, now);
      db.query(
        `INSERT INTO bot_state (bot_id, last_activity_at)
         VALUES ('bot_archived_shapes', '2026-07-01T00:00:00.000Z')`,
      ).run();
      db.query(
        `INSERT INTO bot_state (bot_id, last_activity_at)
         VALUES ('bot_visible_legacy', '2026-08-01T00:00:00.000Z')`,
      ).run();
      db.query(
        `INSERT INTO bot_state (
           bot_id, last_activity_at, preview_text, preview_at, unread_count, unread_thread_id
         ) VALUES (?, ?, 'Preserved preview', ?, 1, ?)`,
      ).run(botId, now, now, threadId);
      db.query(
        `INSERT INTO threads (id, bot_id, title, cwd, created_at, updated_at)
         VALUES (?, ?, 'Preserved conversation', '/tmp/preserved', ?, ?)`,
      ).run(threadId, botId, now, now);
      db.query(
        `INSERT INTO messages (id, thread_id, seq, author_kind, kind, text, payload, created_at)
         VALUES ('message_archived_legacy', ?, 1, 'user', 'text', 'Preserved message', NULL, ?)`,
      ).run(threadId, now);
      db.query(
        `INSERT INTO turns (
           id, thread_id, bot_id, status, worker_session_id, native_session_id,
           steer_count, started_at, finished_at, outcome_reason
         ) VALUES ('turn_archived_legacy', ?, ?, 'completed', 'worker-legacy', 'native-legacy', 0, ?, ?, NULL)`,
      ).run(threadId, botId, now, now);
      db.query(
        `INSERT INTO thread_sessions (thread_id, native_session_id, updated_at)
         VALUES (?, 'native-legacy', ?)`,
      ).run(threadId, now);
      db.query(
        `INSERT INTO attachments (
           id, kind, bot_id, thread_id, message_id, name, media_type, size,
           rel_path, source_sha256, created_at, draft_token
         ) VALUES (?, 'managed', ?, ?, 'message_archived_legacy', 'preserved.txt',
           'text/plain', 15, ?, 'legacy-sha', ?, NULL)`,
      ).run(attachmentId, botId, threadId, attachmentRelPath, now);
      db.query(
        `INSERT INTO bot_deletions (bot_id, state, failure_json, started_at, updated_at)
         VALUES (?, 'failed', ?, ?, ?)`,
      ).run(
        botId,
        JSON.stringify([
          { stage: "native_session", resource: "native-checkpoint", message: "obsolete native retry" },
          { stage: "database", resource: botId, message: "preserved local retry" },
        ]),
        now,
        now,
      );
      db.query(
        `INSERT INTO bot_native_session_deletions (bot_id, native_session_id, deleted_at)
         VALUES (?, 'native-checkpoint', ?)`,
      ).run(botId, now);
      db.query(
        `INSERT INTO events (
           event_id, schema_version, occurred_at, aggregate_type, aggregate_id, type, payload
         ) VALUES
           ('event-archived', 1, ?, 'bot', ?, 'bot.archived', '{}'),
           ('event-restored', 1, ?, 'bot', ?, 'bot.restored', '{}'),
           ('event-profile', 1, ?, 'bot', ?, 'bot.updated', '{"name":"Recovered teammate"}')`,
      ).run(now, botId, now, botId, now, botId);

      mkdirSync(path.join(home, "avatars"), { recursive: true });
      mkdirSync(path.join(home, "attachments", "managed"), { recursive: true });
      writeFileSync(path.join(home, "avatars", avatarFile), "preserved avatar");
      writeFileSync(path.join(home, "attachments", attachmentRelPath), "preserved bytes");
      db.close();

      h = await startDaemon(home);
      const bots = await api<Array<Record<string, unknown>>>(h, "GET", "/api/bots");
      expect(bots.map((bot) => bot.id)).toEqual([botId, "bot_visible_legacy", "bot_archived_shapes"]);
      expect(bots[0]).toMatchObject({
        id: botId,
        name: "Recovered teammate",
        instructions: "Keep these instructions",
        pinned: true,
        lastActivityAt: now,
        status: "inactive",
        previewText: "Preserved preview",
      });
      for (const bot of bots) expect(bot).not.toHaveProperty("archived");

      const shapesRow = h.svc.db
        .query(`SELECT avatar_recipe FROM bots WHERE id = 'bot_archived_shapes'`)
        .get() as { avatar_recipe: string } | null;
      expect(shapesRow?.avatar_recipe).toBe(archivedShapesRecipe);
      const shapesRecipe = AvatarRecipeDto.parse(JSON.parse(shapesRow!.avatar_recipe));
      expect(bots.find((bot) => bot.id === "bot_archived_shapes")).toMatchObject({
        name: "Recovered Shapes",
        instructions: "Keep this Shapes identity",
        avatar: { kind: "recipe", recipe: shapesRecipe },
      });
      expect(renderAvatarRecipe(shapesRecipe, "static")).not.toBeUndefined();

      const threads = await api<Array<Record<string, unknown>>>(h, "GET", `/api/bots/${botId}/threads`);
      expect(threads).toContainEqual(expect.objectContaining({ id: threadId, title: "Preserved conversation" }));
      const messages = await api<Array<Record<string, unknown>>>(h, "GET", `/api/threads/${threadId}/messages`);
      expect(messages).toContainEqual(expect.objectContaining({ text: "Preserved message" }));
      expect(h.svc.threads.getNativeSession(threadId)).toBe("native-legacy");

      const attachment = await fetch(`${h.baseUrl}/api/attachments/${attachmentId}`);
      expect(attachment.status).toBe(200);
      expect(await attachment.text()).toBe("preserved bytes");
      const avatar = await fetch(`${h.baseUrl}/api/bots/${botId}/avatar`);
      expect(avatar.status).toBe(200);
      expect(await avatar.text()).toBe("preserved avatar");

      const columns = h.svc.db.query<{ name: string }, []>(`PRAGMA table_info(bots)`).all().map((column) => column.name);
      expect(columns).not.toContain("archived");
      expect(columns).not.toContain("archived_at");
      const tables = h.svc.db
        .query<{ name: string }, []>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
        .all()
        .map((table) => table.name);
      expect(tables).not.toContain("bot_native_session_deletions");
      const deletionRetry = h.svc.db
        .query<{ failure_json: string | null }, [string]>(
          `SELECT failure_json FROM bot_deletions WHERE bot_id = ?`,
        )
        .get(botId);
      expect(JSON.parse(deletionRetry?.failure_json ?? "null")).toEqual([
        { stage: "database", resource: botId, message: "preserved local retry" },
      ]);
      expect(
        h.svc.db.query(`SELECT type FROM events WHERE aggregate_id = ? ORDER BY type`).all(botId) as { type: string }[],
      ).toEqual([{ type: "bot.updated" }]);
    } finally {
      if (h !== undefined) await h.stop();
      else {
        try {
          db.close();
        } catch {
          // The setup connection was already closed before daemon startup.
        }
      }
      rmSync(home, { recursive: true, force: true });
    }
  });
});
