import { Database } from "bun:sqlite";
import { AVATAR_RENDERER_ID } from "@omarchy-bot/protocol";
import type { Config } from "../bootstrap/config.ts";

export const MIGRATIONS: { name: string; sql: string }[] = [
  {
    name: "0001-initial",
    sql: `
CREATE TABLE bots (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  agent_version TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'missing',
  default_cwd TEXT NOT NULL DEFAULT '',
  default_model TEXT,
  permission_policy TEXT NOT NULL DEFAULT 'ask',
  enabled INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id),
  name TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  default_cwd TEXT,
  default_model TEXT,
  permission_policy TEXT,
  memory_scope_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(bot_id, id)
);
CREATE TABLE threads (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('direct','channel')),
  title TEXT NOT NULL,
  bot_id TEXT NOT NULL REFERENCES bots(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  cwd TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  seq INTEGER NOT NULL,
  author_kind TEXT NOT NULL,
  author_bot_id TEXT,
  author_role_id TEXT,
  kind TEXT NOT NULL,
  text TEXT,
  payload TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(thread_id, seq)
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id),
  owner_bot_id TEXT NOT NULL,
  owner_role_id TEXT NOT NULL,
  assigned_by TEXT NOT NULL DEFAULT 'user',
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  parent_task_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id),
  actor_bot_id TEXT NOT NULL,
  actor_role_id TEXT NOT NULL,
  native_session_id TEXT NOT NULL DEFAULT '',
  worker_session_id TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE TABLE role_sessions (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES roles(id),
  thread_id TEXT NOT NULL REFERENCES threads(id),
  native_session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(role_id, thread_id)
);
CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  run_id TEXT,
  worker_session_id TEXT,
  tool TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE TABLE computer_leases (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  holder_is_human INTEGER NOT NULL DEFAULT 0,
  holder_bot_id TEXT,
  holder_role_id TEXT,
  run_id TEXT,
  token TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE events (
  cursor INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL,
  occurred_at TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  media_type TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_thread ON messages(thread_id, seq);
CREATE INDEX idx_tasks_thread ON tasks(thread_id);
CREATE INDEX idx_events_aggregate ON events(aggregate_type, aggregate_id);
`,
  },
  {
    // User-created Bots reference Agents (ADR 0002). One step: build the new
    // tables, preserve only legacy Agent records with user-owned content or
    // configuration, re-point their threads, then drop the legacy model.
    // Empty inventory rows remain Agents and never become Sidebar Bots.
    name: "0002-user-created-bots",
    sql: `
CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  agent_version TEXT NOT NULL DEFAULT 'unknown',
  status TEXT NOT NULL DEFAULT 'unknown',
  reason TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE bots_new (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instructions TEXT NOT NULL DEFAULT '',
  agent_id TEXT NOT NULL REFERENCES agents(id),
  avatar_kind TEXT NOT NULL DEFAULT 'generated',
  avatar_recipe TEXT NOT NULL DEFAULT '',
  avatar_file TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE threads_new (
  id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots_new(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  cwd TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE turns (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads_new(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL,
  status TEXT NOT NULL,
  worker_session_id TEXT,
  native_session_id TEXT NOT NULL DEFAULT '',
  steer_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  outcome_reason TEXT
);
CREATE TABLE thread_sessions (
  thread_id TEXT PRIMARY KEY REFERENCES threads_new(id) ON DELETE CASCADE,
  native_session_id TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  bot_id TEXT NOT NULL REFERENCES bots_new(id) ON DELETE CASCADE,
  thread_id TEXT REFERENCES threads_new(id) ON DELETE CASCADE,
  message_id TEXT,
  name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  rel_path TEXT NOT NULL,
  source_sha256 TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  turn_id TEXT,
  worker_session_id TEXT,
  tool TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE TABLE bot_state (
  bot_id TEXT PRIMARY KEY REFERENCES bots_new(id) ON DELETE CASCADE,
  last_activity_at TEXT,
  preview_text TEXT,
  preview_at TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  unread_thread_id TEXT
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Agents referenced by legacy bots must exist before the FK-valid copy below.
INSERT INTO agents (id, display_name, updated_at)
SELECT DISTINCT b.id,
       CASE b.id
         WHEN 'pi' THEN 'Pi' WHEN 'omp' THEN 'OMP' WHEN 'codex' THEN 'Codex'
         WHEN 'claude' THEN 'Claude' WHEN 'grok' THEN 'Grok' WHEN 'opencode' THEN 'OpenCode'
         WHEN 'gemini' THEN 'Gemini' WHEN 'copilot' THEN 'Copilot' WHEN 'crush' THEN 'Crush'
         ELSE b.id
       END,
       b.updated_at
FROM bots b;

-- A legacy Agent becomes a Bot only when it owns conversation data or user
-- configuration. Empty built-in inventory rows remain infrastructure.
INSERT INTO bots_new (id, name, instructions, agent_id, avatar_kind, avatar_recipe, created_at, updated_at)
SELECT 'bot_' || lower(hex(randomblob(16))),
       b.display_name,
       COALESCE((SELECT r.instructions FROM roles r WHERE r.bot_id = b.id AND r.id = 'default'), ''),
       b.id,
       'generated',
       '{"rendererVersion":"${AVATAR_RENDERER_ID}","style":"shapes","seed":"bot_' || lower(hex(randomblob(16))) || '","options":{}}',
       b.created_at,
       b.updated_at
FROM bots b
WHERE EXISTS (SELECT 1 FROM threads t WHERE t.bot_id = b.id)
   OR EXISTS (
     SELECT 1 FROM roles r
     WHERE r.bot_id = b.id
       AND (
         r.id <> 'default'
         OR r.name <> 'Default'
         OR trim(r.instructions) <> ''
         OR COALESCE(r.default_cwd, '') <> ''
         OR r.default_model IS NOT NULL
       )
   )
   OR trim(b.default_cwd) <> ''
   OR b.default_model IS NOT NULL
   OR b.display_name <> CASE b.id
     WHEN 'pi' THEN 'Pi' WHEN 'omp' THEN 'OMP' WHEN 'codex' THEN 'Codex'
     WHEN 'claude' THEN 'Claude' WHEN 'grok' THEN 'Grok' WHEN 'opencode' THEN 'OpenCode'
     WHEN 'gemini' THEN 'Gemini' WHEN 'copilot' THEN 'Copilot' WHEN 'crush' THEN 'Crush'
     ELSE b.id
   END;
-- Keep the generated conversation recipe tied to its new Bot identity.
-- This is provenance evidence for fresh migrations and avoids manufacturing
-- the random-seed signature used by older inventory placeholders.
UPDATE bots_new
SET avatar_recipe = json_set(avatar_recipe, '$.seed', id);


-- Re-point threads at their migrated bot (ids preserved, zero message loss).
INSERT INTO threads_new (id, bot_id, title, cwd, created_at, updated_at)
SELECT t.id,
       (SELECT bn.id FROM bots_new bn JOIN bots ob ON ob.id = t.bot_id AND bn.agent_id = ob.id),
       t.title,
       t.cwd,
       t.created_at,
       t.updated_at
FROM threads t;

-- Latest native session per thread wins (one native session per thread now).
INSERT INTO thread_sessions (thread_id, native_session_id, updated_at)
SELECT rs.thread_id, rs.native_session_id, rs.created_at
FROM role_sessions rs
JOIN (SELECT thread_id, MAX(created_at) AS latest FROM role_sessions GROUP BY thread_id) pick
  ON pick.thread_id = rs.thread_id AND pick.latest = rs.created_at;

-- Authorship now lives on the thread's Bot; drop the dangling legacy columns.
UPDATE messages SET author_bot_id = NULL, author_role_id = NULL;

DROP INDEX idx_tasks_thread;
DROP TABLE permissions;
DROP TABLE runs;
DROP TABLE tasks;
DROP TABLE role_sessions;
DROP TABLE threads;
DROP TABLE roles;
DROP TABLE bots;
ALTER TABLE bots_new RENAME TO bots;
ALTER TABLE threads_new RENAME TO threads;

CREATE INDEX idx_threads_bot ON threads(bot_id, updated_at);
CREATE INDEX idx_turns_thread ON turns(thread_id);
CREATE INDEX idx_attachments_thread ON attachments(thread_id);
`,
  },
  {
    name: "0003-permanent-bot-deletion",
    sql: `
CREATE TABLE bot_deletions (
  bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('cleaning', 'failed')),
  failure_json TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE bot_native_session_deletions (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  native_session_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  PRIMARY KEY (bot_id, native_session_id)
);
`,
  },
  {
    // Final expand-contract cutover. Historical tables above remain only as
    // migration provenance; every live database converges on the current model.
    name: "0004-contract-legacy-runtime",
    sql: `
UPDATE turns
SET status = 'failed',
    finished_at = COALESCE(finished_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    outcome_reason = 'blocked turn could not resume after runtime contract migration'
WHERE status = 'waiting_for_approval';

CREATE TABLE messages_new (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  author_kind TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT,
  payload TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(thread_id, seq)
);
INSERT INTO messages_new (id, thread_id, seq, author_kind, kind, text, payload, created_at)
SELECT id, thread_id, seq, author_kind, kind, text, payload, created_at
FROM messages
WHERE kind <> 'approval';
DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;
CREATE INDEX idx_messages_thread ON messages(thread_id, seq);

CREATE TABLE computer_leases_new (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  holder_is_human INTEGER NOT NULL DEFAULT 0,
  holder_bot_id TEXT,
  turn_id TEXT,
  token TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
INSERT INTO computer_leases_new (id, holder_is_human, holder_bot_id, turn_id, token, acquired_at, expires_at)
SELECT id, holder_is_human, holder_bot_id, run_id, token, acquired_at, expires_at
FROM computer_leases;
DROP TABLE computer_leases;
ALTER TABLE computer_leases_new RENAME TO computer_leases;

DROP TABLE IF EXISTS approvals;
DROP TABLE IF EXISTS settings;

-- Replay begins at the contracted public model; no old aggregate identities,
-- approval payloads, or lease diagnostics can cross the WebSocket boundary.
DELETE FROM events;
`,
  },
  {
    // Kept as an inert historical step for databases that have not applied it.
    // Destructive cleanup and recipe upgrades require explicit provenance;
    // already-applied databases are repaired by the forward migration below.
    name: "0005-created-bots-animated-avatars",
    sql: `
SELECT 1;
`,
  },
  {
    // Classify retained legacy Bots conservatively. bot_state is emitted
    // atomically with user-created Bots, while conversations and the
    // identity-tied recipe emitted by the repaired 0002 migration prove
    // legacy user ownership. A recipe shape alone cannot prove inventory, so
    // ambiguous rows keep the safe user_created default and nothing is deleted.
    name: "0006-bot-provenance-repair",
    sql: `
ALTER TABLE bots ADD COLUMN provenance TEXT NOT NULL DEFAULT 'user_created'
  CHECK (provenance IN ('user_created', 'legacy_conversation', 'legacy_inventory'));

UPDATE bots
SET provenance = 'legacy_conversation'
WHERE NOT EXISTS (SELECT 1 FROM bot_state WHERE bot_state.bot_id = bots.id)
  AND (
    trim(instructions) <> ''
    OR pinned <> 0
    OR archived <> 0
    OR archived_at IS NOT NULL
    OR avatar_file IS NOT NULL
    OR avatar_kind <> 'generated'
    OR EXISTS (SELECT 1 FROM threads WHERE threads.bot_id = bots.id)
    OR EXISTS (SELECT 1 FROM attachments WHERE attachments.bot_id = bots.id)
    OR EXISTS (SELECT 1 FROM turns WHERE turns.bot_id = bots.id)
    OR EXISTS (SELECT 1 FROM bot_deletions WHERE bot_deletions.bot_id = bots.id)
    OR EXISTS (SELECT 1 FROM bot_native_session_deletions WHERE bot_native_session_deletions.bot_id = bots.id)
    OR EXISTS (
      SELECT 1 FROM events
      WHERE events.aggregate_type = 'bot' AND events.aggregate_id = bots.id
    )
    OR name <> CASE agent_id
      WHEN 'pi' THEN 'Pi' WHEN 'omp' THEN 'OMP' WHEN 'codex' THEN 'Codex'
      WHEN 'claude' THEN 'Claude' WHEN 'grok' THEN 'Grok' WHEN 'opencode' THEN 'OpenCode'
      WHEN 'gemini' THEN 'Gemini' WHEN 'copilot' THEN 'Copilot' WHEN 'crush' THEN 'Crush'
      ELSE agent_id
    END
    OR (
      json_valid(avatar_recipe)
      AND json_extract(avatar_recipe, '$.rendererVersion') IN ('9.4.3', '${AVATAR_RENDERER_ID}')
      AND json_extract(avatar_recipe, '$.seed') = id
    )
  );

`,
  },
  {
    // Old 0005 deployments wrote DiceBear's core version alone. The renderer
    // dispatch key now pins both packages; mutate only that recipe field.
    name: "0007-pin-dicebear-renderer-id",
    sql: `
UPDATE bots
SET avatar_recipe = json_set(
  avatar_recipe,
  '$.rendererVersion',
  'dicebear-core@10.7.0+styles@10.6.0'
)
WHERE json_valid(avatar_recipe)
  AND json_type(avatar_recipe, '$') = 'object'
  AND json_extract(avatar_recipe, '$.rendererVersion') = '10.7.0'
  AND json_type(avatar_recipe, '$.style') = 'text'
  AND json_type(avatar_recipe, '$.seed') = 'text'
  AND json_type(avatar_recipe, '$.options') = 'object'
  AND NOT EXISTS (
    SELECT 1
    FROM json_each(json_extract(bots.avatar_recipe, '$.options'))
    WHERE type NOT IN ('text', 'integer', 'real', 'true', 'false')
  );
`,
  },
  {
    // NULL marks staged rows created before draft ownership existed. They are
    // deliberately unclaimable and remain eligible for the existing age GC.
    name: "0008-staged-attachment-draft-ownership",
    sql: `
ALTER TABLE attachments ADD COLUMN draft_token TEXT;
`,
  },
  {
    // The application ships one renderer. Existing non-current or unsupported
    // generated recipes become deterministic current defaults; no legacy
    // renderer remains in the browser bundle.
    name: "0009-current-avatar-renderer-only",
    sql: `
UPDATE bots
SET avatar_kind = 'generated',
    avatar_recipe = json_object(
      'rendererVersion', '${AVATAR_RENDERER_ID}',
      'style', 'shapes',
      'seed', id,
      'options', json('{}')
    )
WHERE avatar_kind IN ('generated', 'recipe')
  AND CASE
    WHEN json_valid(avatar_recipe) = 1 THEN
      CASE
        WHEN json_type(avatar_recipe, '$') = 'object' THEN NOT (
          json_extract(avatar_recipe, '$.rendererVersion') = '${AVATAR_RENDERER_ID}'
          AND json_extract(avatar_recipe, '$.style') IN ('shapes', 'pixelbot', 'thumbs')
          AND json_type(avatar_recipe, '$.seed') = 'text'
          AND json_type(avatar_recipe, '$.options') = 'object'
        )
        ELSE 1
      END
    ELSE 1
  END;
`,
  },
  {
    name: "0010-bot-computer-surfaces",
    sql: `
CREATE TABLE bot_surfaces (
  surface_id TEXT PRIMARY KEY CHECK (surface_id GLOB 'surf_[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  bot_id TEXT NOT NULL UNIQUE REFERENCES bots(id) ON DELETE CASCADE,
  lifecycle_state TEXT NOT NULL DEFAULT 'stopped' CHECK (lifecycle_state IN ('stopped', 'starting', 'ready', 'failed')),
  runtime_generation INTEGER NOT NULL DEFAULT 0,
  logical_width INTEGER NOT NULL DEFAULT 1920,
  logical_height INTEGER NOT NULL DEFAULT 1080,
  scale REAL NOT NULL DEFAULT 1,
  refresh_rate INTEGER NOT NULL DEFAULT 60,
  last_failure TEXT,
  last_image_at TEXT,
  transitioned_at TEXT NOT NULL
);
INSERT INTO bot_surfaces (surface_id, bot_id, transitioned_at)
SELECT 'surf_' || lower(hex(randomblob(16))), id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM bots;

CREATE TABLE computer_leases_by_surface (
  surface_id TEXT PRIMARY KEY REFERENCES bot_surfaces(surface_id) ON DELETE CASCADE,
  holder_is_human INTEGER NOT NULL DEFAULT 0,
  holder_bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  turn_id TEXT,
  token TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
INSERT INTO computer_leases_by_surface
  (surface_id, holder_is_human, holder_bot_id, turn_id, token, acquired_at, expires_at)
SELECT bot_surfaces.surface_id, computer_leases.holder_is_human, computer_leases.holder_bot_id,
       computer_leases.turn_id, computer_leases.token, computer_leases.acquired_at, computer_leases.expires_at
FROM computer_leases
JOIN bot_surfaces ON bot_surfaces.bot_id = computer_leases.holder_bot_id;
DROP TABLE computer_leases;
ALTER TABLE computer_leases_by_surface RENAME TO computer_leases;

-- Existing artifact rows predate ownership metadata and cannot be attributed
-- safely. Retain them losslessly outside the active, fail-closed Surface store.
ALTER TABLE artifacts RENAME TO legacy_unscoped_artifacts;
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  media_type TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  surface_id TEXT NOT NULL REFERENCES bot_surfaces(surface_id) ON DELETE CASCADE
);
CREATE INDEX idx_artifacts_surface ON artifacts(surface_id);
`,
  },
];

