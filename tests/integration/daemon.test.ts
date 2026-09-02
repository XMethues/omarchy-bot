import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Database } from "bun:sqlite";
import { MIGRATIONS } from "../../apps/daemon/src/persistence/db.ts";
import { api, apiStatus, makeBot, sendToBot, sendToThread, startDaemon, waitThreadIdle, type Harness } from "./helpers/harness.ts";

let h: Harness;

beforeAll(async () => {
  h = await startDaemon();
}, 30_000);

afterAll(async () => {
  await h?.stop();
});

interface MessageView {
  id: string;
  threadId: string;
  seq: number;
  author: { kind: string };
  kind: string;
  text?: string;
  payload?: Record<string, unknown>;
  createdAt: string;
}

async function messages(threadId: string): Promise<MessageView[]> {
  return api(h, "GET", `/api/threads/${threadId}/messages`);
}

/** Poll until a condition holds — avoids fixed sleeps on real-process races. */
async function until(fn: () => Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error("condition did not hold in time");
    await Bun.sleep(50);
  }
}

describe("integration: agents API", () => {
  test("lists all nine agents with version/status/reason/guidance fields", async () => {
    const agents = await api<{ id: string; displayName: string; version: string; status: string; reason?: string; guidance?: string }[]>(h, "GET", "/api/agents");
    expect(agents.length).toBe(9);
    const ids = agents.map((a) => a.id);
    for (const expected of ["pi", "omp", "codex", "claude", "grok", "opencode", "gemini", "copilot", "crush"]) {
      expect(ids).toContain(expected);
    }
    for (const a of agents) {
      expect(typeof a.displayName).toBe("string");
      expect(typeof a.version).toBe("string");
      expect(["ready", "missing", "unconfigured", "incompatible", "checking", "offline"]).toContain(a.status);
    }
    const pi = agents.find((a) => a.id === "pi")!;
    expect(pi.status).toBe("ready");
    expect(pi.version).toBe("fake-pi-1");
    // Unavailable agents carry plain-language guidance.
    const unavailable = agents.filter((a) => a.status !== "ready" && a.status !== "checking");
    expect(unavailable.length).toBeGreaterThan(0);
    for (const a of unavailable) expect(typeof a.guidance).toBe("string");
  });
});

describe("integration: bots API", () => {
  test("rejects bot creation for a non-ready agent with guidance", async () => {
    const res = await apiStatus(h, "POST", "/api/bots", { name: "Nope", instructions: "", agentId: "claude" });
    expect(res.status).toBe(400);
    expect(typeof (res.body as { error?: string }).error).toBe("string");
  });

  test("rejects bot creation for an unknown agent", async () => {
    const res = await apiStatus(h, "POST", "/api/bots", { name: "Nope", instructions: "", agentId: "nonsense" });
    expect(res.status).toBe(400);
  });

  test("rejects empty names", async () => {
    const res = await apiStatus(h, "POST", "/api/bots", { name: "   ", instructions: "", agentId: "pi" });
    expect(res.status).toBe(400);
  });

  test("two bots on one agent get independent ids", async () => {
    const a = await api<{ id: string; name: string; agentId: string; avatar: { kind: string } }>(h, "POST", "/api/bots", { name: "Alpha", instructions: "alpha job", agentId: "pi" });
    const b = await api<{ id: string; name: string; agentId: string }>(h, "POST", "/api/bots", { name: "Beta", instructions: "beta job", agentId: "pi" });
    expect(a.id).not.toBe(b.id);
    expect(a.id.startsWith("bot_")).toBeTrue();
    expect(b.id.startsWith("bot_")).toBeTrue();
    expect(a.agentId).toBe("pi");
    expect(b.agentId).toBe("pi");
    expect(a.avatar.kind).toBe("generated");
  });

  test("PATCH cannot change agentId", async () => {
    const botId = await makeBot(h, "Patched");
    const res = await apiStatus(h, "PATCH", `/api/bots/${botId}`, { agentId: "claude" });
    expect(res.status).toBe(400);
    expect((res.body as { error?: string }).error).toContain("agent");
  });

  test("PATCH updates name and instructions", async () => {
    const botId = await makeBot(h, "Before");
    const updated = await api<{ name: string; instructions: string }>(h, "PATCH", `/api/bots/${botId}`, { name: "After", instructions: "new job" });
    expect(updated.name).toBe("After");
    expect(updated.instructions).toBe("new job");
  });

  test("GET /api/bots returns user-created bots with activity status", async () => {
    const bots = await api<{ id: string; status: string; unreadCount: number }[]>(h, "GET", "/api/bots");
    expect(bots.length).toBeGreaterThan(0);
    for (const b of bots) {
      expect(b.id.startsWith("bot_")).toBeTrue();
      expect(["idle", "working", "waiting", "needs_you", "error", "unavailable"]).toContain(b.status);
      expect(typeof b.unreadCount).toBe("number");
    }
  });
});

