import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import nodePath from "node:path";
import { handleComputerRequest } from "../../apps/daemon/src/api/computerRoutes.ts";
import type { ComputerSurfaceOwner } from "../../apps/daemon/src/modules/computer/broker.ts";
import type {
  BotScreenCapture,
  BotScreenProvision,
  BotScreenRuntime,
  BotScreenRuntimeAdapter,
} from "../../apps/daemon/src/modules/computer/botScreenManager.ts";
import { WorkerClient, sanitizedEnv } from "../../apps/daemon/src/supervision/workerClient.ts";
import { api, makeBot, sendToBot, startDaemon, type Harness } from "./helpers/harness.ts";

async function computerRequest<T>(h: Harness, method: string, path: string): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${h.baseUrl}${path}`, { method });
  const contentType = response.headers.get("content-type");
  return {
    response,
    body: (contentType?.startsWith("application/json") ? await response.json() : await response.arrayBuffer()) as T,
  };
}

type SurfaceOwner = ComputerSurfaceOwner;

async function ownerFor(h: Harness, botId: string): Promise<SurfaceOwner> {
  const bot = await api<{ id: string; surfaceId: string }>(h, "GET", `/api/bots/${botId}`);
  return { botId: bot.id, surfaceId: bot.surfaceId as ComputerSurfaceOwner["surfaceId"] };
}

function computerPath(path: string, owner: SurfaceOwner): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`;
}


async function waitForTurnStatus(h: Harness, turnId: string, status: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const row = h.svc.db.query("SELECT status FROM turns WHERE id = ?").get(turnId) as { status: string } | null;
    if (row?.status === status) return;
    if (Date.now() >= deadline) throw new Error(`turn ${turnId} did not reach ${status}; current=${row?.status ?? "missing"}`);
    await Bun.sleep(20);
  }
}

async function waitForComputerState(
  h: Harness,
  owner: SurfaceOwner,
  expected: string,
): Promise<{
  botId: string;
  surfaceId: string;
  state: string;
  takeover: "unavailable" | "available" | "active";
  activity?: string;
  previewAt?: string;
}> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const result = await computerRequest<{
      botId: string;
      surfaceId: string;
      state: string;
      takeover: "unavailable" | "available" | "active";
      activity?: string;
      previewAt?: string;
    }>(
      h,
      "GET",
      computerPath("/api/computer/state", owner),
    );
    if (result.body.state === expected) return result.body;
    if (Date.now() >= deadline) {
      throw new Error(`Computer Surface did not reach ${expected}; current=${result.body.state}`);
    }
  }
}

const CONCURRENCY_TEST_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

class ControlledRuntimeAdapter implements BotScreenRuntimeAdapter {
  #blockedSurface?: SurfaceOwner["surfaceId"];
  #captureStarts = new Map<SurfaceOwner["surfaceId"], number>();
  #capturesInFlight = new Map<SurfaceOwner["surfaceId"], number>();
  #maxCapturesInFlight = new Map<SurfaceOwner["surfaceId"], number>();
  #failRuntime = new Map<SurfaceOwner["surfaceId"], (error: Error) => void>();
  #blockedStarted?: () => void;
  #releaseBlocked?: () => void;
  #blockedStartedPromise = new Promise<void>((resolve) => {
    this.#blockedStarted = resolve;
  });
  #releaseBlockedPromise = new Promise<void>((resolve) => {
    this.#releaseBlocked = resolve;
  });

  blockFirstCapture(surfaceId: SurfaceOwner["surfaceId"]): void {
    this.#blockedSurface = surfaceId;
  }

  captureStarts(surfaceId: SurfaceOwner["surfaceId"]): number {
    return this.#captureStarts.get(surfaceId) ?? 0;
  }

  maxConcurrentCaptures(surfaceId: SurfaceOwner["surfaceId"]): number {
    return this.#maxCapturesInFlight.get(surfaceId) ?? 0;
  }

  waitForBlockedCapture(): Promise<void> {
    return this.#blockedStartedPromise;
  }

  releaseBlockedCapture(): void {
    this.#releaseBlocked?.();
  }


  fail(surfaceId: SurfaceOwner["surfaceId"], message: string): void {
    const fail = this.#failRuntime.get(surfaceId);
    if (fail === undefined) throw new Error("test Screen was not started");
    fail(new Error(message));
  }

  async start(provision: BotScreenProvision): Promise<BotScreenRuntime> {
    let stopped = false;
    const exited = new Promise<Error>((resolve) => {
      this.#failRuntime.set(provision.surfaceId, resolve);
    });
    return {
      capture: async (): Promise<BotScreenCapture> => {
        if (stopped) throw new Error("test Screen is stopped");
        const count = this.captureStarts(provision.surfaceId) + 1;
        const inFlight = (this.#capturesInFlight.get(provision.surfaceId) ?? 0) + 1;
        this.#captureStarts.set(provision.surfaceId, count);
        this.#capturesInFlight.set(provision.surfaceId, inFlight);
        this.#maxCapturesInFlight.set(
          provision.surfaceId,
          Math.max(inFlight, this.#maxCapturesInFlight.get(provision.surfaceId) ?? 0),
        );
        try {
          if (provision.surfaceId === this.#blockedSurface && count === 1) {
            this.#blockedStarted?.();
            await this.#releaseBlockedPromise;
          }
          return { mediaType: "image/png", bytes: CONCURRENCY_TEST_PNG };
        } finally {
          this.#capturesInFlight.set(provision.surfaceId, inFlight - 1);
        }
      },
      act: async (action) => {
        if (stopped) throw new Error("test Screen is stopped");
        return { text: `test-${action.name}` };
      },
      input: async () => {
        if (stopped) throw new Error("test Screen is stopped");
      },
      releaseInput: async () => {
        if (stopped) throw new Error("test Screen is stopped");
      },
      exited,
      stop: async () => {
        stopped = true;
      },
    };
  }
}


