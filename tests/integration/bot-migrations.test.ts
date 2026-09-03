import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { MIGRATIONS, openDb } from "../../apps/daemon/src/persistence/db.ts";
import { renderAvatarRecipe } from "../../apps/web/src/components/avatarRenderer.ts";
import { AvatarRecipeDto } from "../../packages/protocol/src/index.ts";

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
  test("preserves shape-only ambiguity while classifying proven user ownership", () => {
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
        expect(bots.find((bot) => bot.id === "bot_user")?.avatar_recipe).toBe(userRecipe);
        expect(AvatarRecipeDto.parse(JSON.parse(bots.find((bot) => bot.id === "bot_user")!.avatar_recipe))).toEqual({
          rendererVersion: "9.4.3",
          style: "micah",
          seed: "changed-legacy-seed",
          options: { backgroundColor: ["ff0000"], flip: true },
        });
        expect(bots.find((bot) => bot.id === "bot_conversation")?.avatar_recipe).toBe(conversationRecipe);
        expect(bots.find((bot) => bot.id === "bot_config")?.avatar_recipe).toBe(configRecipe);
        expect(bots.find((bot) => bot.id === "bot_ambiguous")?.avatar_recipe).toBe(ambiguousRecipe);
        expect(bots.find((bot) => bot.id === "bot_shape_only")?.avatar_recipe).toBe(
          '{"rendererVersion":"9.4.3","style":"shapes","seed":"bot_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","options":{}}',
        );
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
    const shorthandRecipe = ` {"options":{"title":"kept"},"seed":"already-upgraded","style":"shapes","rendererVersion":"10.7.0"} `;

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
          style: "shapes",
          rendererVersion: "dicebear-core@10.7.0+styles@10.6.0",
        });
        expect(renderAvatarRecipe(repaired, "idle")).not.toBeUndefined();
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
        expect(JSON.parse(bots[0]!.avatar_recipe)).toMatchObject({ rendererVersion: "9.4.3", style: "shapes", options: {} });
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
