import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BotDto, BotViewDto, ThreadDto } from "../../packages/protocol/src/index.ts";
import { api, apiStatus, makeBot, sendToBot, startDaemon, waitThreadIdle, type Harness } from "./helpers/harness.ts";

describe("Bot archive and restore", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await startDaemon();
  });

  afterEach(async () => {
    await h.stop();
  });

  test("archives an idle Bot without losing its Threads or shared Agent", async () => {
    const archivedBotId = await makeBot(h, "Archive me");
    const siblingBotId = await makeBot(h, "Shared Agent sibling");
    const sent = await sendToBot(h, archivedBotId, "say: keep this conversation");
    await waitThreadIdle(h, sent.threadId);

    const before = await api<BotViewDto>(h, "GET", `/api/bots/${archivedBotId}`);
    const archived = await api<BotDto>(h, "POST", `/api/bots/${archivedBotId}/archive`, {});

    expect(archived.archived).toBe(true);
    expect(archived.agentId).toBe(before.agentId);
    expect((await api<BotViewDto[]>(h, "GET", "/api/bots")).map((bot) => bot.id)).not.toContain(archivedBotId);
    expect((await api<BotViewDto[]>(h, "GET", "/api/bots?includeArchived=1")).find((bot) => bot.id === archivedBotId)?.archived).toBe(true);

    const threads = await api<ThreadDto[]>(h, "GET", `/api/bots/${archivedBotId}/threads`);
    expect(threads.map((thread) => thread.id)).toContain(sent.threadId);
    expect(h.svc.threads.getNativeSession(sent.threadId)).toBeDefined();

    const siblingTurn = await sendToBot(h, siblingBotId, "say: shared Agent still works");
    await waitThreadIdle(h, siblingTurn.threadId);
    expect((await api<BotViewDto>(h, "GET", `/api/bots/${siblingBotId}`)).agentId).toBe(before.agentId);
    expect(h.svc.agents.get(before.agentId)?.status).toBe("ready");
  });

  test("requires confirmation for active work and cancellation leaves work unchanged", async () => {
    const botId = await makeBot(h, "Working Bot");
    const sent = await sendToBot(h, botId, "hang");

    const conflict = await apiStatus(h, "POST", `/api/bots/${botId}/archive`, {});

    expect(conflict).toEqual({ status: 409, body: { error: "working", confirmRequired: true } });
    expect((await api<BotViewDto>(h, "GET", `/api/bots/${botId}`)).archived).toBe(false);
    expect(h.svc.threads.turnRow(sent.turnId)?.status).toBe("working");
  });

  test("confirmed archive uses native abort and reaches terminal state before hiding", async () => {
    const botId = await makeBot(h, "Stop then archive");
    const sent = await sendToBot(h, botId, "hang");

    const archived = await api<BotDto>(h, "POST", `/api/bots/${botId}/archive`, { confirmStop: true });
    const turn = h.svc.threads.turnRow(sent.turnId);

    expect(turn?.status).toBe("cancelled");
    expect(turn?.finished_at).not.toBeNull();
    expect(turn?.outcome_reason).toBe("bot archived");
    expect(archived.archived).toBe(true);
    expect((await api<BotViewDto[]>(h, "GET", "/api/bots")).some((bot) => bot.id === botId)).toBe(false);
  });

  test("restores an archived Bot to its preserved recent-activity ordering", async () => {
    const olderBotId = await makeBot(h, "Older Bot");
    const olderTurn = await sendToBot(h, olderBotId, "say: older activity");
    await waitThreadIdle(h, olderTurn.threadId);

    const newestBotId = await makeBot(h, "Newest Bot");
    const newestTurn = await sendToBot(h, newestBotId, "say: newest activity");
    await waitThreadIdle(h, newestTurn.threadId);
    h.svc.db.query(`UPDATE bot_state SET last_activity_at = ? WHERE bot_id = ?`).run("2026-01-01T00:00:00.000Z", olderBotId);
    h.svc.db.query(`UPDATE bot_state SET last_activity_at = ? WHERE bot_id = ?`).run("2026-01-02T00:00:00.000Z", newestBotId);
    const before = await api<BotViewDto>(h, "GET", `/api/bots/${newestBotId}`);

    await api<BotDto>(h, "POST", `/api/bots/${newestBotId}/archive`, {});
    const fallback = await api<BotViewDto[]>(h, "GET", "/api/bots");
    expect(fallback[0]?.id).toBe(olderBotId);

    const restored = await api<BotDto>(h, "POST", `/api/bots/${newestBotId}/restore`);
    const active = await api<BotViewDto[]>(h, "GET", "/api/bots");
    const restoredView = active.find((bot) => bot.id === newestBotId);

    expect(restored.archived).toBe(false);
    expect(restoredView?.lastActivityAt).toBe(before.lastActivityAt);
    expect(active[0]?.id).toBe(newestBotId);
    expect((await api<ThreadDto[]>(h, "GET", `/api/bots/${newestBotId}/threads`)).map((thread) => thread.id)).toContain(newestTurn.threadId);
  });
});