describe("contextual computer control", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await startDaemon();
  });

  afterEach(async () => {
    await h.stop();
  });


  test("new Bots own distinct stable opaque Computer Surfaces", async () => {
    const first = await api<{ id: string; surfaceId: string }>(h, "POST", "/api/bots", {
      name: "First screen",
      instructions: "",
      agentId: "pi",
    });
    const second = await api<{ id: string; surfaceId: string }>(h, "POST", "/api/bots", {
      name: "Second screen",
      instructions: "",
      agentId: "pi",
    });

    expect(first.surfaceId).toMatch(/^surf_[0-9a-f]{32}$/);
    expect(second.surfaceId).toMatch(/^surf_[0-9a-f]{32}$/);
    expect(second.surfaceId).not.toBe(first.surfaceId);
    expect((await api<{ surfaceId: string }>(h, "GET", `/api/bots/${first.id}`)).surfaceId).toBe(first.surfaceId);
  });

  test("Computer routes reject a missing Bot and Surface association", async () => {
    const response = await fetch(`${h.baseUrl}/api/computer/state`);
    expect(response.status).toBe(400);
  });

  test("Computer routes reject mismatched Bot and Surface ownership", async () => {
    const first = await api<{ id: string; surfaceId: string }>(h, "POST", "/api/bots", {
      name: "First owner",
      instructions: "",
      agentId: "pi",
    });
    const second = await api<{ id: string; surfaceId: string }>(h, "POST", "/api/bots", {
      name: "Second owner",
      instructions: "",
      agentId: "pi",
    });

    const response = await fetch(
      `${h.baseUrl}/api/computer/state?botId=${first.id}&surfaceId=${second.surfaceId}`,
    );
    expect(response.status).toBe(404);
  });

  test("opening Computer lazily reports actual Bot Screen startup and readiness", async () => {
    const owner = await ownerFor(h, await makeBot(h, "Lazy screen"));

    const opening = await computerRequest<{ state: string; activity?: string }>(
      h,
      "GET",
      computerPath("/api/computer/state", owner),
    );
    expect(opening.body).toMatchObject({
      state: "starting",
      activity: "Screen starting.",
    });

    expect(await waitForComputerState(h, owner, "ready")).toMatchObject({
      state: "ready",
      activity: "Screen ready.",
    });
  });

  test("missing Hyprland reports Screen unavailable without falling back to the host", async () => {
    const previousHyprlandBin = process.env.OMARCHY_BOT_HYPRLAND_BIN;
    process.env.OMARCHY_BOT_HYPRLAND_BIN = "/definitely/missing/Hyprland";
    await h.stop();
    try {
      h = await startDaemon(undefined, { useProductionBotScreen: true });
    } finally {
      if (previousHyprlandBin === undefined) delete process.env.OMARCHY_BOT_HYPRLAND_BIN;
      else process.env.OMARCHY_BOT_HYPRLAND_BIN = previousHyprlandBin;
    }
    const owner = await ownerFor(h, await makeBot(h, "Unavailable screen"));

    const opening = await computerRequest<{ state: string }>(
      h,
      "GET",
      computerPath("/api/computer/state", owner),
    );
    expect(opening.body.state).toBe("starting");

    expect(await waitForComputerState(h, owner, "unavailable")).toEqual({
      ...owner,
      state: "unavailable",
      activity: "Screen unavailable.",
      takeover: "unavailable",
    });
  }, 15_000);

  test("opening preview captures directly from the assigned Bot Screen", async () => {
    const owner = await ownerFor(h, await makeBot(h, "Preview screen"));

    const snapshot = await computerRequest<ArrayBuffer>(
      h,
      "GET",
      computerPath("/api/computer/snapshot", owner),
    );

    expect(snapshot.response.status).toBe(200);
    expect(snapshot.response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(snapshot.body).toString("base64")).toBe(
      "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWMQMgn7D8IAC5MDN627upEAAAAASUVORK5CYII=",
    );
    expect(await waitForComputerState(h, owner, "ready")).toMatchObject({
      ...owner,
      previewAt: expect.any(String),
    });
  });
  test("Computer Preview timestamps remain scoped to their Bot Screen", async () => {
    const first = await ownerFor(h, await makeBot(h, "Observer"));
    const second = await ownerFor(h, await makeBot(h, "Other observer"));


    const snapshot = await computerRequest<ArrayBuffer>(h, "GET", computerPath("/api/computer/snapshot", first));
    expect(snapshot.response.status).toBe(200);
    expect(snapshot.response.headers.get("content-type")).toBe("image/png");
    expect(snapshot.body.byteLength).toBeGreaterThan(0);

    const firstState = await waitForComputerState(h, first, "ready");
    const secondState = await waitForComputerState(h, second, "ready");
    expect(firstState).toMatchObject({ ...first, state: "ready", previewAt: expect.any(String) });
    expect(secondState).toEqual({
      ...second,
      state: "ready",
      activity: "Screen ready.",
      takeover: "unavailable",
    });
  });

  test("different Bot Screens capture concurrently while one Screen serializes its requests", async () => {
    await h.stop();
    const adapter = new ControlledRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const first = await ownerFor(h, await makeBot(h, "First concurrent screen"));
    const second = await ownerFor(h, await makeBot(h, "Second concurrent screen"));
    adapter.blockFirstCapture(first.surfaceId);

    const firstRequest = fetch(`${h.baseUrl}${computerPath("/api/computer/snapshot", first)}`);
    await adapter.waitForBlockedCapture();
    const secondRequestOnFirst = fetch(`${h.baseUrl}${computerPath("/api/computer/snapshot", first)}`);
    const independent = fetch(`${h.baseUrl}${computerPath("/api/computer/snapshot", second)}`);

    const independentResponse = await independent;
    expect(independentResponse.status).toBe(200);
    expect(adapter.captureStarts(second.surfaceId)).toBe(1);

    adapter.releaseBlockedCapture();
    const responses = await Promise.all([firstRequest, secondRequestOnFirst]);
    expect(responses.every((response) => response.status === 200)).toBeTrue();
    expect(adapter.maxConcurrentCaptures(first.surfaceId)).toBe(1);
  });


  test("one failed Screen runtime leaves another Screen ready and capturable", async () => {
    await h.stop();
    const adapter = new ControlledRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const failed = await ownerFor(h, await makeBot(h, "Failed screen"));
    const unaffected = await ownerFor(h, await makeBot(h, "Unaffected screen"));

    await computerRequest(h, "GET", computerPath("/api/computer/state", failed));
    await computerRequest(h, "GET", computerPath("/api/computer/state", unaffected));
    await Promise.all([
      waitForComputerState(h, failed, "ready"),
      waitForComputerState(h, unaffected, "ready"),
    ]);

    adapter.fail(failed.surfaceId, "test worker failed");
    expect(await waitForComputerState(h, failed, "unavailable")).toMatchObject(failed);
    const snapshot = await computerRequest<ArrayBuffer>(
      h,
      "GET",
      computerPath("/api/computer/snapshot", unaffected),
    );
    expect(snapshot.response.status).toBe(200);
    expect(await waitForComputerState(h, unaffected, "ready")).toMatchObject(unaffected);
  });

  test("restarting one Surface worker does not stop another Surface worker", async () => {
    const first = await ownerFor(h, await makeBot(h, "First worker"));
    const second = await ownerFor(h, await makeBot(h, "Second worker"));
    const workerEnv = { PATH: process.env.PATH ?? "" };
    const firstWorker = await h.svc.supervisor.startComputerWorker({
      surfaceId: first.surfaceId,
      runtimeGeneration: 1,
      env: workerEnv,
    });
    const secondWorker = await h.svc.supervisor.startComputerWorker({
      surfaceId: second.surfaceId,
      runtimeGeneration: 1,
      env: workerEnv,
    });

    await expect(firstWorker.act({ name: "observe", args: { crash: true } })).rejects.toThrow("worker exited");
    await expect(firstWorker.exited).resolves.toThrow("Computer worker exited (17)");
    await expect(secondWorker.act({ name: "observe", args: {} })).resolves.toMatchObject({
      text: "fake-observe#1",
    });

    const restarted = await h.svc.supervisor.startComputerWorker({
      surfaceId: first.surfaceId,
      runtimeGeneration: 2,
      env: workerEnv,
    });
    await expect(firstWorker.act({ name: "observe", args: {} })).rejects.toThrow("context is no longer active");
    await expect(restarted.act(
      { name: "observe", args: {} },
      { surfaceId: second.surfaceId, botId: first.botId, turnId: "turn-wrong-surface" },
    )).rejects.toThrow("mismatched input authority Surface");
    await expect(Promise.all([
      restarted.act({ name: "observe", args: {} }),
      secondWorker.act({ name: "observe", args: {} }),
    ])).resolves.toHaveLength(2);
  });

  test("computer worker protocol rejects another Surface, stale generation, and invalid input authority", async () => {
    const first = await ownerFor(h, await makeBot(h, "Worker protocol owner"));
    const second = await ownerFor(h, await makeBot(h, "Worker protocol other"));
    const worker = new WorkerClient({
      name: "computer-protocol-test",
      script: nodePath.resolve(import.meta.dir, "../../workers/computer/src/worker.ts"),
      env: {
        ...sanitizedEnv(),
        OMARCHY_BOT_SURFACE_ID: first.surfaceId,
        OMARCHY_BOT_RUNTIME_GENERATION: "7",
      },
      onEvent: () => {},
    });
    await worker.start();
    try {
      const action = { name: "observe", args: {} };
      await expect(worker.request({
        type: "act",
        surfaceId: second.surfaceId,
        runtimeGeneration: 7,
        action,
      }, 1_000)).rejects.toThrow("command Surface does not match worker context");
      await expect(worker.request({
        type: "act",
        surfaceId: first.surfaceId,
        runtimeGeneration: 6,
        action,
      }, 1_000)).rejects.toThrow("runtime generation does not match worker context");
      await expect(worker.request({
        type: "act",
        surfaceId: first.surfaceId,
        runtimeGeneration: 7,
        action: { name: "click", args: { x: 1, y: 1 } },
      }, 1_000)).rejects.toThrow("input action requires explicit Bot Screen authority");
      await expect(worker.request({
        type: "act",
        surfaceId: first.surfaceId,
        runtimeGeneration: 7,
        action,
        inputAuthority: {
          surfaceId: second.surfaceId,
          botId: first.botId,
          turnId: "turn-wrong-surface",
        },
      }, 1_000)).rejects.toThrow("input authority Surface does not match command Surface");
    } finally {
      await worker.stop();
    }
  });


  test("an active turn without a pending computer tool cannot enter Takeover", async () => {
    const botId = await makeBot(h, "Driver");
    const owner = await ownerFor(h, botId);
    const turn = await sendToBot(h, botId, "hang");
    await waitForTurnStatus(h, turn.turnId, "working");

    const taken = await computerRequest<{ error: string }>(
      h,
      "POST",
      computerPath("/api/computer/take-control", owner),
    );
    expect(taken.response.status).toBe(409);
    expect(taken.body.error).toBe("Takeover requires a pending computer tool.");
    expect(h.svc.threads.turnRow(turn.turnId)?.status).toBe("working");
  });


  test("archive and restore retain Surface identity while permanent deletion removes it", async () => {
    const owner = await ownerFor(h, await makeBot(h, "Archived screen"));
    expect((
      await computerRequest(h, "GET", computerPath("/api/computer/snapshot", owner))
    ).response.status).toBe(200);
    const archived = await api<{ surfaceId: string }>(h, "POST", `/api/bots/${owner.botId}/archive`, {});
    expect(archived.surfaceId).toBe(owner.surfaceId);
    expect((await fetch(`${h.baseUrl}${computerPath("/api/computer/state", owner)}`)).status).toBe(404);

    const restored = await api<{ surfaceId: string }>(h, "POST", `/api/bots/${owner.botId}/restore`);
    expect(restored.surfaceId).toBe(owner.surfaceId);
    expect((await fetch(`${h.baseUrl}${computerPath("/api/computer/state", owner)}`)).status).toBe(200);

    await api(h, "POST", `/api/bots/${owner.botId}/archive`, {});
    const deleted = await api<{ status: string }>(h, "DELETE", `/api/bots/${owner.botId}`, {
      confirmName: "Archived screen",
    });
    expect(deleted.status).toBe("deleted");
    expect(h.svc.db.query(`SELECT surface_id FROM bot_surfaces WHERE surface_id = ?`).get(owner.surfaceId)).toBeNull();
    expect((await fetch(`${h.baseUrl}${computerPath("/api/computer/state", owner)}`)).status).toBe(404);
  });

  test("non-computer requests are left to the parent router", async () => {
    expect(
      await handleComputerRequest(
        new Request(`${h.baseUrl}/api/health`),
        h.svc.computer,
        h.svc.screens,
      ),
    ).toBeUndefined();
    expect(await api<{ ok: boolean }>(h, "GET", "/api/health")).toMatchObject({ ok: true });
  });
});
