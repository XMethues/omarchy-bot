/**
 * Bun-side E2E entrypoint. The parent setup provides isolated storage and the
 * fake workers, while this process runs the real daemon main().
 */
import { loadConfig } from "../../apps/daemon/src/bootstrap/config.ts";
import { main } from "../../apps/daemon/src/bootstrap/main.ts";
import { openDb } from "../../apps/daemon/src/persistence/db.ts";
import { AVATAR_RENDERER_ID } from "../../packages/protocol/src/index.ts";

// Model a database stamped by an earlier release but later written with a
// recipe outside this renderer's contract. main() must repair it before the
// first browser request.
const MIGRATED_AVATAR_BOT_ID = "bot_00000000000000000000000000000001";
const cfg = loadConfig();
const db = openDb(cfg);
const now = new Date().toISOString();
db.query(
  `INSERT INTO agents (id, display_name, status, updated_at)
   VALUES ('pi', 'Pi', 'ready', ?)
   ON CONFLICT(id) DO NOTHING`,
).run(now);
db.query(
  `INSERT INTO bots (id, name, instructions, agent_id, avatar_kind, avatar_recipe, created_at, updated_at)
   VALUES (?, 'Recovered Avatar Bot', '', 'pi', 'generated', ?, ?, ?)
   ON CONFLICT(id) DO NOTHING`,
).run(
  MIGRATED_AVATAR_BOT_ID,
  JSON.stringify({
    rendererVersion: AVATAR_RENDERER_ID,
    style: "clay",
    seed: "incompatible-current-recipe",
    options: {},
  }),
  now,
  now,
);
db.query(`INSERT INTO bot_state (bot_id) VALUES (?) ON CONFLICT(bot_id) DO NOTHING`).run(MIGRATED_AVATAR_BOT_ID);
db.query(
  `INSERT INTO bot_surfaces (surface_id, bot_id, transitioned_at)
   VALUES ('surf_00000000000000000000000000000001', ?, ?)
   ON CONFLICT(bot_id) DO NOTHING`,
).run(MIGRATED_AVATAR_BOT_ID, now);
db.query(`DELETE FROM schema_migrations WHERE name = '0014-enforce-current-avatar-recipes'`).run();
db.close();

const { port } = await main();
console.log(`E2E_DAEMON_READY ${port}`);