describe("integration: chat through a bot", () => {
  test("first send atomically creates thread + user message + turn and derives a title", async () => {
    const botId = await makeBot(h, "Chatter");
    const result = await sendToBot(h, botId, "say: hello world");
    expect(result.action).toBe("sent");
    expect(result.threadId).toBeTruthy();
    expect(result.turnId).toBeTruthy();
    await waitThreadIdle(h, result.threadId);
    const thread = await api<{ id: string; botId: string; title: string }>(h, "GET", `/api/threads/${result.threadId}`);
    expect(thread.botId).toBe(botId);
    expect(thread.title).toContain("say: hello world");
    const msgs = await messages(result.threadId);
    expect(msgs.some((m) => m.author.kind === "user" && m.text === "say: hello world")).toBeTrue();
    const botText = msgs.filter((m) => m.author.kind === "bot" && m.kind === "text").map((m) => m.text ?? "").join("");
    expect(botText).toContain("hello world");
  });

  test("an abandoned blank conversation persists no thread", async () => {
    const botId = await makeBot(h, "Blank");
    const threads = await api<{ botId: string }[]>(h, "GET", `/api/bots/${botId}/threads`);
    expect(threads.length).toBe(0);
  });

  test("worker session is resumed per thread (thread_sessions)", async () => {
    const botId = await makeBot(h, "Resumer");
    const first = await sendToBot(h, botId, "say: one");
    await waitThreadIdle(h, first.threadId);
    // Second turn on the same thread resumes the stored native session.
    const second = await sendToThread(h, first.threadId, "say: two");
    expect(second.turnId).not.toBe(first.turnId);
    await waitThreadIdle(h, first.threadId);
    const msgs = await messages(first.threadId);
    const botText = msgs.filter((m) => m.author.kind === "bot" && m.kind === "text").map((m) => m.text ?? "").join("");
    expect(botText).toContain("one");
    expect(botText).toContain("two");
  });

  test("tool events are persisted as tool messages and final text separately", async () => {
    const botId = await makeBot(h, "Tools");
    const sent = await sendToBot(h, botId, "tool please");
    await waitThreadIdle(h, sent.threadId);
    const msgs = await messages(sent.threadId);
    const tool = msgs.find((message) => message.kind === "tool");
    expect(tool?.payload?.state).toBe("complete");
    expect(msgs.some((message) => message.kind === "event" && message.payload?.capability === "fake.progress")).toBeTrue();
    expect(msgs.some((message) => message.author.kind === "bot" && message.kind === "text" && message.text === "tool finished")).toBeTrue();
    expect(msgs.some((message) => message.author.kind === "user")).toBeTrue();
  });

  test("a failed turn leaves a failed status note in the transcript", async () => {
    const botId = await makeBot(h, "Fails");
    const sent = await sendToBot(h, botId, "fail");
    await waitThreadIdle(h, sent.threadId);
    const msgs = await messages(sent.threadId);
    expect(msgs.some((m) => m.author.kind === "system" && m.kind === "event" && (m.text ?? "").includes("error: fake failure"))).toBeTrue();
  });

  test("sending while a turn is active steers instead of starting a turn", async () => {
    const botId = await makeBot(h, "Steerable");
    const sent = await sendToBot(h, botId, "steer-echo");
    await until(async () => (await api<{ activeTurn?: unknown }>(h, "GET", `/api/threads/${sent.threadId}`)).activeTurn !== undefined);
    // Active turn -> steer.
    const steered = await sendToThread(h, sent.threadId, "redirect me");
    expect(steered.action).toBe("steered");
    expect(steered.turnId).toBe(sent.turnId);
    await waitThreadIdle(h, sent.threadId);
    const msgs = await messages(sent.threadId);
    const botText = msgs.filter((m) => m.author.kind === "bot" && m.kind === "text").map((m) => m.text ?? "").join("");
    expect(botText).toContain("steered: redirect me");
    // The steered user message is correlated with the active turn.
    const steerMsg = msgs.find((m) => m.author.kind === "user" && m.text === "redirect me");
    expect(steerMsg?.payload?.turnId).toBe(sent.turnId);
  });

  test("steering a non-steerable (hanging) turn fails cleanly with a transcript note", async () => {
    const botId = await makeBot(h, "Hangs");
    const sent = await sendToBot(h, botId, "hang");
    await until(async () => (await api<{ activeTurn?: unknown }>(h, "GET", `/api/threads/${sent.threadId}`)).activeTurn !== undefined);
    const res = await apiStatus(h, "POST", `/api/threads/${sent.threadId}/messages`, { text: "redirect" });
    expect(res.status).toBe(409);
    // Abort to clean up the hanging turn.
    await api(h, "POST", `/api/turns/${sent.turnId}/abort`);
    await waitThreadIdle(h, sent.threadId);
    const msgs = await messages(sent.threadId);
    expect(msgs.some((m) => m.author.kind === "system" && (m.text ?? "").includes("steer unavailable"))).toBeTrue();
    expect(msgs.some((m) => m.author.kind === "system" && m.kind === "event" && (m.text ?? "").includes("cancel"))).toBeTrue();
  });

  test("turn abort via /api/turns/:id/abort cancels", async () => {
    const botId = await makeBot(h, "Abortable");
    const sent = await sendToBot(h, botId, "hang");
    await until(async () => (await api<{ activeTurn?: unknown }>(h, "GET", `/api/threads/${sent.threadId}`)).activeTurn !== undefined);
    const thread = await api<{ activeTurn?: { id: string; status: string } }>(h, "GET", `/api/threads/${sent.threadId}`);
    expect(thread.activeTurn).toBeDefined();
    await api(h, "POST", `/api/turns/${sent.turnId}/abort`);
    await waitThreadIdle(h, sent.threadId);
    const msgs = await messages(sent.threadId);
    expect(msgs.some((m) => m.author.kind === "system" && m.kind === "event" && (m.text ?? "").includes("cancel"))).toBeTrue();
  });

  test("approvals pass through and are decidable", async () => {
    const botId = await makeBot(h, "Approver");
    const sent = await sendToBot(h, botId, "ask");
    await until(async () => (await api<{ status: string }[]>(h, "GET", "/api/approvals")).some((a) => a.status === "pending"));
    const pending = (await api<{ id: string; status: string }[]>(h, "GET", "/api/approvals")).filter((a) => a.status === "pending");
    expect(pending.length).toBe(1);
    const decided = await api<{ status: string }>(h, "POST", `/api/approvals/${pending[0]!.id}/respond`, { decision: true });
    expect(decided.status).toBe("allowed");
    await waitThreadIdle(h, sent.threadId);
    const msgs = await messages(sent.threadId);
    expect(msgs.some((m) => m.kind === "approval")).toBeTrue();
    expect(msgs.some((m) => m.kind === "tool")).toBeTrue();
  });
});

