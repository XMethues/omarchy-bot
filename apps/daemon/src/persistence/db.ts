import { Database } from "bun:sqlite";
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
    // tables, copy legacy data (legacy agent-shaped bot -> migrated bot row;
    // threads re-pointed; role_sessions -> thread_sessions), then drop the
    // legacy model. Threads and messages survive untouched.
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

-- Every legacy agent-shaped bot becomes one migrated user-created Bot.
INSERT INTO bots_new (id, name, instructions, agent_id, avatar_kind, avatar_recipe, created_at, updated_at)
SELECT 'bot_' || lower(hex(randomblob(16))),
       b.display_name,
       COALESCE((SELECT r.instructions FROM roles r WHERE r.bot_id = b.id AND r.id = 'default'), ''),
       b.id,
       'generated',
       '{"rendererVersion":"9.4.3","style":"shapes","seed":"bot_' || lower(hex(randomblob(16))) || '","options":{}}',
       b.created_at,
       b.updated_at
FROM bots b;

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

/** Shared-screen safety rule: input ownership never survives a daemon restart. */
export function recoverOnStartup(db: Database): void {
  db.exec("DELETE FROM computer_leases");
  const now = new Date().toISOString();
  db.query(`UPDATE turns SET status='failed', finished_at=?, outcome_reason='daemon restart' WHERE status NOT IN ('completed','cancelled','failed')`).run(now);
}
