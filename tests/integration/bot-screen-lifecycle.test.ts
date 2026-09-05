import { afterEach, describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BotDto, ComputerViewDto, DeleteBotResultDto, ThreadDto } from "../../packages/protocol/src/index.ts";
import { CageBotScreenRuntimeAdapter } from "../../apps/daemon/src/modules/computer/cageBotScreenRuntime.ts";
import { FakeBotScreenRuntimeAdapter } from "../../apps/daemon/src/modules/computer/fakeBotScreenRuntime.ts";
import {
  api,
  apiStatus,
  makeBot,
  sendToBot,
  sendToThread,
  startDaemon,
  waitThreadIdle,
  type Harness,
} from "./helpers/harness.ts";

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


  test("direct deletion destroys the owned runtime before removing Surface persistence", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const projectionCleanup = h.svc.projections.closeSurface.bind(h.svc.projections);
    const projectionClosures: string[] = [];
    h.svc.projections.closeSurface = async (surfaceId) => {
      projectionClosures.push(surfaceId);
      await projectionCleanup(surfaceId);
    };
    const owner = await bot(h, await makeBot(h, "Delete Screen"));
    await activateScreen(h, owner);
    const source = await h.svc.screens.projectionSource({ botId: owner.id, surfaceId: owner.surfaceId });
    const captureStream = await source!.openCaptureStream();
    await captureStream.next();

    const result = await api<DeleteBotResultDto>(h, "DELETE", `/api/bots/${owner.id}`, {});

    expect(result).toMatchObject({ status: "deleted", removed: { surface: true } });
    expect(adapter.destroyed.has(owner.surfaceId)).toBeTrue();
    expect(adapter.running(owner.surfaceId)).toBeUndefined();
    expect(adapter.captureStreamsClosed).toBe(1);
    expect(projectionClosures).toContain(owner.surfaceId);
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

  test("a recovered failed Screen retries at a fresh generation without disturbing its sibling or deletion", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const failed = await bot(h, await makeBot(h, "Failed Lifecycle"));
    const unaffected = await bot(h, await makeBot(h, "Isolated Lifecycle"));
    await Promise.all([activateScreen(h, failed), activateScreen(h, unaffected)]);

    adapter.exitComputerWorker(failed.surfaceId, "fake computer worker crashed");
    await waitForState(h, failed, "unavailable");
    const cleanupDeadline = Date.now() + 5_000;
    while (adapter.running(failed.surfaceId) !== undefined) {
      if (Date.now() >= cleanupDeadline) throw new Error("failed Screen runtime was not cleaned");
      await Bun.sleep(1);
    }
    const startsBeforeRestart = adapter.starts.length;
    const home = h.home;
    await h.disconnectForRestart();
    h = await startDaemon(home, { botScreenAdapter: adapter });

    const recoveredFailure = await apiStatus(h, "GET", computerPath(failed));
    expect(recoveredFailure.status).toBe(200);
    expect(recoveredFailure.body).toMatchObject({
      botId: failed.id,
      surfaceId: failed.surfaceId,
      state: "unavailable",
      activity: "Bot Screen computer worker failed: fake computer worker crashed",
      takeover: "unavailable",
    });
    expect(adapter.starts).toHaveLength(startsBeforeRestart);

    await activateScreen(h, failed);
    expect(adapter.running(failed.surfaceId)).toEqual({ generation: 2 });
    expect(await waitForState(h, unaffected, "ready")).toMatchObject({
      botId: unaffected.id,
      surfaceId: unaffected.surfaceId,
    });
    expect(adapter.running(unaffected.surfaceId)).toEqual({ generation: 1 });
    const unaffectedPreview = await fetch(
      `${h.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(unaffected.id)}&surfaceId=${encodeURIComponent(unaffected.surfaceId)}`,
    );
    expect(unaffectedPreview.status).toBe(200);
    await api<DeleteBotResultDto>(h, "DELETE", `/api/bots/${failed.id}`, {});
    await api<DeleteBotResultDto>(h, "DELETE", `/api/bots/${unaffected.id}`, {});

    expect(adapter.running(failed.surfaceId)).toBeUndefined();
    expect(adapter.running(unaffected.surfaceId)).toBeUndefined();
    expect(adapter.destroyed).toEqual(new Set([failed.surfaceId, unaffected.surfaceId]));
    for (const table of ["bot_surfaces", "artifacts", "input_diagnostics", "bot_deletions"]) {
      expect(h.svc.db.query(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
    }
  });

  test("an application launch failure is reported without failing its Bot Desktop or Screen", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter(undefined, { actionFailureAt: 1 });
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const owner = await bot(h, await makeBot(h, "Application launch failure"));
    await activateScreen(h, owner);

    await expect(h.svc.screens.act(
      { botId: owner.id, surfaceId: owner.surfaceId },
      { name: "open_app", args: { app: "missing.desktop" } },
      { botId: owner.id, surfaceId: owner.surfaceId, turnId: "application-failure" },
    )).rejects.toThrow("fake application launch failed");
    expect(h.svc.screens.status({ botId: owner.id, surfaceId: owner.surfaceId })).toEqual({ state: "ready" });
    expect((await fetch(
      `${h.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(owner.id)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`,
    )).status).toBe(200);
  });

  test("application exit stays ready while Desktop, helper, worker, and compositor failures remain Surface-scoped", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const affected = await bot(h, await makeBot(h, "Component outcomes"));
    const unaffected = await bot(h, await makeBot(h, "Outcome isolation"));
    await Promise.all([activateScreen(h, affected), activateScreen(h, unaffected)]);

    adapter.exitApplication(affected.surfaceId);
    expect(h.svc.screens.status({ botId: affected.id, surfaceId: affected.surfaceId })).toEqual({
      state: "ready",
    });
    expect(adapter.applicationExits).toEqual([{ surfaceId: affected.surfaceId, runtimeGeneration: 1 }]);
    expect((await fetch(
      `${h.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(affected.id)}&surfaceId=${encodeURIComponent(affected.surfaceId)}`,
    )).status).toBe(200);

    const failures = [
      {
        type: "desktop-exited" as const,
        fail: () => adapter.exitDesktop(affected.surfaceId),
        message: "Bot Desktop failed: fake Bot Desktop exited",
      },
      {
        type: "input-helper-exited" as const,
        fail: () => adapter.exitInputHelper(affected.surfaceId),
        message: "Bot Screen input helper failed: fake Bot Screen input helper exited",
      },
      {
        type: "computer-worker-exited" as const,
        fail: () => adapter.exitComputerWorker(affected.surfaceId),
        message: "Bot Screen computer worker failed: fake Bot Screen computer worker exited",
      },
      {
        type: "compositor-exited" as const,
        fail: () => adapter.exitCompositor(affected.surfaceId),
        message: "Bot Screen compositor failed: fake Bot Screen compositor exited",
      },
    ];

    let generation = 1;
    for (const failure of failures) {
      const staleSource = await h.svc.screens.projectionSource({
        botId: affected.id,
        surfaceId: affected.surfaceId,
      });
      const staleStream = await staleSource!.openCaptureStream();
      const outcome = adapter.runtimeOutcome(affected.surfaceId);
      failure.fail();
      expect((await outcome).type).toBe(failure.type);
      await waitForState(h, affected, "unavailable");
      expect(h.svc.screens.status({ botId: affected.id, surfaceId: affected.surfaceId })).toEqual({
        state: "failed",
        failure: failure.message,
      });
      await expect(staleSource!.capture()).rejects.toThrow("stale");
      await expect(staleStream.next()).rejects.toThrow();
      expect(await waitForState(h, unaffected, "ready")).toMatchObject({ surfaceId: unaffected.surfaceId });
      expect((await fetch(
        `${h.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(unaffected.id)}&surfaceId=${encodeURIComponent(unaffected.surfaceId)}`,
      )).status).toBe(200);

      await activateScreen(h, affected);
      generation += 1;
      const replacement = await h.svc.screens.projectionSource({
        botId: affected.id,
        surfaceId: affected.surfaceId,
      });
      expect(replacement).toMatchObject({
        surfaceId: affected.surfaceId,
        runtimeGeneration: generation,
        geometryGeneration: 1,
      });
      expect(adapter.running(affected.surfaceId)).toEqual({ generation });
    }
    expect(adapter.running(unaffected.surfaceId)).toEqual({ generation: 1 });
  });

  test("input-release cleanup failure stays on the affected Screen and leaves it retryable", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const affected = await bot(h, await makeBot(h, "Release cleanup"));
    const unaffected = await bot(h, await makeBot(h, "Release isolation"));
    await Promise.all([activateScreen(h, affected), activateScreen(h, unaffected)]);
    const source = await h.svc.screens.projectionSource({
      botId: affected.id,
      surfaceId: affected.surfaceId,
    });
    await source!.setInputAuthority(4);
    adapter.failNextRelease(affected.surfaceId);

    await expect(source!.releaseInput(4)).rejects.toThrow("fake Bot Screen input release failed");
    expect(h.svc.screens.status({ botId: affected.id, surfaceId: affected.surfaceId })).toEqual({
      state: "ready",
    });
    expect(adapter.running(affected.surfaceId)).toEqual({ generation: 1 });
    expect(await waitForState(h, unaffected, "ready")).toMatchObject({
      surfaceId: unaffected.surfaceId,
    });
    expect((await fetch(
      `${h.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(affected.id)}&surfaceId=${encodeURIComponent(affected.surfaceId)}`,
    )).status).toBe(200);
    expect((await fetch(
      `${h.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(unaffected.id)}&surfaceId=${encodeURIComponent(unaffected.surfaceId)}`,
    )).status).toBe(200);
  });

  test("reprovision invalidates queued input, controller authority, geometry, streams, and worker generation", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const owner = await bot(h, await makeBot(h, "Stale runtime bindings"));
    await activateScreen(h, owner);
    const stale = await h.svc.screens.projectionSource({ botId: owner.id, surfaceId: owner.surfaceId });
    const stream = await stale!.openCaptureStream();
    await stale!.setInputAuthority(7);
    adapter.blockInputs();
    let inFlight!: Promise<void>;
    let queued!: Promise<void>;
    try {
      inFlight = stale!.input({
        surfaceId: stale!.surfaceId,
        runtimeGeneration: stale!.runtimeGeneration,
        geometryGeneration: stale!.geometryGeneration,
        controllerEpoch: 7,
        sequence: 1,
        type: "motion",
        x: 10,
        y: 20,
      });
      void inFlight.catch(() => {});
      await adapter.waitForInputAttempts(1);
      queued = stale!.input({
        surfaceId: stale!.surfaceId,
        runtimeGeneration: stale!.runtimeGeneration,
        geometryGeneration: stale!.geometryGeneration,
        controllerEpoch: 7,
        sequence: 2,
        type: "key",
        keyCode: 30,
        state: "pressed",
      });
      void queued.catch(() => {});
      adapter.exitDesktop(owner.surfaceId);
      await waitForState(h, owner, "unavailable");
    } finally {
      adapter.releaseInputs();
    }
    await expect(inFlight).rejects.toThrow("stopped");
    await expect(queued).rejects.toThrow("stale");
    await expect(stream.next()).rejects.toThrow();
    await expect(stale!.setInputAuthority(8)).rejects.toThrow("stale");

    await activateScreen(h, owner);
    const replacement = await h.svc.screens.projectionSource({ botId: owner.id, surfaceId: owner.surfaceId });
    expect(replacement).toMatchObject({
      surfaceId: owner.surfaceId,
      runtimeGeneration: 2,
      geometryGeneration: 1,
    });
    await replacement!.setInputAuthority(1);
    await replacement!.input({
      surfaceId: replacement!.surfaceId,
      runtimeGeneration: replacement!.runtimeGeneration,
      geometryGeneration: replacement!.geometryGeneration,
      controllerEpoch: 1,
      sequence: 1,
      type: "key",
      keyCode: 30,
      state: "released",
    });
    expect(adapter.inputEvents.at(-1)).toMatchObject({
      surfaceId: owner.surfaceId,
      runtimeGeneration: 2,
    });
  });

  test("repeated provision and deletion cycles allocate fresh Surfaces and release every runtime binding", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter, botScreenCapacity: 1 });
    const surfaceIds = new Set<string>();

    for (let cycle = 0; cycle < 5; cycle += 1) {
      const owner = await bot(h, await makeBot(h, `Lifecycle cycle ${cycle}`));
      expect(surfaceIds.has(owner.surfaceId)).toBeFalse();
      surfaceIds.add(owner.surfaceId);
      await activateScreen(h, owner);
      const source = await h.svc.screens.projectionSource({ botId: owner.id, surfaceId: owner.surfaceId });
      const stream = await source!.openCaptureStream();
      await stream.next();

      const result = await api<DeleteBotResultDto>(h, "DELETE", `/api/bots/${owner.id}`, {});
      expect(result).toMatchObject({ status: "deleted", removed: { surface: true } });
      expect(adapter.running(owner.surfaceId)).toBeUndefined();
      expect(adapter.destroyed.has(owner.surfaceId)).toBeTrue();
      await expect(source!.capture()).rejects.toThrow("unknown Computer Surface");
    }

    expect(surfaceIds.size).toBe(5);
    expect(adapter.starts).toHaveLength(5);
    expect(adapter.stops).toHaveLength(5);
    expect(adapter.destroyed.size).toBe(5);
    expect(adapter.captureStreamsOpened).toBe(5);
    expect(adapter.captureStreamsClosed).toBe(5);
    expect(h.svc.db.query(`SELECT COUNT(*) AS count FROM bot_surfaces`).get()).toEqual({ count: 0 });
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

    await api<DeleteBotResultDto>(h, "DELETE", `/api/bots/${first.id}`, {});
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

  test("creating a Bot and opening Threads does not start a desktop until the first graphical use", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const owner = await bot(h, await makeBot(h, "On-demand unused Bot"));
    expect(h.svc.screens.status({ botId: owner.id, surfaceId: owner.surfaceId })).toEqual({ state: "stopped" });
    expect(adapter.starts).toHaveLength(0);
    expect(adapter.running(owner.surfaceId)).toBeUndefined();

    const first = await sendToBot(h, owner.id, "say: first conversation");
    await waitThreadIdle(h, first.threadId);
    const second = await sendToBot(h, owner.id, "say: second conversation");
    await waitThreadIdle(h, second.threadId);
    const threads = await api<ThreadDto[]>(h, "GET", `/api/bots/${owner.id}/threads`);
    expect(first.threadId).not.toBe(second.threadId);
    expect(threads.map((thread) => thread.id).sort()).toEqual([first.threadId, second.threadId].sort());
    expect((await apiStatus(h, "GET", computerPath(owner))).body).toMatchObject({
      state: "starting",
      activity: "Screen starting.",
    });
    expect(h.svc.screens.status({ botId: owner.id, surfaceId: owner.surfaceId })).toEqual({ state: "stopped" });
    expect(adapter.starts).toHaveLength(0);
    expect(adapter.running(owner.surfaceId)).toBeUndefined();

    const firstUse = await sendToThread(h, first.threadId, "computer:observe");
    await waitThreadIdle(h, firstUse.threadId);
    expect(adapter.starts).toEqual([
      expect.objectContaining({ surfaceId: owner.surfaceId, generation: 1 }),
    ]);
    expect(adapter.running(owner.surfaceId)).toEqual({ generation: 1 });
    expect(await waitForState(h, owner, "ready")).toMatchObject({
      botId: owner.id,
      surfaceId: owner.surfaceId,
    });

    const shared = await sendToThread(h, second.threadId, "computer:observe");
    await waitThreadIdle(h, shared.threadId);
    expect(adapter.starts.filter((start) => start.surfaceId === owner.surfaceId)).toHaveLength(1);
    expect(adapter.running(owner.surfaceId)).toEqual({ generation: 1 });
    expect((await bot(h, owner.id)).surfaceId).toBe(owner.surfaceId);
  });

  test("a first Computer view and a concurrent Agent action converge on one runtime", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const owner = await bot(h, await makeBot(h, "Concurrent first use"));
    adapter.blockStarts();

    const view = fetch(
      `${h.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(owner.id)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`,
    );
    const action = h.svc.screens.act(
      { botId: owner.id, surfaceId: owner.surfaceId },
      { name: "open_app", args: { app: "fixture.desktop" } },
      { botId: owner.id, surfaceId: owner.surfaceId, turnId: "concurrent-first-use" },
    );
    await adapter.waitForStartAttempts(1);
    expect(adapter.starts).toHaveLength(0);
    expect(adapter.running(owner.surfaceId)).toBeUndefined();
    adapter.releaseStarts();

    expect((await view).status).toBe(200);
    await expect(action).resolves.toMatchObject({ text: "fake-open_app#1" });
    expect(adapter.starts).toEqual([
      expect.objectContaining({ surfaceId: owner.surfaceId, generation: 1 }),
    ]);
    expect(adapter.running(owner.surfaceId)).toEqual({ generation: 1 });
    expect(h.svc.screens.status({ botId: owner.id, surfaceId: owner.surfaceId })).toEqual({ state: "ready" });
  });

  test("two Bots on one Agent keep independent desktops and input", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const first = await bot(h, await makeBot(h, "Independent desktop A"));
    const second = await bot(h, await makeBot(h, "Independent desktop B"));
    expect(first.agentId).toBe("pi");
    expect(second.agentId).toBe("pi");
    expect(first.surfaceId).not.toBe(second.surfaceId);
    expect(adapter.starts).toHaveLength(0);

    await Promise.all([activateScreen(h, first), activateScreen(h, second)]);
    expect(adapter.starts.map((start) => start.surfaceId).sort()).toEqual(
      [first.surfaceId, second.surfaceId].sort(),
    );
    expect(adapter.running(first.surfaceId)).toEqual({ generation: 1 });
    expect(adapter.running(second.surfaceId)).toEqual({ generation: 1 });

    const [firstSource, secondSource] = await Promise.all([
      h.svc.screens.projectionSource({ botId: first.id, surfaceId: first.surfaceId }),
      h.svc.screens.projectionSource({ botId: second.id, surfaceId: second.surfaceId }),
    ]);
    await firstSource!.setInputAuthority(1);
    await secondSource!.setInputAuthority(1);
    await firstSource!.input({
      surfaceId: firstSource!.surfaceId,
      runtimeGeneration: firstSource!.runtimeGeneration,
      geometryGeneration: firstSource!.geometryGeneration,
      controllerEpoch: 1,
      sequence: 1,
      type: "key",
      keyCode: 30,
      state: "pressed",
    });
    expect(adapter.inputEvents.filter((event) => event.surfaceId === first.surfaceId)).toHaveLength(1);
    expect(adapter.inputEvents.filter((event) => event.surfaceId === second.surfaceId)).toHaveLength(0);
    expect(h.svc.screens.status({ botId: second.id, surfaceId: second.surfaceId })).toEqual({ state: "ready" });

    await h.svc.screens.act(
      { botId: first.id, surfaceId: first.surfaceId },
      { name: "open_app", args: { app: "fixture-a.desktop" } },
      { botId: first.id, surfaceId: first.surfaceId, turnId: "independent-a" },
    );
    expect(h.svc.screens.status({ botId: first.id, surfaceId: first.surfaceId })).toEqual({ state: "ready" });
    expect(h.svc.screens.status({ botId: second.id, surfaceId: second.surfaceId })).toEqual({ state: "ready" });
    expect(adapter.running(second.surfaceId)).toEqual({ generation: 1 });

    const firstTurn = await sendToBot(h, first.id, "computer:observe");
    const secondTurn = await sendToBot(h, second.id, "computer:observe");
    await Promise.all([waitThreadIdle(h, firstTurn.threadId), waitThreadIdle(h, secondTurn.threadId)]);
    const sessions = workerSessions(h);
    const firstSession = sessions.find((session) => session.botId === first.id && session.threadId === firstTurn.threadId);
    const secondSession = sessions.find((session) => session.botId === second.id && session.threadId === secondTurn.threadId);
    expect(firstSession?.nativeSessionId).toBeString();
    expect(secondSession?.nativeSessionId).toBeString();
    expect(firstSession?.nativeSessionId).not.toBe(secondSession?.nativeSessionId);
    expect(adapter.starts.filter((start) => start.surfaceId === first.surfaceId)).toHaveLength(1);
    expect(adapter.starts.filter((start) => start.surfaceId === second.surfaceId)).toHaveLength(1);
  });

  test("a provision failure stays on its Bot, frees capacity, and leaves no admitted runtime", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter, botScreenCapacity: 1 });
    const failed = await bot(h, await makeBot(h, "Provision failure"));
    const sibling = await bot(h, await makeBot(h, "Provision sibling"));
    adapter.failStart(failed.surfaceId, "fake provision failed");

    const rejected = await fetch(
      `${h.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(failed.id)}&surfaceId=${encodeURIComponent(failed.surfaceId)}`,
    );
    expect(rejected.status).toBe(503);
    expect(await waitForState(h, failed, "unavailable")).toMatchObject({
      botId: failed.id,
      surfaceId: failed.surfaceId,
      state: "unavailable",
      activity: "fake provision failed",
      takeover: "unavailable",
    });
    expect(h.svc.screens.status({ botId: failed.id, surfaceId: failed.surfaceId })).toEqual({
      state: "failed",
      failure: "fake provision failed",
    });
    expect(adapter.starts).toHaveLength(0);
    expect(adapter.running(failed.surfaceId)).toBeUndefined();

    await activateScreen(h, sibling);
    expect(adapter.starts).toEqual([
      expect.objectContaining({ surfaceId: sibling.surfaceId, generation: 1 }),
    ]);
    expect(adapter.running(sibling.surfaceId)).toEqual({ generation: 1 });
    expect(adapter.running(failed.surfaceId)).toBeUndefined();
    expect(await waitForState(h, sibling, "ready")).toMatchObject({ surfaceId: sibling.surfaceId });
    expect((await apiStatus(h, "GET", computerPath(failed))).body).toMatchObject({
      state: "unavailable",
      activity: "fake provision failed",
    });
  });

  test("closing a viewer is not Bot deletion and does not evict the desktop or shared files", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const owner = await bot(h, await makeBot(h, "Viewer close is not deletion"));
    await activateScreen(h, owner);
    const workspace = path.join(h.home, ".omarchy-bot", "workspace");
    mkdirSync(workspace, { recursive: true });
    const sentinel = path.join(workspace, "keep-after-view-close.txt");
    writeFileSync(sentinel, "shared work");
    const source = await h.svc.screens.projectionSource({ botId: owner.id, surfaceId: owner.surfaceId });
    const stream = await source!.openCaptureStream();
    await stream.next();

    await h.svc.projections.closeSurface(owner.surfaceId);

    expect((await apiStatus(h, "GET", `/api/bots/${owner.id}`)).status).toBe(200);
    expect(h.svc.screens.status({ botId: owner.id, surfaceId: owner.surfaceId })).toEqual({ state: "ready" });
    expect(adapter.running(owner.surfaceId)).toEqual({ generation: 1 });
    expect(adapter.destroyed.has(owner.surfaceId)).toBeFalse();
    expect(h.svc.db.query(`SELECT 1 FROM bot_surfaces WHERE surface_id = ?`).get(owner.surfaceId)).not.toBeNull();
    expect(readFileSync(sentinel, "utf8")).toBe("shared work");
    expect((await fetch(
      `${h.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(owner.id)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`,
    )).status).toBe(200);

    const deleted = await api<DeleteBotResultDto>(h, "DELETE", `/api/bots/${owner.id}`, {});
    expect(deleted).toMatchObject({ status: "deleted", removed: { surface: true } });
    expect(adapter.destroyed.has(owner.surfaceId)).toBeTrue();
    expect(readFileSync(sentinel, "utf8")).toBe("shared work");
  });

  test("an in-flight action fails honestly on infrastructure failure and does not complete Takeover", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const affected = await bot(h, await makeBot(h, "Pending action failure"));
    const sibling = await bot(h, await makeBot(h, "Pending action sibling"));
    await Promise.all([activateScreen(h, affected), activateScreen(h, sibling)]);
    adapter.blockActions();
    const pending = h.svc.screens.act(
      { botId: affected.id, surfaceId: affected.surfaceId },
      { name: "open_app", args: { app: "held.desktop" } },
      { botId: affected.id, surfaceId: affected.surfaceId, turnId: "pending-action-failure" },
    );
    void pending.catch(() => {});
    await adapter.waitForActions(1);
    adapter.exitDesktop(affected.surfaceId);
    await waitForState(h, affected, "unavailable");
    adapter.releaseActions();

    await expect(pending).rejects.toThrow(/Bot Desktop failed|unavailable/);
    expect(h.svc.screens.status({ botId: affected.id, surfaceId: affected.surfaceId })).toEqual({
      state: "failed",
      failure: "Bot Desktop failed: fake Bot Desktop exited",
    });
    expect((await apiStatus(h, "GET", computerPath(affected))).body).toMatchObject({
      state: "unavailable",
      takeover: "unavailable",
    });
    expect(await waitForState(h, sibling, "ready")).toMatchObject({ surfaceId: sibling.surfaceId });
    expect(adapter.running(sibling.surfaceId)).toEqual({ generation: 1 });

    await activateScreen(h, affected);
    expect(adapter.running(affected.surfaceId)).toEqual({ generation: 2 });
    expect((await apiStatus(h, "GET", computerPath(affected))).body).toMatchObject({
      state: "ready",
      takeover: "unavailable",
    });
  });

  test("recovery of an invalid runtime uses a fresh generation and rejects stale input", async () => {
    const adapter = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const owner = await bot(h, await makeBot(h, "Recover stale input"));
    await activateScreen(h, owner);
    const workspace = path.join(h.home, ".omarchy-bot", "workspace");
    mkdirSync(workspace, { recursive: true });
    const sentinel = path.join(workspace, "keep-after-recover.txt");
    writeFileSync(sentinel, "shared work");
    const stale = await h.svc.screens.projectionSource({ botId: owner.id, surfaceId: owner.surfaceId });
    expect(stale?.runtimeGeneration).toBe(1);
    adapter.rejectReconciliation(owner.surfaceId);
    const home = h.home;

    await h.disconnectForRestart();
    h = await startDaemon(home, { botScreenAdapter: adapter });

    expect(adapter.running(owner.surfaceId)).toEqual({ generation: 2 });
    expect(adapter.starts.filter((start) => start.surfaceId === owner.surfaceId).map((start) => start.generation))
      .toEqual([1, 2]);
    expect(readFileSync(sentinel, "utf8")).toBe("shared work");
    const replacement = await h.svc.screens.projectionSource({ botId: owner.id, surfaceId: owner.surfaceId });
    expect(replacement).toMatchObject({
      surfaceId: owner.surfaceId,
      runtimeGeneration: 2,
      geometryGeneration: 1,
    });
    await replacement!.setInputAuthority(1);
    await expect(replacement!.input({
      surfaceId: replacement!.surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: replacement!.geometryGeneration,
      controllerEpoch: 1,
      sequence: 1,
      type: "key",
      keyCode: 30,
      state: "pressed",
    })).rejects.toThrow("rejected the input envelope");
    await replacement!.input({
      surfaceId: replacement!.surfaceId,
      runtimeGeneration: replacement!.runtimeGeneration,
      geometryGeneration: replacement!.geometryGeneration,
      controllerEpoch: 1,
      sequence: 1,
      type: "key",
      keyCode: 30,
      state: "pressed",
    });
    expect(adapter.inputEvents.at(-1)).toMatchObject({
      surfaceId: owner.surfaceId,
      runtimeGeneration: 2,
    });
  });

  test("public deletion and recovery clean a Cage private runtime without touching shared or leftover profile paths", async () => {
    const fixture = await createScriptedCageFixture();
    const previousProfile = process.env.OMARCHY_BOT_SCREEN_PROFILE;
    process.env.OMARCHY_BOT_SCREEN_PROFILE = "1080p";
    try {
      h = await startDaemon(undefined, { botScreenAdapter: fixture.adapter });
      const deleted = await bot(h, await makeBot(h, "Cage cleanup deleted"));
      const sibling = await bot(h, await makeBot(h, "Cage cleanup sibling"));
      const workspace = path.join(h.home, ".omarchy-bot", "workspace");
      mkdirSync(workspace, { recursive: true });
      const sharedSentinel = path.join(workspace, "cage-cleanup-shared.txt");
      const legacyProfile = path.join(h.home, ".omarchy-bot", "legacy-profiles", "keep-me.txt");
      mkdirSync(path.dirname(legacyProfile), { recursive: true });
      writeFileSync(sharedSentinel, "shared work");
      writeFileSync(legacyProfile, "old profile residue");

      expect(await h.svc.screens.ensureReady({ botId: deleted.id, surfaceId: deleted.surfaceId })).toBeTrue();
      expect(h.svc.screens.status({ botId: deleted.id, surfaceId: deleted.surfaceId })).toEqual({ state: "ready" });
      expect(await h.svc.screens.ensureReady({ botId: sibling.id, surfaceId: sibling.surfaceId })).toBeTrue();
      const firstPid = Number(readFileSync(fixture.desktopPid(deleted.surfaceId), "utf8"));
      expect(processAlive(firstPid)).toBeTrue();
      expect(existsSync(path.join(fixture.runtimeRoot, deleted.surfaceId, "1"))).toBeTrue();

      const home = h.home;
      await h.disconnectForRestart();
      h = await startDaemon(home, { botScreenAdapter: fixture.adapter });

      expect(processAlive(firstPid)).toBeFalse();
      expect(existsSync(path.join(fixture.runtimeRoot, deleted.surfaceId, "1"))).toBeFalse();
      expect(h.svc.screens.status({ botId: deleted.id, surfaceId: deleted.surfaceId })).toEqual({ state: "ready" });
      expect(h.svc.screens.status({ botId: sibling.id, surfaceId: sibling.surfaceId })).toEqual({ state: "ready" });
      const recoveredPid = Number(readFileSync(fixture.desktopPid(deleted.surfaceId), "utf8"));
      expect(recoveredPid).not.toBe(firstPid);
      expect(processAlive(recoveredPid)).toBeTrue();
      expect(existsSync(path.join(fixture.runtimeRoot, deleted.surfaceId, "2"))).toBeTrue();
      expect(readFileSync(sharedSentinel, "utf8")).toBe("shared work");
      expect(readFileSync(legacyProfile, "utf8")).toBe("old profile residue");

      const result = await api<DeleteBotResultDto>(h, "DELETE", `/api/bots/${deleted.id}`, {});
      expect(result).toMatchObject({ status: "deleted", removed: { surface: true } });
      expect(processAlive(recoveredPid)).toBeFalse();
      expect(existsSync(path.join(fixture.runtimeRoot, deleted.surfaceId))).toBeFalse();
      expect(existsSync(path.join(fixture.profileRoot, deleted.surfaceId))).toBeFalse();
      expect(existsSync(path.join(fixture.runtimeRoot, sibling.surfaceId))).toBeTrue();
      expect(h.svc.screens.status({ botId: sibling.id, surfaceId: sibling.surfaceId })).toEqual({ state: "ready" });
      expect((await apiStatus(h, "GET", `/api/bots/${sibling.id}`)).status).toBe(200);
      expect(readFileSync(sharedSentinel, "utf8")).toBe("shared work");
      expect(readFileSync(legacyProfile, "utf8")).toBe("old profile residue");
      expect((await apiStatus(h, "GET", `/api/bots/${deleted.id}`)).status).toBe(404);
    } finally {
      if (previousProfile === undefined) delete process.env.OMARCHY_BOT_SCREEN_PROFILE;
      else process.env.OMARCHY_BOT_SCREEN_PROFILE = previousProfile;
      fixture.dispose();
    }
  }, 60_000);
});

