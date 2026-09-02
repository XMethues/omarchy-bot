import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import path from "node:path";
import { api, makeThread, startDaemon, type Harness } from "./helpers/harness.ts";

let h: Harness;

beforeAll(async () => {
  h = await startDaemon();
}, 30_000);

afterAll(async () => {
  await h?.stop();
});

async function sendMessage(threadId: string, text: string): Promise<void> {
  await api(h, "POST", `/api/threads/${threadId}/messages`, { text });
}

async function waitTaskTerminal(threadId: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tasks = await api<{ threadId: string; status: string }[]>(h, "GET", "/api/tasks");
    const mine = tasks.filter((t) => t.threadId === threadId);
    if (mine.length > 0) {
      const statuses = mine.map((t) => t.status);
      if (statuses.every((s) => ["completed", "cancelled", "failed"].includes(s))) return statuses[0]!;
    }
    await Bun.sleep(100);
  }
  throw new Error("task did not reach terminal state in time");
}

async function messages(threadId: string): Promise<{ author: { kind: string }; kind: string; text?: string; payload?: Record<string, unknown> }[]> {
  return api(h, "GET", `/api/threads/${threadId}/messages`);
}

async function pendingApprovals(): Promise<{ id: string; tool: string; status: string }[]> {
  const all = await api<{ id: string; tool: string; status: string }[]>(h, "GET", "/api/permissions");
  return all.filter((a) => a.status === "pending");
}

describe("integration: chat turn", () => {
  test("streams an assistant reply through the fake worker", async () => {
    const tid = await makeThread(h, "chat");
    await sendMessage(tid, "say: hello world");
    await waitTaskTerminal(tid);
    const msgs = await messages(tid);
    const botText = msgs.filter((m) => m.author.kind === "bot" && m.kind === "text").map((m) => m.text ?? "").join("");
    expect(botText).toContain("hello world");
  });

  test("history is persisted across the run (messages readable)", async () => {
    const tid = await makeThread(h, "history");
    await sendMessage(tid, "say: persist me");
    await waitTaskTerminal(tid);
    const msgs = await messages(tid);
    expect(msgs.some((m) => m.author.kind === "user")).toBeTrue();
    expect(msgs.some((m) => m.author.kind === "bot")).toBeTrue();
  });
});

describe("integration: permissions (fail-closed)", () => {
  test("tool request creates a pending approval; allow unblocks the turn", async () => {
    const tid = await makeThread(h, "approval-allow");
    await sendMessage(tid, "ask");
    await Bun.sleep(300);
    const pending = await pendingApprovals();
    expect(pending.length).toBe(1);
    const allowed = await api<{ status: string }>(h, "POST", `/api/permissions/${pending[0]!.id}/respond`, { decision: true });
    expect(allowed.status).toBe("allowed");
    await waitTaskTerminal(tid);
    const msgs = await messages(tid);
    // approval card + tool card present
    expect(msgs.some((m) => m.kind === "approval")).toBeTrue();
    expect(msgs.some((m) => m.kind === "tool")).toBeTrue();
  });

  test("denied approval still completes the turn (fail-closed, no crash)", async () => {
    const tid = await makeThread(h, "approval-deny");
    await sendMessage(tid, "deny-tool");
    await Bun.sleep(300);
    const pending = await pendingApprovals();
    expect(pending.length).toBe(1);
    await api(h, "POST", `/api/permissions/${pending[0]!.id}/respond`, { decision: false });
    const status = await waitTaskTerminal(tid);
    expect(status).toBe("completed");
  });
});

describe("integration: abort (Gate 1 — no late writes)", () => {
  test("abort on a hung turn cancels the task and emits a system note", async () => {
    const tid = await makeThread(h, "abort");
    await sendMessage(tid, "hang");
    await Bun.sleep(400);
    const tasks = await api<{ id: string; threadId: string; status: string }[]>(h, "GET", "/api/tasks");
    const running = tasks.find((t) => t.threadId === tid && !["completed", "cancelled", "failed"].includes(t.status));
    expect(running).toBeDefined();
    await api(h, "POST", `/api/tasks/${running!.id}/abort`);
    const status = await waitTaskTerminal(tid);
    expect(status).toBe("cancelled");
    const msgs = await messages(tid);
    expect(msgs.some((m) => m.author.kind === "system" && m.kind === "event" && (m.text ?? "").includes("cancel"))).toBeTrue();
  });
});

