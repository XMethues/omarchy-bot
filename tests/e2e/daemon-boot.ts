/**
 * Bun-side E2E entrypoint. The parent setup provides isolated storage and the
 * fake workers, while this process runs the real daemon main().
 */
import { Database } from "bun:sqlite";
import path from "node:path";
import { MIGRATIONS } from "../../apps/daemon/src/persistence/db.ts";
import { main } from "../../apps/daemon/src/bootstrap/main.ts";
import { AVATAR_RENDERER_ID } from "../../packages/protocol/src/index.ts";

const dataDir = process.env.OMARCHY_BOT_HOME;
if (dataDir === undefined) throw new Error("OMARCHY_BOT_HOME is required for E2E startup");
const legacyDb = new Database(path.join(dataDir, "db.sqlite"), { create: true });
legacyDb.exec(`CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
for (const migration of MIGRATIONS) {
  if (migration.name === "0011-remove-bot-archive-lifecycle") break;
  legacyDb.exec(migration.sql);
  legacyDb.query(`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`).run(
    migration.name,
    "2026-09-01T00:00:00.000Z",
  );
}
legacyDb.query(
  `INSERT INTO agents (id, display_name, status, updated_at)
   VALUES ('pi', 'Pi', 'ready', '2026-09-01T00:00:00.000Z')`,
).run();
legacyDb.query(
  `INSERT INTO bots (
     id, name, instructions, agent_id, avatar_kind, avatar_recipe, pinned,
     archived, archived_at, created_at, updated_at, provenance
   ) VALUES (
     'bot_legacy_archived', 'Restored legacy bot', 'Preserved legacy profile', 'pi',
     'generated', ?, 0, 1, '2026-08-31T00:00:00.000Z',
     '2026-08-30T00:00:00.000Z', '2026-08-31T00:00:00.000Z', 'user_created'
   )`,
).run(JSON.stringify({
  rendererVersion: AVATAR_RENDERER_ID,
  style: "shapes",
  seed: "bot_legacy_archived",
  options: {},
}));
legacyDb.query(
  `INSERT INTO bot_state (bot_id, last_activity_at, preview_text)
   VALUES ('bot_legacy_archived', '2026-08-31T00:00:00.000Z', 'Recovered during startup')`,
).run();
legacyDb.close();

const { port } = await main();
console.log(`E2E_DAEMON_READY ${port}`);
