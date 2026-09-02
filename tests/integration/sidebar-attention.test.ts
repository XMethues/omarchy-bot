import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BotDto, BotViewDto, ThreadDto } from "../../packages/protocol/src/index.ts";
import { api, makeBot, sendToBot, startDaemon, waitThreadIdle, type Harness } from "./helpers/harness.ts";

describe("Sidebar attention", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await startDaemon();
  });

  afterEach(async () => {
    await h.stop();
  });

  test("keeps the last useful preview within 120 characters and orders active Bots by activity", async () => {
    const olderBotId = await makeBot(h, "Older activity");
    const newerBotId = await makeBot(h, "Newer activity");
    const longReply = "A".repeat(140);

    const older = await sendToBot(h, olderBotId, "say: older reply");
    await waitThreadIdle(h, older.threadId);
    const newer = await sendToBot(h, newerBotId, `say: ${longReply}`);
    await waitThreadIdle(h, newer.threadId);

    h.svc.db.query("UPDATE bot_state SET last_activity_at = ? WHERE bot_id = ?").run("2026-01-01T00:00:00.000Z", olderBotId);
    h.svc.db.query("UPDATE bot_state SET last_activity_at = ? WHERE bot_id = ?").run("2026-01-02T00:00:00.000Z", newerBotId);

    const active = await api<BotViewDto[]>(h, "GET", "/api/bots");
    expect(active.map((bot) => bot.id)).toEqual([newerBotId, olderBotId]);
    expect(active[0]?.previewText).toBe("A".repeat(120));
    expect(active[0]?.previewText?.length).toBe(120);
  });

  test("persists pin and unpin without mutating Thread recency", async () => {
    const botId = await makeBot(h, "Pin target");
    const sent = await sendToBot(h, botId, "say: preserve thread recency");
    await waitThreadIdle(h, sent.threadId);
    const before = await api<ThreadDto>(h, "GET", `/api/threads/${sent.threadId}`);

    const pinned = await api<BotDto>(h, "POST", `/api/bots/${botId}/pin`, { pinned: true });
    const afterPin = await api<ThreadDto>(h, "GET", `/api/threads/${sent.threadId}`);
    const unpinned = await api<BotDto>(h, "POST", `/api/bots/${botId}/pin`, { pinned: false });
    const afterUnpin = await api<ThreadDto>(h, "GET", `/api/threads/${sent.threadId}`);

    expect(pinned.pinned).toBe(true);
    expect(unpinned.pinned).toBe(false);
    expect(afterPin.updatedAt).toBe(before.updatedAt);
    expect(afterUnpin.updatedAt).toBe(before.updatedAt);
  });

  test("puts pinned Bots above recent Bots while preserving activity order within each group", async () => {
    const oldestPinnedId = await makeBot(h, "Old pinned");
    const newestUnpinnedId = await makeBot(h, "New unpinned");
    const middlePinnedId = await makeBot(h, "Middle pinned");
    h.svc.bots.recordActivity(oldestPinnedId, "thread-old", "old", false);
    h.svc.bots.recordActivity(newestUnpinnedId, "thread-new", "new", false);
    h.svc.bots.recordActivity(middlePinnedId, "thread-middle", "middle", false);
    h.svc.db.query("UPDATE bot_state SET last_activity_at = ? WHERE bot_id = ?").run("2026-01-01T00:00:00.000Z", oldestPinnedId);
    h.svc.db.query("UPDATE bot_state SET last_activity_at = ? WHERE bot_id = ?").run("2026-01-03T00:00:00.000Z", newestUnpinnedId);
    h.svc.db.query("UPDATE bot_state SET last_activity_at = ? WHERE bot_id = ?").run("2026-01-02T00:00:00.000Z", middlePinnedId);
    await api<BotDto>(h, "POST", `/api/bots/${oldestPinnedId}/pin`, { pinned: true });
    await api<BotDto>(h, "POST", `/api/bots/${middlePinnedId}/pin`, { pinned: true });

    const active = await api<BotViewDto[]>(h, "GET", "/api/bots");
    expect(active.map((bot) => bot.id)).toEqual([middlePinnedId, oldestPinnedId, newestUnpinnedId]);
  });

  test("increments unread only for the Bot producing background output and clears only its matching Thread", async () => {
    const firstBotId = await makeBot(h, "First background Bot");
    const secondBotId = await makeBot(h, "Second background Bot");
    const first = await sendToBot(h, firstBotId, "say: first finished");
    const second = await sendToBot(h, secondBotId, "say: second finished");
    await Promise.all([waitThreadIdle(h, first.threadId), waitThreadIdle(h, second.threadId)]);

    const beforeFirst = await api<BotViewDto>(h, "GET", `/api/bots/${firstBotId}`);
    const beforeSecond = await api<BotViewDto>(h, "GET", `/api/bots/${secondBotId}`);
    expect(beforeFirst.unreadCount).toBe(1);
    expect(beforeFirst.unreadThreadId).toBe(first.threadId);
    expect(beforeSecond.unreadCount).toBe(1);
    expect(beforeSecond.unreadThreadId).toBe(second.threadId);

    const wrongThread = await api<BotViewDto>(h, "POST", `/api/bots/${firstBotId}/read`, { threadId: second.threadId });
    expect(wrongThread.unreadCount).toBe(1);

    const read = await api<BotViewDto>(h, "POST", `/api/bots/${firstBotId}/read`, { threadId: first.threadId });
    const untouched = await api<BotViewDto>(h, "GET", `/api/bots/${secondBotId}`);
    expect(read.unreadCount).toBe(0);
    expect(read.unreadThreadId).toBeUndefined();
    expect(untouched.unreadCount).toBe(1);
  });

  test("excludes archived Bots from the active attention ordering", async () => {
    const activeBotId = await makeBot(h, "Still active");
    const archivedBotId = await makeBot(h, "Hidden archive");
    await api<BotDto>(h, "POST", `/api/bots/${archivedBotId}/pin`, { pinned: true });
    await api<BotDto>(h, "POST", `/api/bots/${archivedBotId}/archive`, {});

    const active = await api<BotViewDto[]>(h, "GET", "/api/bots");
    expect(active.map((bot) => bot.id)).toEqual([activeBotId]);
  });
});