function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function executable(directory: string, name: string, body: string): string {
  const target = path.join(directory, name);
  writeFileSync(target, body);
  chmodSync(target, 0o700);
  return target;
}

async function createScriptedCageFixture(): Promise<{
  adapter: CageBotScreenRuntimeAdapter;
  runtimeRoot: string;
  profileRoot: string;
  desktopPid: (surfaceId: string) => string;
  dispose: () => void;
}> {
  const root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-cage-cleanup-"));
  const bin = path.join(root, "bin");
  const runtimeRoot = path.join(root, "runtime");
  const profileRoot = path.join(root, "profiles");
  mkdirSync(bin);
  const png = path.join(root, "screen.png");
  const sharp = createRequire(
    path.resolve(import.meta.dir, "../../apps/daemon/src/bootstrap/main.ts"),
  )("sharp") as (input: unknown) => { png: () => { toFile: (file: string) => Promise<unknown> } };
  await sharp({
    create: {
      width: 1920,
      height: 1080,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 1 },
    },
  }).png().toFile(png);
  const cage = executable(bin, "cage", `#!/usr/bin/env bun
import path from "node:path";
const separator = process.argv.indexOf("--");
const application = process.argv.slice(separator + 1);
const socket = path.join(process.env.XDG_RUNTIME_DIR ?? "", "wayland-0");
const server = Bun.listen({ unix: socket, socket: { data() {} } });
const child = Bun.spawn(application, { env: { ...process.env, WAYLAND_DISPLAY: "wayland-0" }, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
const status = await child.exited;
server.stop(true);
process.exit(status);
`);
  const desktop = executable(bin, "bot-desktop", [
    "#!/bin/sh",
    "if [ \"$1\" = \"--host\" ]; then while :; do sleep 60; done; fi",
    "printf '%s' \"$$\" > \"$XDG_CONFIG_HOME/../desktop.pid\"",
    "printf 'READY %s %s\\n' \"$1\" \"$2\"",
    "while :; do sleep 60; done",
    "",
  ].join("\n"));
  const inert = "#!/bin/sh\nexit 0\n";
  const adapter = new CageBotScreenRuntimeAdapter({
    runtimeRoot,
    profileRoot,
    cageBin: cage,
    wlrRandrBin: executable(bin, "wlr-randr", inert),
    grimBin: executable(bin, "grim", `#!/bin/sh\ncat ${JSON.stringify(png)}\n`),
    inputHelperBin: executable(bin, "input", [
      "#!/bin/sh",
      "printf 'READY\\n'",
      "while IFS=' ' read -r command request rest; do",
      "  printf 'OK %s\\n' \"$request\"",
      "done",
      "",
    ].join("\n")),
    captureHelperBin: executable(bin, "capture", "#!/bin/sh\nprintf 'READY\\n'\nwhile read -r command; do [ \"$command\" = close ] && exit 0; done\n"),
    botDesktopBin: desktop,
    ffmpegBin: executable(bin, "ffmpeg", "#!/bin/sh\nprintf ' V..... libx264 H.264 encoder\\n'\n"),
    computerWorkers: {
      startComputerWorker: async (scope) => ({
        surfaceId: scope.surfaceId,
        runtimeGeneration: scope.runtimeGeneration,
        exited: new Promise<Error>(() => {}),
        act: async () => ({}),
        stop: async () => {},
      }),
    },
  });
  return {
    adapter,
    runtimeRoot,
    profileRoot,
    desktopPid: (surfaceId) => path.join(profileRoot, surfaceId, "desktop.pid"),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

function workerSessions(h: Harness): Array<{ botId?: string; threadId?: string; nativeSessionId?: string }> {
  const log = path.join(h.home, "fake-agent-observations.ndjson");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type?: string; botId?: string; threadId?: string; nativeSessionId?: string })
    .filter((entry) => entry.type === "session.open");
}
