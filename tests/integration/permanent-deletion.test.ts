import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AttachmentDto, BotViewDto, DeleteBotResultDto } from "../../packages/protocol/src/index.ts";
import { api, apiStatus, makeBot, sendToBot, startDaemon, waitThreadIdle, type Harness } from "./helpers/harness.ts";

async function stageAttachment(h: Harness, botId: string, contents: string, name: string): Promise<AttachmentDto> {
  const form = new FormData();
  form.set("file", new Blob([contents], { type: "text/plain" }), name);
  const response = await fetch(`${h.baseUrl}/api/attachments/stage`, {
    method: "POST",
    headers: { "x-bot-id": botId, "x-command-id": crypto.randomUUID() },
    body: form,
  });
  if (!response.ok) throw new Error(`attachment staging failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<AttachmentDto>;
}

describe("permanent archived Bot deletion", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await startDaemon();
  });

  afterEach(async () => {
    await h.stop();
  });

  test("gates deletion to an archived Bot and its exact confirmation name", async () => {
    const botId = await makeBot(h, "Exact archived name");

    const active = await apiStatus(h, "DELETE", `/api/bots/${botId}`, { confirmName: "Exact archived name" });
    expect(active).toEqual({ status: 409, body: { error: "only archived bots can be permanently deleted" } });

    await api(h, "POST", `/api/bots/${botId}/archive`, {});
    const wrongName = await apiStatus(h, "DELETE", `/api/bots/${botId}`, { confirmName: "wrong name" });
    expect(wrongName).toEqual({ status: 400, body: { error: "confirmation name does not match the archived bot" } });
    expect((await api<BotViewDto>(h, "GET", `/api/bots/${botId}`)).archived).toBeTrue();
  });

  test("removes Bot-owned database rows and files while preserving the shared Agent and sibling Bot", async () => {
    const botId = await makeBot(h, "Delete all owned data");
    const siblingId = await makeBot(h, "Shared Agent sibling survives");
    const managed = await stageAttachment(h, botId, "managed bytes", "managed.txt");
    const staged = await stageAttachment(h, botId, "staged bytes", "staged.txt");
    const sent = await api<{ threadId: string; messageId: string; turnId: string }>(h, "POST", `/api/bots/${botId}/messages`, {
      text: "attachment-echo",
      attachmentIds: [managed.id],
    });
    await waitThreadIdle(h, sent.threadId);

    const avatarFile = `${botId}.png`;
    const avatarPath = path.join(h.svc.cfg.avatarsDir, avatarFile);
    writeFileSync(avatarPath, "uploaded avatar bytes");
    h.svc.db.query(`UPDATE bots SET avatar_kind='upload', avatar_file=? WHERE id=?`).run(avatarFile, botId);
    const managedPath = path.join(h.svc.cfg.attachmentsDir, "managed", managed.id);
    const stagedPath = path.join(h.svc.cfg.attachmentsDir, "staged", staged.id);
    expect(existsSync(managedPath)).toBeTrue();
    expect(existsSync(stagedPath)).toBeTrue();
    expect(existsSync(avatarPath)).toBeTrue();

    await api(h, "POST", `/api/bots/${botId}/archive`, {});
    const result = await api<DeleteBotResultDto>(h, "DELETE", `/api/bots/${botId}`, { confirmName: "Delete all owned data" });

    expect(result.status).toBe("deleted");
    expect(result.removed).toEqual({
      threads: 1,
      messages: 2,
      turns: 1,
      attachments: 2,
      avatar: true,
      nativeSessions: 1,
    });
    expect(result.nativeSessionCleanup).toEqual({ supported: true, skipped: 0 });
    expect(existsSync(managedPath)).toBeFalse();
    expect(existsSync(stagedPath)).toBeFalse();
    expect(existsSync(avatarPath)).toBeFalse();
    expect((await apiStatus(h, "GET", `/api/bots/${botId}`)).status).toBe(404);
    expect((await apiStatus(h, "GET", `/api/threads/${sent.threadId}`)).status).toBe(404);
    expect(h.svc.db.query(`SELECT COUNT(*) AS count FROM messages WHERE thread_id=?`).get(sent.threadId)).toEqual({ count: 0 });
    expect(h.svc.db.query(`SELECT COUNT(*) AS count FROM turns WHERE bot_id=?`).get(botId)).toEqual({ count: 0 });
    expect(h.svc.db.query(`SELECT COUNT(*) AS count FROM thread_sessions WHERE thread_id=?`).get(sent.threadId)).toEqual({ count: 0 });
    expect(h.svc.db.query(`SELECT COUNT(*) AS count FROM attachments WHERE bot_id=?`).get(botId)).toEqual({ count: 0 });
    expect(
      h.svc.db.query(`SELECT type FROM events WHERE aggregate_type='bot' AND aggregate_id=? ORDER BY cursor`).all(botId),
    ).toEqual([{ type: "bot.deleted" }]);

    const sibling = await api<BotViewDto>(h, "GET", `/api/bots/${siblingId}`);
    expect(sibling.agentId).toBe("pi");
    expect(h.svc.agents.get("pi")?.status).toBe("ready");
    const siblingTurn = await sendToBot(h, siblingId, "say: sibling still works");
    await waitThreadIdle(h, siblingTurn.threadId);
  });

  test("reports native cleanup failure and keeps a retryable archived record", async () => {
    const botId = await makeBot(h, "Retry failed deletion");
    const sent = await sendToBot(h, botId, "say: create native session");
    await waitThreadIdle(h, sent.threadId);
    const original = h.svc.threads.getNativeSession(sent.threadId);
    expect(original).toBeDefined();
    h.svc.db.query(`UPDATE thread_sessions SET native_session_id='fake://fail-delete' WHERE thread_id=?`).run(sent.threadId);
    h.svc.db.query(`UPDATE turns SET native_session_id='fake://fail-delete' WHERE bot_id=?`).run(botId);
    await api(h, "POST", `/api/bots/${botId}/archive`, {});

    const failed = await apiStatus(h, "DELETE", `/api/bots/${botId}`, { confirmName: "Retry failed deletion" });
    expect(failed.status).toBe(409);
    const result = failed.body as DeleteBotResultDto;
    expect(result.status).toBe("failed");
    expect(result.failures).toEqual([
      {
        stage: "native_session",
        resource: "fake://fail-delete",
        message: "native session deletion failed for fake://fail-delete",
      },
    ]);
    expect((await api<BotViewDto>(h, "GET", `/api/bots/${botId}`)).archived).toBeTrue();
    expect(h.svc.threads.getThread(sent.threadId)).toBeDefined();
    expect((await apiStatus(h, "POST", `/api/bots/${botId}/restore`)).status).toBe(409);
    expect(h.svc.db.query(`SELECT state FROM bot_deletions WHERE bot_id=?`).get(botId)).toEqual({ state: "failed" });

    h.svc.db.query(`UPDATE thread_sessions SET native_session_id=? WHERE thread_id=?`).run(original!, sent.threadId);
    h.svc.db.query(`UPDATE turns SET native_session_id=? WHERE bot_id=?`).run(original!, botId);
    const retried = await api<DeleteBotResultDto>(h, "DELETE", `/api/bots/${botId}`, { confirmName: "Retry failed deletion" });
    expect(retried.status).toBe("deleted");
    expect((await apiStatus(h, "GET", `/api/bots/${botId}`)).status).toBe(404);
  });

  test("reports managed-file cleanup failure without deleting the archived database record", async () => {
    const botId = await makeBot(h, "Retry filesystem cleanup");
    const staged = await stageAttachment(h, botId, "owned bytes", "owned.txt");
    h.svc.db.query(`UPDATE attachments SET rel_path='../../outside-managed-root' WHERE id=?`).run(staged.id);
    await api(h, "POST", `/api/bots/${botId}/archive`, {});

    const failed = await apiStatus(h, "DELETE", `/api/bots/${botId}`, { confirmName: "Retry filesystem cleanup" });
    expect(failed.status).toBe(409);
    const result = failed.body as DeleteBotResultDto;
    expect(result.status).toBe("failed");
    expect(result.failures[0]).toEqual({
      stage: "attachment",
      resource: staged.id,
      message: "stored attachment path escapes the managed root",
    });
    expect((await api<BotViewDto>(h, "GET", `/api/bots/${botId}`)).archived).toBeTrue();
    expect(h.svc.db.query(`SELECT id FROM attachments WHERE id=?`).get(staged.id)).toEqual({ id: staged.id });

    h.svc.db.query(`UPDATE attachments SET rel_path=? WHERE id=?`).run(path.join("staged", staged.id), staged.id);
    const retried = await api<DeleteBotResultDto>(h, "DELETE", `/api/bots/${botId}`, { confirmName: "Retry filesystem cleanup" });
    expect(retried.status).toBe("deleted");
  });
});
