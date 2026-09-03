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

async function activateScreen(
  h: Harness,
  owner: Pick<BotDto, "id" | "surfaceId">,
): Promise<ComputerViewDto> {
  const snapshot = await fetch(
    `${h.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(owner.id)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`,
  );
  expect(snapshot.status).toBe(200);
  return waitForState(h, owner, "ready");
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

    await activateScreen(h, owner);
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
    await activateScreen(h, owner);

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
    await activateScreen(h, owner);
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
    await activateScreen(h, owner);
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
    await Promise.all([activateScreen(h, first), activateScreen(h, second)]);

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
  test("rejects a Bot Screen before provisioning when measured capacity is full", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter, botScreenCapacity: 1 });
    const first = await bot(h, await makeBot(h, "Admitted Screen"));
    const second = await bot(h, await makeBot(h, "Busy Screen"));
    await activateScreen(h, first);

    const startsBeforeRejection = adapter.starts.length;
    const rejected = await apiStatus(h, "GET", computerPath(second));
    expect(rejected).toEqual({
      status: 503,
      body: {
        botId: second.id,
        surfaceId: second.surfaceId,
        state: "unavailable",
        takeover: "unavailable",
        activity: "Bot Screen capacity is full (1/1).",
        unavailableReason: "capacity",
        capacity: { active: 1, limit: 1 },
      },
    });
    expect(adapter.starts).toHaveLength(startsBeforeRejection);
    expect(await waitForState(h, first, "ready")).toMatchObject({ surfaceId: first.surfaceId });
    expect((await fetch(`${h.baseUrl}/api/computer/snapshot?botId=${first.id}&surfaceId=${first.surfaceId}`)).status)
      .toBe(200);

    await api<BotDto>(h, "POST", `/api/bots/${first.id}/archive`, {});
    expect((await apiStatus(h, "GET", computerPath(second))).status).toBe(200);
    await activateScreen(h, second);
    expect(adapter.running(second.surfaceId)).toEqual({ generation: 1 });
  });

  test("recovery sheds excess runtimes before admitting Screens at a lower capacity", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter, botScreenCapacity: 2 });
    const owners = await Promise.all([
      bot(h, await makeBot(h, "Recovery capacity A")),
      bot(h, await makeBot(h, "Recovery capacity B")),
    ]);
    await Promise.all(owners.map((owner) => activateScreen(h!, owner)));
    const home = h.home;

    await h.disconnectForRestart();
    h = await startDaemon(home, { botScreenAdapter: adapter, botScreenCapacity: 1 });

    const results = await Promise.all(owners.map((owner) => apiStatus(h!, "GET", computerPath(owner))));
    expect(results.map((result) => result.status).sort()).toEqual([200, 503]);
    expect(owners.filter((owner) => adapter.running(owner.surfaceId) !== undefined)).toHaveLength(1);
  });


  test("an invalid native input envelope is rejected without failing its Screen runtime", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const owner = await bot(h, await makeBot(h, "Rejected input envelope"));
    await activateScreen(h, owner);
    const source = await h.svc.screens.projectionSource({ botId: owner.id, surfaceId: owner.surfaceId });
    expect(source).toBeDefined();

    await source!.setInputAuthority(4);
    await expect(source!.input({
      type: "motion",
      surfaceId: source!.surfaceId,
      runtimeGeneration: source!.runtimeGeneration + 1,
      geometryGeneration: source!.geometryGeneration,
      controllerEpoch: 4,
      sequence: 1,
      x: 10,
      y: 10,
    })).rejects.toThrow("rejected the input envelope");

    expect(h.svc.screens.status({ botId: owner.id, surfaceId: owner.surfaceId })).toEqual({ state: "ready" });
    await expect(source!.input({
      type: "motion",
      surfaceId: source!.surfaceId,
      runtimeGeneration: source!.runtimeGeneration,
      geometryGeneration: source!.geometryGeneration,
      controllerEpoch: 4,
      sequence: 1,
      x: 10,
      y: 10,
    })).resolves.toBeUndefined();
    expect(adapter.running(owner.surfaceId)).toEqual({ generation: 1 });
  });

  test("status stays inactive and a first-start display profile survives changed daemon configuration", async () => {
    const previousProfile = process.env.OMARCHY_BOT_SCREEN_PROFILE;
    const previousFrameRate = process.env.OMARCHY_BOT_SCREEN_FRAME_RATE;
    const adapter = new FakeBotScreenRuntimeAdapter();
    try {
      process.env.OMARCHY_BOT_SCREEN_PROFILE = "720p";
      process.env.OMARCHY_BOT_SCREEN_FRAME_RATE = "9";
      h = await startDaemon(undefined, { botScreenAdapter: adapter });
      const owner = await bot(h, await makeBot(h, "Persisted display profile"));
      expect(h.svc.screens.status({ botId: owner.id, surfaceId: owner.surfaceId })).toEqual({ state: "stopped" });
      expect(adapter.starts).toHaveLength(0);

      expect(await apiStatus(h, "GET", computerPath(owner))).toMatchObject({
        status: 200,
        body: { state: "starting", activity: "Screen starting." },
      });
      expect(adapter.starts).toHaveLength(0);

      await activateScreen(h, owner);
      expect(adapter.starts).toEqual([
        {
          surfaceId: owner.surfaceId,
          generation: 1,
          geometryGeneration: 1,
          logicalWidth: 1280,
          logicalHeight: 720,
          scale: 1,
          refreshRate: 60,
        },
      ]);
      expect(
        h.svc.db
          .query(
            `SELECT logical_width, logical_height, scale, refresh_rate
             FROM bot_surfaces WHERE surface_id = ?`,
          )
          .get(owner.surfaceId),
      ).toEqual({ logical_width: 1280, logical_height: 720, scale: 1, refresh_rate: 60 });

      adapter.rejectReconciliation(owner.surfaceId);
      const home = h.home;
      await h.disconnectForRestart();
      process.env.OMARCHY_BOT_SCREEN_PROFILE = "1080p";
      process.env.OMARCHY_BOT_SCREEN_FRAME_RATE = "30";
      h = await startDaemon(home, { botScreenAdapter: adapter });
      await waitForState(h, owner, "ready");

      expect(adapter.starts.at(-1)).toEqual({
        surfaceId: owner.surfaceId,
        generation: 2,
        geometryGeneration: 1,
        logicalWidth: 1280,
        logicalHeight: 720,
        scale: 1,
        refreshRate: 60,
      });
    } finally {
      if (previousProfile === undefined) delete process.env.OMARCHY_BOT_SCREEN_PROFILE;
      else process.env.OMARCHY_BOT_SCREEN_PROFILE = previousProfile;
      if (previousFrameRate === undefined) delete process.env.OMARCHY_BOT_SCREEN_FRAME_RATE;
      else process.env.OMARCHY_BOT_SCREEN_FRAME_RATE = previousFrameRate;
    }
  });
});