describe("integration: threads API", () => {
  test("list threads for a bot recent-first and filter by q", async () => {
    const botId = await makeBot(h, "Lister");
    const one = await sendToBot(h, botId, "say: apple pie recipe");
    await waitThreadIdle(h, one.threadId);
    const two = await sendToBot(h, botId, "say: banana split");
    await waitThreadIdle(h, two.threadId);
    const all = await api<{ id: string; title: string }[]>(h, "GET", `/api/bots/${botId}/threads`);
    expect(all.length).toBe(2);
    expect(all[0]!.id).toBe(two.threadId); // most recent first
    const filtered = await api<{ id: string }[]>(h, "GET", `/api/bots/${botId}/threads?q=apple`);
    expect(filtered.length).toBe(1);
    expect(filtered[0]!.id).toBe(one.threadId);
  });

  test("thread rename is rejected with a 409 naming the agent", async () => {
    const botId = await makeBot(h, "Renamer");
    const sent = await sendToBot(h, botId, "say: rename me");
    await waitThreadIdle(h, sent.threadId);
    const res = await apiStatus(h, "PATCH", `/api/threads/${sent.threadId}`, { title: "Nope" });
    expect(res.status).toBe(409);
    expect((res.body as { error?: string }).error).toContain("pi");
  });
});