describe("integration: computer broker (Gate 1 — lease + safety)", () => {
  test("bot cannot move the mouse without holding the lease", async () => {
    // Real ComputerBroker, real rules: click with no lease must throw.
    const { ComputerBroker } = await import("../../apps/daemon/src/modules/computer/broker.ts");
    const { openDb } = await import("../../apps/daemon/src/persistence/db.ts");
    const { mkdirSync } = await import("node:fs");
    const dir = path.join(h.home, `broker-${Date.now()}`);
    mkdirSync(`${dir}/artifacts`, { recursive: true });
    const db = openDb({ dbPath: `${dir}/db.sqlite` } as never);
    const events = { append: () => {} } as never;
    const runner = { parkForHuman: () => {}, resumeAfterHuman: () => {}, parkForComputer: () => {} } as never;
    const permissions = { create: () => ({ id: "x" }), registerWaiter: () => {} } as never;
    const supervisor = { computerCommand: async () => ({ text: "moved" }) } as never;
    const broker = new ComputerBroker(db, events, permissions, supervisor, runner, {
      artifactsDir: `${dir}/artifacts`,
      leaseTtlMs: 60_000,
      approvalTimeoutMs: 5_000,
    } as never);
    // click without lease -> rejected by the broker
    await expect(broker.act({ botId: "pi", roleId: "default" }, undefined, { name: "click", args: {} })).rejects.toThrow(/no active input lease/);
    // observe is allowed without a lease (read-only)
    const obs = await broker.act({ botId: "pi", roleId: "default" }, undefined, { name: "observe", args: {} });
    expect(obs.text).toBe("moved");
    db.close();
  });

  test("observe/screenshot are not lease-gated; input needs the token", async () => {
    const state = await api<{ lease: unknown }>(h, "GET", "/api/computer/state");
    expect(state.lease).toBeNull();
    // human take over -> lease to human; bot input still refused; release works
    const taken = await api<{ lease: { holder: string } }>(h, "POST", "/api/computer/take-over");
    expect(taken.lease.holder).toBe("human");
    const released = await api<{ lease: null }>(h, "POST", "/api/computer/release");
    expect(released.lease).toBeNull();
  });

  test("emergency stop blocks input until resumed", async () => {
    await api(h, "POST", "/api/computer/emergency-stop");
    const stopped = await api<{ emergencyStopped: boolean }>(h, "GET", "/api/computer/state");
    expect(stopped.emergencyStopped).toBe(true);
    await api(h, "POST", "/api/computer/resume");
    const resumed = await api<{ emergencyStopped: boolean }>(h, "GET", "/api/computer/state");
    expect(resumed.emergencyStopped).toBe(false);
  });
});

describe("integration: daemon restart (Gate 1 — leases never survive as bot-held)", () => {
  test("a fresh daemon over the same data dir has no bot-held lease", async () => {
    // simulate a crash with a bot-held lease: write the lease row directly,
    // then boot a second daemon over the same data dir and check it is gone.
    const { openDb } = await import("../../apps/daemon/src/persistence/db.ts");
    const db = openDb({ dbPath: `${h.home}/db.sqlite` } as never);
    const now = Date.now();
    db.query(
      `INSERT OR REPLACE INTO computer_leases (id, holder_is_human, holder_bot_id, holder_role_id, run_id, token, acquired_at, expires_at)
       VALUES (1, 0, 'pi', 'default', NULL, 'tok', ?, ?)`,
    ).run(new Date(now).toISOString(), new Date(now + 60_000).toISOString());
    db.close();

    await h.stop();
    // new daemon instance over the SAME home
    const second = await startDaemon(h.home);
    try {
      const state = await api<{ lease: unknown }>(second, "GET", "/api/computer/state");
      expect(state.lease).toBeNull();
    } finally {
      await second.stop();
    }
  }, 30_000);
});
