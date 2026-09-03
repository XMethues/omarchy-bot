import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EventEnvelope } from "../../packages/protocol/src/index.ts";
import { handleComputerRequest } from "../../apps/daemon/src/api/computerRoutes.ts";
import { api, makeBot, sendToBot, startDaemon, type Harness } from "./helpers/harness.ts";

async function computerRequest<T>(h: Harness, method: string, path: string): Promise<{ response: Response; body: T }> {
  const response = await fetch(`${h.baseUrl}${path}`, { method });
  const contentType = response.headers.get("content-type");
  return {
    response,
    body: (contentType?.startsWith("application/json") ? await response.json() : await response.arrayBuffer()) as T,
  };
}

function isResumeEvent(event: EventEnvelope, turnId: string): boolean {
  const payload = event.payload;
  return event.type === "turn.status"
    && payload !== null
    && typeof payload === "object"
    && "turnId" in payload
    && payload.turnId === turnId
    && "to" in payload
    && payload.to === "working";
}

function hasContextualComputerPayload(event: EventEnvelope): boolean {
  const payload = event.payload;
  return payload !== null
    && typeof payload === "object"
    && Object.keys(payload).every((key) => key === "botId");
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

async function waitForComputerState(h: Harness, botId: string, state: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const { body } = await computerRequest<{ state: string }>(h, "GET", `/api/computer/state?botId=${botId}`);
    if (body.state === state) return;
    if (Date.now() >= deadline) throw new Error(`computer for ${botId} did not reach ${state}; current=${body.state}`);
    await Bun.sleep(20);
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

  test("idle state includes the latest observable preview without requiring input ownership", async () => {
    const botId = await makeBot(h, "Observer");

    const observation = await h.svc.computer.act({ botId }, undefined, { name: "observe", args: {} });
    expect(observation.text).toMatch(/^fake-observe#/);

    const snapshot = await computerRequest<ArrayBuffer>(h, "GET", "/api/computer/snapshot");
    expect(snapshot.response.status).toBe(200);
    expect(snapshot.response.headers.get("content-type")).toBe("image/png");
    expect(snapshot.body.byteLength).toBeGreaterThan(0);

    const { body } = await computerRequest<{ state: string; activity?: string; previewAt?: string }>(
      h,
      "GET",
      `/api/computer/state?botId=${botId}`,
    );
    expect(body.state).toBe("idle");
    expect(body.activity).toBe("The computer is ready.");
    expect(body.previewAt).toBeString();
  });

  test("bot use and waiting are scoped to the selected bot", async () => {
    const usingBotId = await makeBot(h, "Using");
    const waitingBotId = await makeBot(h, "Waiting");
    const unrelatedBotId = await makeBot(h, "Unrelated");

    expect((await h.svc.computer.acquire({ botId: usingBotId }, undefined)).granted).toBeTrue();
    expect((await h.svc.computer.acquire({ botId: waitingBotId }, undefined)).queued).toBeTrue();

    expect((await computerRequest<{ state: string; botId?: string }>(h, "GET", `/api/computer/state?botId=${usingBotId}`)).body).toMatchObject({
      state: "bot-using",
      botId: usingBotId,
    });
    expect((await computerRequest<{ state: string; botId?: string }>(h, "GET", `/api/computer/state?botId=${waitingBotId}`)).body).toMatchObject({
      state: "waiting",
      botId: waitingBotId,
    });
    expect((await computerRequest<{ state: string; botId?: string }>(h, "GET", `/api/computer/state?botId=${unrelatedBotId}`)).body).toMatchObject({
      state: "idle",
    });
  });

  test("takeover parks the active bot and return re-observes before resuming it", async () => {
    const botId = await makeBot(h, "Driver");
    const turn = await sendToBot(h, botId, "hang");
    await waitForTurnStatus(h, turn.turnId, "working");
    expect((await h.svc.computer.acquire({ botId }, turn.turnId)).granted).toBeTrue();

    const taken = await computerRequest<{ state: string }>(h, "POST", `/api/computer/take-control?botId=${botId}`);
    expect(taken.body.state).toBe("user-control");
    await waitForTurnStatus(h, turn.turnId, "waiting_for_input");

    const returned = await computerRequest<{ state: string; botId?: string }>(h, "POST", `/api/computer/return-to-bot?botId=${botId}`);
    expect(returned.body).toMatchObject({ state: "bot-using", botId });
    await waitForTurnStatus(h, turn.turnId, "working");

    const events = h.svc.events.replay(0, h.svc.events.oldestCursor()).events;
    const resumed = events.find((event) => isResumeEvent(event, turn.turnId));
    const stateChanges = events.filter((event) => event.aggregateType === "computer");
    expect(resumed).toBeDefined();
    expect(stateChanges.length).toBeGreaterThan(0);
    expect(stateChanges.every((event) => event.aggregateId === "state" && event.type === "computer.state.changed")).toBeTrue();
    expect(stateChanges.every(hasContextualComputerPayload)).toBeTrue();
    expect(stateChanges.some((event) => event.cursor < resumed!.cursor)).toBeTrue();
  });

  test("input leases serialize bots while observation remains ownership-free", async () => {
    const firstBotId = await makeBot(h, "First");
    const secondBotId = await makeBot(h, "Second");
    const firstTurn = await sendToBot(h, firstBotId, "hang");
    const secondTurn = await sendToBot(h, secondBotId, "hang");
    await waitForTurnStatus(h, firstTurn.turnId, "working");
    await waitForTurnStatus(h, secondTurn.turnId, "working");
    const firstLease = await h.svc.computer.acquire({ botId: firstBotId }, firstTurn.turnId);
    expect(firstLease.granted).toBeTrue();
    expect((await h.svc.computer.acquire({ botId: secondBotId }, secondTurn.turnId)).queued).toBeTrue();
    await waitForTurnStatus(h, secondTurn.turnId, "waiting_for_computer");

    await expect(h.svc.computer.act({ botId: firstBotId }, firstTurn.turnId, { name: "type", args: { text: "one" } })).resolves.toMatchObject({
      text: expect.stringMatching(/^fake-type#/),
    });
    await expect(h.svc.computer.act({ botId: secondBotId }, secondTurn.turnId, { name: "type", args: { text: "two" } })).rejects.toThrow(
      `input lease held by ${firstBotId}`,
    );
    await expect(h.svc.computer.act({ botId: secondBotId }, secondTurn.turnId, { name: "observe", args: {} })).resolves.toMatchObject({
      text: expect.stringMatching(/^fake-observe#/),
    });

    h.svc.computer.release({ botId: firstBotId }, firstLease.token!);
    await waitForComputerState(h, secondBotId, "bot-using");
    await waitForTurnStatus(h, secondTurn.turnId, "working");
    await expect(h.svc.computer.act({ botId: secondBotId }, secondTurn.turnId, { name: "click", args: { x: 1, y: 1 } })).resolves.toMatchObject({
      text: expect.stringMatching(/^fake-click#/),
    });
  });

  test("open_url needs only the active lease and reports contextual state", async () => {
    const botId = await makeBot(h, "Computer user");
    const lease = await h.svc.computer.acquire({ botId }, undefined);

    await expect(h.svc.computer.act({ botId }, undefined, { name: "open_url", args: { url: "https://example.com" } })).resolves.toMatchObject({
      text: expect.stringMatching(/^fake-open_url#/),
    });
    expect(lease.granted).toBeTrue();
    expect((await computerRequest<{ state: string; botId?: string }>(h, "GET", `/api/computer/state?botId=${botId}`)).body)
      .toMatchObject({ state: "bot-using", botId });
  });

  test("a human takeover is not stolen after its stored expiry time", async () => {
    const botId = await makeBot(h, "Patient");
    expect((await h.svc.computer.takeOver()).ok).toBeTrue();
    h.svc.db.query(`UPDATE computer_leases SET expires_at = ? WHERE id = 1`).run("2000-01-01T00:00:00.000Z");

    expect((await h.svc.computer.acquire({ botId }, undefined)).granted).toBeFalse();
    expect((await computerRequest<{ state: string }>(h, "GET", `/api/computer/state?botId=${botId}`)).body.state).toBe("user-control");
    await expect(h.svc.computer.act({ botId }, undefined, { name: "type", args: { text: "nope" } })).rejects.toThrow(/human/);
  });

  test("emergency stop revokes input globally while leaving observation available until resume", async () => {
    const botId = await makeBot(h, "Emergency Bot");
    expect((await h.svc.computer.acquire({ botId }, undefined)).granted).toBeTrue();

    expect((await computerRequest<{ state: string }>(h, "POST", "/api/computer/emergency-stop")).body.state).toBe("emergency-stopped");
    await expect(h.svc.computer.act({ botId }, undefined, { name: "type", args: { text: "blocked" } })).rejects.toThrow(
      "computer input is emergency-stopped",
    );
    await expect(h.svc.computer.act({ botId }, undefined, { name: "observe", args: {} })).resolves.toMatchObject({
      text: expect.stringMatching(/^fake-observe#/),
    });

    expect((await computerRequest<{ state: string; botId?: string }>(h, "POST", `/api/computer/resume?botId=${botId}`)).body).toMatchObject({
      state: "bot-using",
      botId,
    });
  });

  test("non-computer requests are left to the parent router", async () => {
    expect(await handleComputerRequest(new Request(`${h.baseUrl}/api/health`), h.svc.computer)).toBeUndefined();
    expect(await api<{ ok: boolean }>(h, "GET", "/api/health")).toMatchObject({ ok: true });
  });
});