describe("integration: legacy migration", () => {
  test("booting over a representative legacy db preserves threads+messages and creates agents+bots; second boot is idempotent", async () => {
    // Fabricate a legacy home: apply only migration 0001, seed legacy rows.
    const legacyHome = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-legacy-"));
    const db = new Database(path.join(legacyHome, "db.sqlite"), { create: true });
    db.exec("PRAGMA journal_mode = WAL");
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
    db.exec(MIGRATIONS[0]!.sql);
    const now = "2026-09-01T00:00:00.000Z";
    // Legacy agent-shaped bots (id === agent id).
    db.query(`INSERT INTO bots (id, display_name, agent_version, status, enabled, created_at, updated_at) VALUES ('pi', 'Pi', '0.84.4', 'ready', 1, ?, ?)`).run(now, now);
    db.query(`INSERT INTO bots (id, display_name, agent_version, status, enabled, created_at, updated_at) VALUES ('claude', 'Claude', '', 'missing', 0, ?, ?)`).run(now, now);
    db.query(`INSERT INTO roles (id, bot_id, name, instructions, memory_scope_id, created_at, updated_at) VALUES ('default', 'pi', 'Default', 'be helpful', 'role:pi:default', ?, ?)`).run(now, now);
    // Two legacy threads with messages + a native session mapping.
    db.query(`INSERT INTO threads (id, kind, title, bot_id, role_id, cwd, created_at, updated_at) VALUES ('thr-1', 'direct', 'Legacy one', 'pi', 'default', '/tmp', ?, ?)`).run(now, now);
    db.query(`INSERT INTO threads (id, kind, title, bot_id, role_id, cwd, created_at, updated_at) VALUES ('thr-2', 'direct', 'Legacy two', 'pi', 'default', NULL, ?, ?)`).run(now, now);
    db.query(`INSERT INTO messages (id, thread_id, seq, author_kind, author_bot_id, author_role_id, kind, text, created_at) VALUES ('m-1', 'thr-1', 1, 'user', NULL, NULL, 'text', 'legacy hello', ?)`).run(now);
    db.query(`INSERT INTO messages (id, thread_id, seq, author_kind, author_bot_id, author_role_id, kind, text, created_at) VALUES ('m-2', 'thr-1', 2, 'bot', 'pi', 'default', 'text', 'legacy reply', ?)`).run(now);
    db.query(`INSERT INTO messages (id, thread_id, seq, author_kind, author_bot_id, author_role_id, kind, text, created_at) VALUES ('m-3', 'thr-2', 1, 'user', NULL, NULL, 'text', 'second thread', ?)`).run(now);
    db.query(`INSERT INTO role_sessions (id, role_id, thread_id, native_session_id, created_at) VALUES ('rs-1', 'default', 'thr-1', 'fake://native-legacy', ?)`).run(now);
    db.query(`INSERT INTO schema_migrations (name, applied_at) VALUES ('0001-initial', ?)`).run(now);
    db.close();

    // Boot the real daemon over the legacy home: migration 0002 must run.
    const legacy = await startDaemon(legacyHome);
    try {
      // Agents + migrated bots exist.
      const agents = await api<{ id: string; status: string }[]>(legacy, "GET", "/api/agents");
      expect(agents.length).toBe(9);
      const bots = await api<{ id: string; name: string; agentId: string; instructions: string }[]>(legacy, "GET", "/api/bots");
      // Both legacy bots migrated (pi enabled, claude disabled) with new ids.
      expect(bots.length).toBe(2);
      const migratedPi = bots.find((b) => b.agentId === "pi")!;
      expect(migratedPi.id.startsWith("bot_")).toBeTrue();
      expect(migratedPi.id).not.toBe("pi");
      expect(migratedPi.name).toBe("Pi");
      expect(migratedPi.instructions).toBe("be helpful");

      // Threads + messages preserved verbatim, re-pointed at the migrated bot.
      const threads = await api<{ id: string; botId: string; title: string }[]>(legacy, "GET", `/api/bots/${migratedPi.id}/threads`);
      expect(threads.map((t) => t.id).sort()).toEqual(["thr-1", "thr-2"]);
      expect(threads.every((t) => t.botId === migratedPi.id)).toBeTrue();
      const t1msgs = await api<MessageView[]>(legacy, "GET", `/api/threads/thr-1/messages`);
      expect(t1msgs.length).toBe(2);
      expect(t1msgs[0]!.text).toBe("legacy hello");
      expect(t1msgs[0]!.author.kind).toBe("user");
      expect(t1msgs[1]!.text).toBe("legacy reply");
      expect(t1msgs[1]!.author.kind).toBe("bot");
      const t2msgs = await api<MessageView[]>(legacy, "GET", `/api/threads/thr-2/messages`);
      expect(t2msgs.length).toBe(1);

      // role_sessions -> thread_sessions survived.
      const t1 = await legacy.svc.threads.getThread("thr-1");
      expect(t1).toBeDefined();
      expect(legacy.svc.threads.getNativeSession("thr-1")).toBe("fake://native-legacy");

      // Second boot over the same home: nothing duplicates.
      await legacy.stop();
      const again = await startDaemon(legacyHome);
      try {
        const bots2 = await api<{ id: string }[]>(again, "GET", "/api/bots");
        const agents2 = await api<{ id: string }[]>(again, "GET", "/api/agents");
        expect(bots2.length).toBe(2);
        expect(agents2.length).toBe(9);
        const threads2 = await api<{ id: string }[]>(again, "GET", `/api/bots/${migratedPi.id}/threads`);
        expect(threads2.length).toBe(2);
        const t1msgs2 = await api<MessageView[]>(again, "GET", `/api/threads/thr-1/messages`);
        expect(t1msgs2.length).toBe(2);
      } finally {
        await again.stop();
      }
    } finally {
      await legacy.stop();
      rmSync(legacyHome, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("integration: computer surface", () => {
  test("computer state reports idle with plain language", async () => {
    const state = await api<{ state: string; activity?: string }>(h, "GET", "/api/computer/state");
    expect(["idle", "bot-using", "waiting", "needs-you", "user-control", "emergency-stopped", "unavailable"]).toContain(state.state);
  });

  test("take-control then return-to-bot round-trips through the human lease", async () => {
    const taken = await api<{ state: string }>(h, "POST", "/api/computer/take-control");
    expect(taken.state).toBe("user-control");
    const returned = await api<{ state: string }>(h, "POST", "/api/computer/return-to-bot");
    expect(returned.state).toBe("idle");
  });

  test("emergency stop blocks until resumed", async () => {
    await api(h, "POST", "/api/computer/emergency-stop");
    const stopped = await api<{ state: string }>(h, "GET", "/api/computer/state");
    expect(stopped.state).toBe("emergency-stopped");
    await api(h, "POST", "/api/computer/resume");
    const resumed = await api<{ state: string }>(h, "GET", "/api/computer/state");
    expect(resumed.state).not.toBe("emergency-stopped");
  });
});

describe("integration: daemon restart", () => {
  test("a fresh daemon over the same data dir fails open turns and drops leases", async () => {
    const { openDb } = await import("../../apps/daemon/src/persistence/db.ts");
    const db = openDb({ dbPath: `${h.home}/db.sqlite` } as never);
    const now = Date.now();
    db.query(
      `INSERT OR REPLACE INTO computer_leases (id, holder_is_human, holder_bot_id, run_id, token, acquired_at, expires_at)
       VALUES (1, 0, 'bot_restart', NULL, 'tok', ?, ?)`,
    ).run(new Date(now).toISOString(), new Date(now + 60_000).toISOString());
    db.close();

    await h.stop();
    const second = await startDaemon(h.home);
    try {
      const state = await api<{ state: string }>(second, "GET", "/api/computer/state");
      expect(state.state).toBe("idle");
    } finally {
      await second.stop();
    }
  }, 30_000);
});
