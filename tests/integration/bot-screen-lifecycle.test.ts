import { afterEach, describe, expect, test } from "bun:test";
import type { BotDto, ComputerViewDto, DeleteBotResultDto } from "../../packages/protocol/src/index.ts";
import { FakeBotScreenRuntimeAdapter } from "../../apps/daemon/src/modules/computer/fakeBotScreenRuntime.ts";
import { api, apiStatus, makeBot, startDaemon, type Harness } from "./helpers/harness.ts";

async function bot(h: Harness, botId: string): Promise<BotDto> {
  return api(h, "GET", `/api/bots/${botId}`);
}

function computerPath(owner: Pick<BotDto, "id" | "surfaceId">): string {
  return `/api/computer/state?botId=${encodeURIComponent(owner.id)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`;
}

async function waitForState(h: Harness, owner: Pick<BotDto, "id" | "surfaceId">, state: ComputerViewDto["state"]): Promise<ComputerViewDto> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const response = await fetch(`${h.baseUrl}${computerPath(owner)}`);
    if (response.status === 200) {
      const view = await response.json() as ComputerViewDto;
      if (view.state === state) return view;
    }
    if (Date.now() >= deadline) throw new Error(`Computer Surface did not reach ${state}`);
  }
}

describe("Bot Screen lifecycle", () => {
  let h: Harness | undefined;

  afterEach(async () => {
    await h?.stop();
  });

  test("archive releases the runtime and restore reprovisions the same Surface identity", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const owner = await bot(h, await makeBot(h, "Lifecycle Bot"));

    await waitForState(h, owner, "ready");
    expect(adapter.running(owner.surfaceId)).toEqual({ generation: 1 });

    const archived = await api<BotDto>(h, "POST", `/api/bots/${owner.id}/archive`, {});
    expect(archived).toMatchObject({ id: owner.id, surfaceId: owner.surfaceId, archived: true });
    expect(adapter.running(owner.surfaceId)).toBeUndefined();

    const restored = await api<BotDto>(h, "POST", `/api/bots/${owner.id}/restore`);
    expect(restored).toMatchObject({ id: owner.id, surfaceId: owner.surfaceId, archived: false });
    await waitForState(h, owner, "ready");
    expect(adapter.running(owner.surfaceId)).toEqual({ generation: 2 });
  });

  test("permanent deletion destroys the owned runtime before removing Surface persistence", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const owner = await bot(h, await makeBot(h, "Delete Screen"));
    await waitForState(h, owner, "ready");

    await api<BotDto>(h, "POST", `/api/bots/${owner.id}/archive`, {});
    const result = await api<DeleteBotResultDto>(h, "DELETE", `/api/bots/${owner.id}`, {
      confirmName: "Delete Screen",
    });

    expect(result).toMatchObject({ status: "deleted", removed: { surface: true } });
    expect(adapter.destroyed.has(owner.surfaceId)).toBeTrue();
    expect(adapter.running(owner.surfaceId)).toBeUndefined();
    expect((await apiStatus(h, "GET", `/api/bots/${owner.id}`)).status).toBe(404);
    expect(h.svc.db.query(`SELECT 1 FROM bot_surfaces WHERE surface_id = ?`).get(owner.surfaceId)).toBeNull();
  });

  test("daemon restart reconnects a valid supervised runtime without changing its generation", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const owner = await bot(h, await makeBot(h, "Restart Screen"));
    await waitForState(h, owner, "ready");
    const home = h.home;

    await h.disconnectForRestart();
    h = await startDaemon(home, { botScreenAdapter: adapter });

    expect(await waitForState(h, owner, "ready")).toMatchObject({
      botId: owner.id,
      surfaceId: owner.surfaceId,
    });
    expect(adapter.running(owner.surfaceId)).toEqual({ generation: 1 });
    expect(adapter.starts.filter((start) => start.surfaceId === owner.surfaceId)).toHaveLength(1);
  });

  test("daemon restart cleans an invalid runtime tree and reprovisions a new generation", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const owner = await bot(h, await makeBot(h, "Recreate Screen"));
    await waitForState(h, owner, "ready");
    adapter.rejectReconciliation(owner.surfaceId);
    const home = h.home;

    await h.disconnectForRestart();
    h = await startDaemon(home, { botScreenAdapter: adapter });

    await waitForState(h, owner, "ready");
    expect(adapter.running(owner.surfaceId)).toEqual({ generation: 2 });
    expect(adapter.stops).toContainEqual({ surfaceId: owner.surfaceId, runtimeGeneration: 1 });
    expect(adapter.starts.filter((start) => start.surfaceId === owner.surfaceId).map((start) => start.generation))
      .toEqual([1, 2]);
  });

  test("repeated archive, restore, crash, and delete cycles leave no owned runtime behind", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const first = await bot(h, await makeBot(h, "Repeated Lifecycle"));
    const second = await bot(h, await makeBot(h, "Isolated Lifecycle"));
    await Promise.all([waitForState(h, first, "ready"), waitForState(h, second, "ready")]);

    for (let cycle = 0; cycle < 2; cycle += 1) {
      await api<BotDto>(h, "POST", `/api/bots/${first.id}/archive`, {});
      expect(adapter.running(first.surfaceId)).toBeUndefined();
      const restored = await api<BotDto>(h, "POST", `/api/bots/${first.id}/restore`);
      expect(restored.surfaceId).toBe(first.surfaceId);
      await waitForState(h, first, "ready");
    }

    const livePreview = await fetch(
      `${h.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(first.id)}&surfaceId=${encodeURIComponent(first.surfaceId)}`,
    );
    expect(livePreview.status).toBe(200);

    adapter.crash(first.surfaceId, "fake capture helper crashed");
    await waitForState(h, first, "unavailable");
    const unavailablePreview = await fetch(
      `${h.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(first.id)}&surfaceId=${encodeURIComponent(first.surfaceId)}`,
    );
    expect(unavailablePreview.status).toBe(503);
    expect(await waitForState(h, second, "ready")).toMatchObject({
      botId: second.id,
      surfaceId: second.surfaceId,
    });

    await api<BotDto>(h, "POST", `/api/bots/${first.id}/archive`, {});
    await api<DeleteBotResultDto>(h, "DELETE", `/api/bots/${first.id}`, { confirmName: "Repeated Lifecycle" });
    await api<BotDto>(h, "POST", `/api/bots/${second.id}/archive`, {});
    await api<DeleteBotResultDto>(h, "DELETE", `/api/bots/${second.id}`, { confirmName: "Isolated Lifecycle" });

    expect(adapter.running(first.surfaceId)).toBeUndefined();
    expect(adapter.running(second.surfaceId)).toBeUndefined();
    expect(adapter.destroyed).toEqual(new Set([first.surfaceId, second.surfaceId]));
    for (const table of ["bot_surfaces", "artifacts", "input_diagnostics", "bot_deletions"]) {
      expect(h.svc.db.query(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
  });
});
