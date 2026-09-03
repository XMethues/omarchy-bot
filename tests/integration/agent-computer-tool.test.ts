import { afterEach, describe, expect, test } from "bun:test";
import type { ComputerAction, SurfaceId } from "../../packages/domain/src/index.ts";
import type {
  BotScreenProvision,
  BotScreenRuntime,
  BotScreenRuntimeAdapter,
} from "../../apps/daemon/src/modules/computer/botScreenManager.ts";
import { api, makeBot, sendToBot, startDaemon, waitThreadIdle, type Harness } from "./helpers/harness.ts";

interface RecordedAction {
  surfaceId: SurfaceId;
  action: ComputerAction;
}

interface ComputerView {
  botId: string;
  surfaceId: SurfaceId;
  state: string;
  takeover: "unavailable" | "available" | "active";
}

async function computerRequest(
  h: Harness,
  owner: { botId: string; surfaceId: SurfaceId },
  method: "GET" | "POST",
  path: string,
): Promise<{ response: Response; body: ComputerView | { error: string } }> {
  const query = `botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`;
  const response = await fetch(`${h.baseUrl}${path}?${query}`, { method });
  return { response, body: await response.json() };
}

async function waitForTakeover(
  h: Harness,
  owner: { botId: string; surfaceId: SurfaceId },
  expected: ComputerView["takeover"],
): Promise<ComputerView> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const result = await computerRequest(h, owner, "GET", "/api/computer/state");
    if ("takeover" in result.body && result.body.takeover === expected) return result.body;
    if (Date.now() >= deadline) {
      throw new Error(`Takeover did not reach ${expected}`);
    }
  }
}

class AgentToolRuntimeAdapter implements BotScreenRuntimeAdapter {
  readonly actions: RecordedAction[] = [];
  readonly inFlight = new Map<SurfaceId, number>();
  readonly maxInFlight = new Map<SurfaceId, number>();
  readonly releases: SurfaceId[] = [];
  maxAcrossSurfaces = 0;
  #blockActions = false;
  #actionStartedWaiters: Array<{ count: number; resolve: () => void }> = [];
  #releaseBlockedActions: (() => void) | undefined;
  #blockedActions = Promise.resolve();

  blockActions(): void {
    this.#blockActions = true;
    const gate = Promise.withResolvers<void>();
    this.#blockedActions = gate.promise;
    this.#releaseBlockedActions = gate.resolve;
  }

  waitForActions(count: number): Promise<void> {
    if (this.actions.length >= count) return Promise.resolve();
    const waiter = Promise.withResolvers<void>();
    this.#actionStartedWaiters.push({ count, resolve: waiter.resolve });
    return waiter.promise;
  }

  releaseActions(): void {
    this.#releaseBlockedActions?.();
    this.#releaseBlockedActions = undefined;
    this.#blockActions = false;
  }

