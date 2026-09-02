import { Database } from "bun:sqlite";
import type { Config } from "../bootstrap/config.ts";

const MIGRATIONS: { name: string; sql: string }[] = [
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
];

export function openDb(cfg: Config): Database {
  const db = new Database(cfg.dbPath, { create: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const applied = new Set(db.query<{ name: string }, []>("SELECT name FROM schema_migrations").all().map((r) => r.name));
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;
    const tx = db.transaction(() => {
      db.exec(m.sql);
      db.query("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)").run(m.name, new Date().toISOString());
    });
    tx();
  }
  return db;
}

/** Shared-screen safety rule: input ownership never survives a daemon restart. */
export function recoverOnStartup(db: Database): void {
  db.exec("DELETE FROM computer_leases");
  const now = new Date().toISOString();
  db.query(`UPDATE runs SET state='failed', finished_at=? WHERE state NOT IN ('completed','cancelled','failed') AND finished_at IS NULL`).run(now);
  db.query(`UPDATE tasks SET status='failed', updated_at=? WHERE status NOT IN ('completed','cancelled','failed')`).run(now);
}