export function openDb(cfg: Config): Database {
  const db = new Database(cfg.dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.query<{ name: string }, []>("SELECT name FROM schema_migrations").all().map((r) => r.name));
  const pending = MIGRATIONS.filter((m) => !applied.has(m.name));
  if (pending.length > 0) {
    // SQLite guidance: migrations run with foreign keys OFF (legacy tables are
    // dropped while children still reference them). The pragma is a no-op
    // inside a transaction, so it wraps the whole migration pass.
    db.exec("PRAGMA foreign_keys = OFF");
    try {
      for (const m of pending) {
        const tx = db.transaction(() => {
          db.exec(m.sql);
          db.query("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(m.name, new Date().toISOString());
        });
        tx();
      }
    } finally {
      db.exec("PRAGMA foreign_keys = ON");
    }
    const violations = db.query(`PRAGMA foreign_key_check`).all();
    if (violations.length > 0) throw new Error(`migration left foreign-key violations: ${JSON.stringify(violations)}`);
  } else {
    db.exec("PRAGMA foreign_keys = ON");
  }
  return db;
}

/** In-flight ownership and cleanup attempts never survive a daemon restart. */
export function recoverOnStartup(db: Database): void {
  db.exec("DELETE FROM computer_leases");
  const now = new Date().toISOString();
  db.query(`UPDATE turns SET status='failed', finished_at=?, outcome_reason='daemon restart' WHERE status NOT IN ('completed','cancelled','failed')`).run(now);
  db.query(`UPDATE bot_deletions SET state='failed', failure_json=?, updated_at=? WHERE state='cleaning'`)
    .run(JSON.stringify([{ stage: "database", resource: "daemon", message: "daemon restarted during permanent deletion" }]), now);
}