  async start(provision: BotScreenProvision): Promise<BotScreenRuntime> {
    return {
      capture: async () => ({ mediaType: "image/png", bytes: new Uint8Array([1]) }),
      act: async (action) => {
        const count = (this.inFlight.get(provision.surfaceId) ?? 0) + 1;
        this.inFlight.set(provision.surfaceId, count);
        this.maxInFlight.set(
          provision.surfaceId,
          Math.max(this.maxInFlight.get(provision.surfaceId) ?? 0, count),
        );
        this.maxAcrossSurfaces = Math.max(
          this.maxAcrossSurfaces,
          [...this.inFlight.values()].filter((value) => value > 0).length,
        );
        this.actions.push({ surfaceId: provision.surfaceId, action });
        for (const waiter of this.#actionStartedWaiters.splice(0)) {
          if (this.actions.length >= waiter.count) waiter.resolve();
          else this.#actionStartedWaiters.push(waiter);
        }
        if (this.#blockActions) await this.#blockedActions;
        this.inFlight.set(provision.surfaceId, count - 1);
        if (action.args.fail === true) throw new Error("assigned Computer worker failed");
        return {
          text: `screen:${provision.surfaceId}:${action.name}`,
          ...(action.name === "observe"
            ? { windowList: [{ id: "window-1", title: "Fresh window", focused: true }] }
            : {}),
          ...(action.name === "screenshot"
            ? { image: { mediaType: "image/png" as const, bytes: new Uint8Array([1, 2, 3]) } }
            : {}),
        };
      },
      input: async () => {},
      releaseInput: async () => {
        this.releases.push(provision.surfaceId);
      },
      exited: new Promise<Error>(() => {}),
      stop: async () => {},
    };
  }
}

async function botSurface(h: Harness, botId: string): Promise<SurfaceId> {
  const bot = await api<{ surfaceId: SurfaceId }>(h, "GET", `/api/bots/${botId}`);
  return bot.surfaceId;
}

async function messages(h: Harness, threadId: string): Promise<Array<{ author: { kind: string }; kind: string; text?: string; payload?: Record<string, unknown> }>> {
  return api(h, "GET", `/api/threads/${threadId}/messages`);
}

describe("Bot-bound Pi computer tool", () => {
  let h: Harness | undefined;

  afterEach(async () => {
    await h?.stop();
    h = undefined;
  });

  test("a public Agent turn observes and inputs only through its owning Bot Screen", async () => {
    const adapter = new AgentToolRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const firstBot = await makeBot(h, "First tool Bot");
    const secondBot = await makeBot(h, "Second tool Bot");
    const firstSurface = await botSurface(h, firstBot);
    const secondSurface = await botSurface(h, secondBot);

    const observed = await sendToBot(h, firstBot, "computer:observe");
    await waitThreadIdle(h, observed.threadId);
    const acted = await sendToBot(h, secondBot, "computer:click:second");
    await waitThreadIdle(h, acted.threadId);

    expect(adapter.actions).toEqual([
      { surfaceId: firstSurface, action: { name: "observe", args: {} } },
      {
        surfaceId: secondSurface,
        action: { name: "click", args: { marker: "second" } },
      },
    ]);
    const transcript = await messages(h, observed.threadId);
    expect(transcript.some((message) => message.text?.includes(`screen:${firstSurface}:observe`))).toBeTrue();
    expect(transcript.some((message) => message.kind === "tool" && message.payload?.name === "computer")).toBeTrue();
  });

  test("different Surfaces run concurrently while one Surface orders Agent actions", async () => {
    const adapter = new AgentToolRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const firstBot = await makeBot(h, "Concurrent first Bot");
    const secondBot = await makeBot(h, "Concurrent second Bot");
    const firstSurface = await botSurface(h, firstBot);
    const secondSurface = await botSurface(h, secondBot);
    adapter.blockActions();
    const turnsPromise = Promise.all([
      sendToBot(h, firstBot, "computer:click:first-a"),
      sendToBot(h, firstBot, "computer:click:first-b"),
      sendToBot(h, secondBot, "computer:click:second"),
    ]);
    await adapter.waitForActions(2);
    expect(adapter.maxInFlight.get(firstSurface)).toBe(1);
    expect(adapter.maxInFlight.get(secondSurface)).toBe(1);
    expect(adapter.maxAcrossSurfaces).toBe(2);
    adapter.releaseActions();
    const turns = await turnsPromise;
    await Promise.all(turns.map((turn) => waitThreadIdle(h!, turn.threadId)));

    expect(adapter.actions.filter((record) => record.surfaceId === firstSurface)).toHaveLength(2);
  });

  test("cancelling a queued tool call prevents its input from dispatching", async () => {
    const adapter = new AgentToolRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const bot = await makeBot(h, "Cancelled tool Bot");
    const surfaceId = await botSurface(h, bot);
    adapter.blockActions();

    try {
      const first = await sendToBot(h, bot, "computer:click:first");
      await adapter.waitForActions(1);
      const cancelled = await sendToBot(h, bot, "computer:click:cancelled");
      await h.svc.turns.abortTurn(cancelled.turnId, "cancel queued computer tool");
      adapter.releaseActions();
      await Promise.all([
        waitThreadIdle(h, first.threadId),
        waitThreadIdle(h, cancelled.threadId),
      ]);

      expect(adapter.actions).toEqual([
        { surfaceId, action: { name: "click", args: { marker: "first" } } },
      ]);
      expect(h.svc.threads.turnRow(cancelled.turnId)?.status).toBe("cancelled");
    } finally {
      adapter.releaseActions();
    }
  });

  test("Takeover holds one native tool call through quiescence and I'm done continues that same turn", async () => {
    const adapter = new AgentToolRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const botId = await makeBot(h, "Same-turn Takeover Bot");
    const surfaceId = await botSurface(h, botId);
    const owner = { botId, surfaceId };
    adapter.blockActions();

    const sent = await sendToBot(h, botId, "computer:click:takeover");
    await adapter.waitForActions(1);
    expect(await waitForTakeover(h, owner, "available")).toMatchObject({
      state: "bot-using",
      takeover: "available",
    });

    const takeover = computerRequest(h, owner, "POST", "/api/computer/take-control");
    const beforeQuiescence = await Promise.race([
      takeover.then(() => "takeover-settled" as const),
      computerRequest(h, owner, "GET", "/api/computer/state").then(() => "state-readable" as const),
    ]);
    expect(beforeQuiescence).toBe("state-readable");
    expect(h.svc.threads.turnRow(sent.turnId)?.status).toBe("working");

    adapter.releaseActions();
    const taken = await takeover;
    expect(taken.response.status).toBe(200);
    expect(taken.body).toMatchObject({ state: "user-control", takeover: "active" });
    expect(h.svc.threads.turnRow(sent.turnId)?.status).toBe("working");
    expect(adapter.actions).toEqual([
      { surfaceId, action: { name: "click", args: { marker: "takeover" } } },
    ]);
    adapter.blockActions();
    const returning = computerRequest(h, owner, "POST", "/api/computer/return-to-bot");
    await adapter.waitForActions(2);
    const duplicate = await computerRequest(h, owner, "POST", "/api/computer/return-to-bot");
    expect(duplicate.response.status).toBe(409);
    adapter.releaseActions();
    const returned = await returning;
    expect(returned.response.status).toBe(200);
    expect(returned.body).toMatchObject({ takeover: "unavailable" });
    await waitThreadIdle(h, sent.threadId);

    expect(adapter.actions).toEqual([
      { surfaceId, action: { name: "click", args: { marker: "takeover" } } },
      { surfaceId, action: { name: "observe", args: {} } },
      { surfaceId, action: { name: "screenshot", args: {} } },
    ]);
    const transcript = await messages(h, sent.threadId);
    const computerTools = transcript.filter((message) =>
      message.kind === "tool" && message.payload?.name === "computer"
    );
    expect(computerTools).toHaveLength(1);
    expect(transcript.some((message) =>
      message.text?.includes("Fresh window") && message.text.includes("imageRef")
    )).toBeTrue();
    expect(h.svc.threads.turnRow(sent.turnId)?.status).toBe("completed");
  });

  test("Takeover is unavailable without a pending Broker tool and native cancellation cancels a held waiter", async () => {
    const adapter = new AgentToolRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const botId = await makeBot(h, "Cancelled Takeover Bot");
    const surfaceId = await botSurface(h, botId);
    const owner = { botId, surfaceId };

    const unavailable = await computerRequest(h, owner, "POST", "/api/computer/take-control");
    expect(unavailable.response.status).toBe(409);
    expect(unavailable.body).toEqual({ error: "Takeover requires a pending computer tool." });

    adapter.blockActions();
    const sent = await sendToBot(h, botId, "computer:click:cancelled-takeover");
    await adapter.waitForActions(1);
    const takeover = computerRequest(h, owner, "POST", "/api/computer/take-control");
    expect(await Promise.race([
      takeover.then(() => "takeover-settled" as const),
      computerRequest(h, owner, "GET", "/api/computer/state").then(() => "state-readable" as const),
    ])).toBe("state-readable");
    adapter.releaseActions();
    expect((await takeover).body).toMatchObject({ takeover: "active" });

    await h.svc.turns.abortTurn(sent.turnId, "cancel held Takeover");
    await waitThreadIdle(h, sent.threadId);
    expect(h.svc.threads.turnRow(sent.turnId)?.status).toBe("cancelled");
    expect(await waitForTakeover(h, owner, "unavailable")).toMatchObject({
      takeover: "unavailable",
    });
    const returned = await computerRequest(h, owner, "POST", "/api/computer/return-to-bot");
    expect(returned.response.status).toBe(409);
    expect(adapter.actions).toEqual([
      { surfaceId, action: { name: "click", args: { marker: "cancelled-takeover" } } },
    ]);
  });

  test("Agent-worker loss during a held Takeover fails the turn and never reconstructs the waiter", async () => {
    const adapter = new AgentToolRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const botId = await makeBot(h, "Restarted Takeover Bot");
    const surfaceId = await botSurface(h, botId);
    const owner = { botId, surfaceId };
    adapter.blockActions();

    const sent = await sendToBot(h, botId, "computer:click:worker-restart");
    await adapter.waitForActions(1);
    const takeover = computerRequest(h, owner, "POST", "/api/computer/take-control");
    expect(await Promise.race([
      takeover.then(() => "takeover-settled" as const),
      computerRequest(h, owner, "GET", "/api/computer/state").then(() => "state-readable" as const),
    ])).toBe("state-readable");
    adapter.releaseActions();
    expect((await takeover).body).toMatchObject({ takeover: "active" });

    await expect(
      h.svc.turns.send(botId, sent.threadId, "crash-agent"),
    ).rejects.toThrow("steer unavailable");
    await waitThreadIdle(h, sent.threadId);
    expect(h.svc.threads.turnRow(sent.turnId)?.status).toBe("failed");
    expect(await waitForTakeover(h, owner, "unavailable")).toMatchObject({
      takeover: "unavailable",
    });
    expect(adapter.actions).toEqual([
      { surfaceId, action: { name: "click", args: { marker: "worker-restart" } } },
    ]);
    const transcript = await messages(h, sent.threadId);
    expect(transcript.some((message) =>
      message.author.kind === "system" && message.text?.includes("worker exited")
    )).toBeTrue();
  });

  test("daemon restart fails a held Takeover turn instead of pretending to resume it", async () => {
    const adapter = new AgentToolRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const botId = await makeBot(h, "Daemon restart Takeover Bot");
    const surfaceId = await botSurface(h, botId);
    const owner = { botId, surfaceId };
    adapter.blockActions();

    const sent = await sendToBot(h, botId, "computer:click:daemon-restart");
    await adapter.waitForActions(1);
    const takeover = computerRequest(h, owner, "POST", "/api/computer/take-control");
    expect(await Promise.race([
      takeover.then(() => "takeover-settled" as const),
      computerRequest(h, owner, "GET", "/api/computer/state").then(() => "state-readable" as const),
    ])).toBe("state-readable");
    adapter.releaseActions();
    expect((await takeover).body).toMatchObject({ takeover: "active" });

    const home = h.home;
    await h.stop();
    h = await startDaemon(home, { botScreenAdapter: new AgentToolRuntimeAdapter() });
    const turn = h.svc.threads.turnRow(sent.turnId);
    expect(turn?.status).toBe("failed");
    expect(turn?.outcome_reason).toMatch(/daemon (?:stopped|restart)/);
    expect(await waitForTakeover(h, owner, "unavailable")).toMatchObject({
      takeover: "unavailable",
    });
  });

  test("every stale or mismatched binding identity fails without touching either Screen", async () => {
    const adapter = new AgentToolRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const firstBot = await makeBot(h, "Context owner Bot");
    const secondBot = await makeBot(h, "Context other Bot");
    const secondSurface = await botSurface(h, secondBot);

    const turns = await Promise.all([
      sendToBot(h, firstBot, `computer:observe:mismatch:${secondSurface}`),
      sendToBot(h, firstBot, "computer:observe:stale"),
      sendToBot(h, firstBot, "computer:observe:wrong-bot"),
      sendToBot(h, firstBot, "computer:observe:wrong-session"),
      sendToBot(h, firstBot, "computer:observe:missing-tool-call"),
    ]);
    await Promise.all(turns.map((turn) => waitThreadIdle(h!, turn.threadId)));

    expect(adapter.actions).toHaveLength(0);
    for (const turn of turns) {
      const row = h.svc.threads.turnRow(turn.turnId);
      expect(row?.status).toBe("failed");
      const transcript = await messages(h, turn.threadId);
      expect(transcript.some((message) =>
        message.author.kind === "system"
        && message.text?.includes("computer tool context")
      )).toBeTrue();
    }
  });

  test("Agent worker loss fails its active tool turn instead of reconstructing or rerouting it", async () => {
    const adapter = new AgentToolRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const bot = await makeBot(h, "Crashed Agent worker Bot");

    const sent = await sendToBot(h, bot, "computer:crash-agent");
    await waitThreadIdle(h, sent.threadId);

    expect(adapter.actions).toHaveLength(0);
    expect(h.svc.threads.turnRow(sent.turnId)?.status).toBe("failed");
    const transcript = await messages(h, sent.threadId);
    expect(transcript.some((message) =>
      message.author.kind === "system"
      && message.text?.includes("worker exited")
    )).toBeTrue();
  });

  test("assigned worker failure fails honestly and never reroutes", async () => {
    const adapter = new AgentToolRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const bot = await makeBot(h, "Failed tool Bot");
    const surfaceId = await botSurface(h, bot);

    const sent = await sendToBot(h, bot, "computer:observe:fail");
    await waitThreadIdle(h, sent.threadId);

    expect(adapter.actions).toEqual([
      { surfaceId, action: { name: "observe", args: { fail: true } } },
    ]);
    expect(h.svc.threads.turnRow(sent.turnId)?.status).toBe("failed");
    const transcript = await messages(h, sent.threadId);
    expect(transcript.some((message) => message.text?.includes("assigned Computer worker failed"))).toBeTrue();
  });
});
