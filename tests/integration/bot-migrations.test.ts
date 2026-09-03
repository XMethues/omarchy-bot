import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { applyMigration, MIGRATIONS, openDb } from "../../apps/daemon/src/persistence/db.ts";
import { renderAvatarRecipe } from "../../apps/web/src/components/avatarRenderer.ts";
import { AVATAR_RENDERER_ID, AvatarRecipeDto } from "../../packages/protocol/src/index.ts";
import { api, startDaemon, type Harness } from "./helpers/harness.ts";
import { BotScreenManager } from "../../apps/daemon/src/modules/computer/botScreenManager.ts";
import { FakeBotScreenRuntimeAdapter } from "../../apps/daemon/src/modules/computer/fakeBotScreenRuntime.ts";

function databaseThrough(migrationName: string): { db: Database; dbPath: string; home: string; artifactsDir: string } {
  const home = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-migrations-"));
  const dbPath = path.join(home, "db.sqlite");
  const artifactsDir = path.join(home, "artifacts");
  mkdirSync(artifactsDir);
  const db = new Database(dbPath, { create: true });
  db.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);

  let found = false;
  for (const migration of MIGRATIONS) {
    applyMigration(db, migration, { artifactsDir });
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
  return { db, dbPath, home, artifactsDir };
}

function finishMigrations(db: Database, dbPath: string): Database {
  db.close();
  return openDb({ dbPath, artifactsDir: path.join(path.dirname(dbPath), "artifacts") } as never);
}

function deployedArchivelessDatabase(): { dbPath: string; home: string } {
  const { db, dbPath, home } = databaseThrough("0012-bot-screen-contract");
  const appliedAt = "2026-09-03T18:20:46.736Z";
  db.exec(`
    ALTER TABLE bots DROP COLUMN archived_at;
    ALTER TABLE bots DROP COLUMN archived;
    DROP TABLE bot_native_session_deletions;
  `);
  const divergentLedger = [
    "0010-agent-oriented-avatar-styles",
    "0011-remove-bot-archive-lifecycle",
    "0012-remove-native-session-deletion-checkpoints",
  ];
  const recordMigration = db.query(`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`);
  for (const name of divergentLedger) recordMigration.run(name, appliedAt);
  db.query(`INSERT INTO agents (id, display_name, status, updated_at) VALUES ('pi', 'Pi', 'ready', ?)`).run(appliedAt);
  db.query(
    `INSERT INTO bots (id, name, instructions, agent_id, avatar_recipe, created_at, updated_at, provenance)
     VALUES ('bot_existing', 'Existing Bot', 'Preserve these instructions', 'pi', '{}', ?, ?, 'legacy_conversation')`,
  ).run(appliedAt, appliedAt);
  db.query(
    `INSERT INTO bot_surfaces (
       surface_id, bot_id, lifecycle_state, runtime_generation, transitioned_at
     ) VALUES ('surf_11111111111111111111111111111111', 'bot_existing', 'ready', 4, ?)`,
  ).run(appliedAt);
  db.query(
    `INSERT INTO threads (id, bot_id, title, created_at, updated_at)
     VALUES ('thread_existing', 'bot_existing', 'Preserved thread', ?, ?)`,
  ).run(appliedAt, appliedAt);
  db.query(
    `INSERT INTO messages (id, thread_id, seq, author_kind, kind, text, created_at)
     VALUES ('message_existing', 'thread_existing', 1, 'user', 'text', 'Preserved message', ?)`,
  ).run(appliedAt);
  db.query(`INSERT INTO bot_state (bot_id, preview_text) VALUES ('bot_existing', 'Preserved preview')`).run();
  db.close();
  return { dbPath, home };
}

describe("integration: deployed schema convergence", () => {
  test("restores deletion, archive, and avatar contracts before Bot Screen recovery", async () => {
    const { dbPath, home } = deployedArchivelessDatabase();
    const artifactsDir = path.join(home, "artifacts");
    const droppedRowArtifact = path.join(artifactsDir, "snapshot-dropped-row.png");
    const unrelatedArtifactDirFile = path.join(artifactsDir, "operator-note.txt");
    const externalFile = path.join(home, "snapshot-external.png");
    writeFileSync(droppedRowArtifact, "orphaned legacy snapshot");
    writeFileSync(unrelatedArtifactDirFile, "not a managed snapshot");
    writeFileSync(externalFile, "outside configured artifact ownership");
    const db = openDb({ dbPath, artifactsDir } as never);
    const adapter = new FakeBotScreenRuntimeAdapter();
    const screens = new BotScreenManager(db, adapter, {
      capacity: 1,
      logicalWidth: 1920,
      logicalHeight: 1080,
    });

    try {
      await screens.recover();
      expect(existsSync(droppedRowArtifact)).toBeFalse();
      expect(existsSync(unrelatedArtifactDirFile)).toBeTrue();
      expect(existsSync(externalFile)).toBeTrue();
      expect(
        db.query(
          `SELECT id, name, instructions, agent_id, provenance, archived, archived_at
           FROM bots WHERE id = 'bot_existing'`,
        ).get(),
      ).toEqual({
        id: "bot_existing",
        name: "Existing Bot",
        instructions: "Preserve these instructions",
        agent_id: "pi",
        provenance: "legacy_conversation",
        archived: 0,
        archived_at: null,
      });
      expect(
        db.query(
          `SELECT threads.title, messages.text
           FROM threads JOIN messages ON messages.thread_id = threads.id
           WHERE threads.bot_id = 'bot_existing'`,
        ).get(),
      ).toEqual({ title: "Preserved thread", text: "Preserved message" });
      const avatar = db.query<{ avatar_recipe: string }, []>(
        `SELECT avatar_recipe FROM bots WHERE id = 'bot_existing'`,
      ).get();
      expect(AvatarRecipeDto.parse(JSON.parse(avatar!.avatar_recipe))).toEqual({
        rendererVersion: AVATAR_RENDERER_ID,
        style: "shapes",
        seed: "bot_existing",
        options: {},
      });
      db.query(
        `INSERT INTO bot_native_session_deletions (bot_id, native_session_id, deleted_at)
         VALUES ('bot_existing', 'native-existing', '2026-09-03T18:21:00.000Z')`,
      ).run();
      expect(
        db.query(`SELECT native_session_id FROM bot_native_session_deletions WHERE bot_id = 'bot_existing'`).get(),
      ).toEqual({ native_session_id: "native-existing" });
      expect(() => db.query(
        `INSERT INTO bot_native_session_deletions (bot_id, native_session_id, deleted_at)
         VALUES ('bot_existing', 'native-existing', '2026-09-03T18:22:00.000Z')`,
      ).run()).toThrow();
      expect(() => db.query(
        `INSERT INTO bot_native_session_deletions (bot_id, native_session_id, deleted_at)
         VALUES ('bot_missing', 'native-missing', '2026-09-03T18:22:00.000Z')`,
      ).run()).toThrow();
      expect(
        db.query(
          `SELECT authority_kind, controller_epoch
           FROM computer_surface_coordination
           WHERE surface_id = 'surf_11111111111111111111111111111111'`,
        ).get(),
      ).toEqual({ authority_kind: "idle", controller_epoch: 0 });
      expect(() => db.query(
        `UPDATE computer_surface_coordination SET authority_kind = 'unknown'
         WHERE surface_id = 'surf_11111111111111111111111111111111'`,
      ).run()).toThrow();
      expect(
        db.query(
          `SELECT name FROM schema_migrations
           WHERE name IN ('0013-restore-bot-archive-lifecycle', '0015-converge-bot-screen-persistence')
           ORDER BY name`,
        ).all(),
      ).toEqual([
        { name: "0013-restore-bot-archive-lifecycle" },
        { name: "0015-converge-bot-screen-persistence" },
      ]);
      expect(adapter.starts).toHaveLength(1);
      expect(adapter.starts[0]).toMatchObject({
        surfaceId: "surf_11111111111111111111111111111111",
        generation: 5,
      });
    } finally {
      await screens.shutdown();
      db.close();
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("repeat boot preserves the repaired Bot and permanent deletion clears restored checkpoints", async () => {
    const { home } = deployedArchivelessDatabase();
    let firstDaemon: Harness | undefined;
    let secondDaemon: Harness | undefined;
    try {
      firstDaemon = await startDaemon(home);
      const coordination = firstDaemon.svc.db.query(
        `SELECT authority_kind, controller_epoch
         FROM computer_surface_coordination
         WHERE surface_id = 'surf_11111111111111111111111111111111'`,
      ).get() as { authority_kind: string; controller_epoch: number };
      expect(coordination.authority_kind).toBe("idle");
      expect(Number.isSafeInteger(coordination.controller_epoch)).toBeTrue();
      await firstDaemon.stop();
      firstDaemon = undefined;

      secondDaemon = await startDaemon(home);
      expect(
        secondDaemon.svc.db.query(
          `SELECT id, name, instructions FROM bots WHERE id = 'bot_existing'`,
        ).get(),
      ).toEqual({
        id: "bot_existing",
        name: "Existing Bot",
        instructions: "Preserve these instructions",
      });
      expect(
        secondDaemon.svc.db.query(
          `SELECT COUNT(*) AS count FROM schema_migrations
           WHERE name = '0015-converge-bot-screen-persistence'`,
        ).get(),
      ).toEqual({ count: 1 });
      secondDaemon.svc.db.query(
        `INSERT INTO bot_native_session_deletions (bot_id, native_session_id, deleted_at)
         VALUES ('bot_existing', 'native-checkpoint', '2026-09-03T18:21:00.000Z')`,
      ).run();

      await api(secondDaemon, "POST", "/api/bots/bot_existing/archive", {});
      const deleted = await api<{ status: string }>(
        secondDaemon,
        "DELETE",
        "/api/bots/bot_existing",
        { confirmName: "Existing Bot" },
      );
      expect(deleted.status).toBe("deleted");
      expect(secondDaemon.svc.db.query(`SELECT id FROM bots WHERE id = 'bot_existing'`).get()).toBeNull();
      expect(
        secondDaemon.svc.db.query(
          `SELECT native_session_id FROM bot_native_session_deletions WHERE bot_id = 'bot_existing'`,
        ).get(),
      ).toBeNull();
      expect(
        secondDaemon.svc.db.query(
          `SELECT surface_id FROM computer_surface_coordination
           WHERE surface_id = 'surf_11111111111111111111111111111111'`,
        ).get(),
      ).toBeNull();
      expect(secondDaemon.svc.db.query(`SELECT id FROM agents WHERE id = 'pi'`).get()).toEqual({ id: "pi" });
    } finally {
      await firstDaemon?.stop();
      await secondDaemon?.stop();
      rmSync(home, { recursive: true, force: true });
    }
  }, 15_000);
});

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
            style: "shapes",
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
                ('bot_current', 'Current', '', 'pi', 'recipe', '{"rendererVersion":"dicebear-core@10.7.0+styles@10.6.0","style":"thumbs","seed":"current-seed","options":{}}', ?, ?),
                ('bot_malformed', 'Malformed', '', 'pi', 'generated', '{not-json', ?, ?)`,
      ).run(now, now, now, now, now, now);

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
            avatar_recipe: `{"rendererVersion":"${currentRenderer}","style":"shapes","seed":"bot_legacy","options":{}}`,
          },
          {
            id: "bot_malformed",
            avatar_kind: "generated",
            avatar_recipe: `{"rendererVersion":"${currentRenderer}","style":"shapes","seed":"bot_malformed","options":{}}`,
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
          rendererVersion: AVATAR_RENDERER_ID,
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
        expect(JSON.parse(bots[0]!.avatar_recipe)).toMatchObject({
          rendererVersion: AVATAR_RENDERER_ID,
          style: "shapes",
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

  test("assigns stable Surfaces and removes only owned unscoped artifact files", async () => {
    const { db, dbPath, home, artifactsDir } = databaseThrough("0009-current-avatar-renderer-only");
    const now = "2026-09-01T00:02:00.000Z";
    const ownedLegacyArtifact = path.join(artifactsDir, "snapshot-legacy-artifact.png");
    const externalArtifact = path.join(home, "snapshot-external-artifact.png");
    writeFileSync(ownedLegacyArtifact, "owned legacy image");
    writeFileSync(externalArtifact, "external image");
    const recipe = JSON.stringify({
      rendererVersion: AVATAR_RENDERER_ID,
      style: "shapes",
      seed: "legacy",
      options: {},
    });
    let firstDaemon: Harness | undefined;
    let secondDaemon: Harness | undefined;
    try {
      db.query(`INSERT INTO agents (id, display_name, status, updated_at) VALUES ('pi', 'Pi', 'ready', ?)`).run(now);
      db.query(
        `INSERT INTO bots (id, name, instructions, agent_id, avatar_kind, avatar_recipe, created_at, updated_at)
         VALUES ('bot_11111111111111111111111111111111', 'Migrated one', '', 'pi', 'generated', ?, ?, ?),
                ('bot_22222222222222222222222222222222', 'Migrated two', '', 'pi', 'generated', ?, ?, ?)`,
      ).run(recipe, now, now, recipe, now, now);
      db.query(`INSERT INTO bot_state (bot_id) VALUES (?), (?)`)
        .run("bot_11111111111111111111111111111111", "bot_22222222222222222222222222222222");
      db.query(
        `INSERT INTO artifacts (id, kind, media_type, path, created_at)
         VALUES ('legacy-artifact', 'snapshot', 'image/png', ?, ?),
                ('external-artifact', 'snapshot', 'image/png', ?, ?)`,
      ).run(ownedLegacyArtifact, now, externalArtifact, now);

      const migrated = finishMigrations(db, dbPath);
      const surfaces = migrated
        .query(`SELECT surface_id, bot_id FROM bot_surfaces ORDER BY bot_id`)
        .all() as Array<{ surface_id: string; bot_id: string }>;
      expect(surfaces).toHaveLength(2);
      expect(surfaces[0]!.surface_id).toMatch(/^surf_[0-9a-f]{32}$/);
      expect(surfaces[1]!.surface_id).toMatch(/^surf_[0-9a-f]{32}$/);
      expect(surfaces[1]!.surface_id).not.toBe(surfaces[0]!.surface_id);
      expect(
        migrated.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'computer_leases'`).get(),
      ).toBeNull();
      expect(
        migrated.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_unscoped_artifacts'`).get(),
      ).toBeNull();
      expect(
        (migrated.query(`PRAGMA table_info(artifacts)`).all() as Array<{ name: string; notnull: number }>)
          .find((column) => column.name === "surface_id"),
      ).toMatchObject({ notnull: 1 });
      expect(existsSync(ownedLegacyArtifact)).toBeFalse();
      expect(existsSync(externalArtifact)).toBeTrue();
      migrated.close();

      firstDaemon = await startDaemon(home);
      const firstBootBot = await fetch(`${firstDaemon.baseUrl}/api/bots/bot_11111111111111111111111111111111`)
        .then((response) => response.json()) as { surfaceId: string };
      expect(firstBootBot.surfaceId).toBe(surfaces[0]!.surface_id);
      await firstDaemon.stop();
      firstDaemon = undefined;

      secondDaemon = await startDaemon(home);
      const secondBootBot = await fetch(`${secondDaemon.baseUrl}/api/bots/bot_11111111111111111111111111111111`)
        .then((response) => response.json()) as { surfaceId: string };
      expect(secondBootBot.surfaceId).toBe(surfaces[0]!.surface_id);
    } finally {
      await firstDaemon?.stop();
      await secondDaemon?.stop();
      try {
        db.close();
      } catch {
        // finishMigrations already closed the setup connection.
      }
      rmSync(home, { recursive: true, force: true });
    }
  }, 15_000);
});
