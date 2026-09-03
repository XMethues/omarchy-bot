import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { EventEnvelope } from "../../packages/protocol/src/index.ts";
import { handleComputerRequest } from "../../apps/daemon/src/api/computerRoutes.ts";
import type { ComputerSurfaceOwner } from "../../apps/daemon/src/modules/computer/broker.ts";
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
    && "botId" in payload
    && "surfaceId" in payload
    && typeof payload.botId === "string"
    && typeof payload.surfaceId === "string";
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
): Promise<{ botId: string; surfaceId: string; state: string; activity?: string; previewAt?: string }> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const result = await computerRequest<{ botId: string; surfaceId: string; state: string; activity?: string; previewAt?: string }>(
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
  test("preview observations and cached state remain scoped to their Surface", async () => {
    const first = await ownerFor(h, await makeBot(h, "Observer"));
    const second = await ownerFor(h, await makeBot(h, "Other observer"));

    const observation = await h.svc.computer.act(first, undefined, { name: "observe", args: {} });
    expect(observation.text).toMatch(/^fake-observe#/);

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
    });
  });

  test("Bot Surfaces hold independent input leases", async () => {
    const first = await ownerFor(h, await makeBot(h, "First"));
    const second = await ownerFor(h, await makeBot(h, "Second"));

    const firstLease = await h.svc.computer.acquire(first, undefined);
    const secondLease = await h.svc.computer.acquire(second, undefined);
    expect(firstLease.granted).toBeTrue();
    expect(secondLease.granted).toBeTrue();
    await expect(h.svc.computer.act(first, undefined, { name: "type", args: { text: "one" } })).resolves.toMatchObject({
      text: expect.stringMatching(/^fake-type#/),
    });
    await expect(h.svc.computer.act(second, undefined, { name: "type", args: { text: "two" } })).resolves.toMatchObject({
      text: expect.stringMatching(/^fake-type#/),
    });
    expect((await computerRequest(h, "GET", computerPath("/api/computer/state", first))).body)
      .toMatchObject({ ...first, state: "bot-using" });
    expect((await computerRequest(h, "GET", computerPath("/api/computer/state", second))).body)
      .toMatchObject({ ...second, state: "bot-using" });
  });

  test("takeover parks and resumes only the owning Surface's active turn", async () => {
    const botId = await makeBot(h, "Driver");
    const owner = await ownerFor(h, botId);
    const turn = await sendToBot(h, botId, "hang");
    await waitForTurnStatus(h, turn.turnId, "working");
    expect((await h.svc.computer.acquire(owner, turn.turnId)).granted).toBeTrue();

    const taken = await computerRequest<{ state: string }>(
      h,
      "POST",
      computerPath("/api/computer/take-control", owner),
    );
    expect(taken.body.state).toBe("user-control");
    await waitForTurnStatus(h, turn.turnId, "waiting_for_input");

    const returned = await computerRequest<{ state: string; botId: string; surfaceId: string }>(
      h,
      "POST",
      computerPath("/api/computer/return-to-bot", owner),
    );
    expect(returned.body).toMatchObject({ ...owner, state: "bot-using" });
    await waitForTurnStatus(h, turn.turnId, "working");

    const events = h.svc.events.replay(0, h.svc.events.oldestCursor()).events;
    const resumed = events.find((event) => isResumeEvent(event, turn.turnId));
    const stateChanges = events.filter((event) => event.aggregateType === "computer");
    expect(resumed).toBeDefined();
    expect(stateChanges.length).toBeGreaterThan(0);
    expect(stateChanges.every((event) =>
      event.aggregateId === owner.surfaceId && event.type === "computer.state.changed"
    )).toBeTrue();
    expect(stateChanges.every(hasContextualComputerPayload)).toBeTrue();
    expect(stateChanges.some((event) => event.cursor < resumed!.cursor)).toBeTrue();
  });

  test("Surface-scoped emergency stop leaves another Bot Surface usable", async () => {
    const stopped = await ownerFor(h, await makeBot(h, "Stopped Bot"));
    const unaffected = await ownerFor(h, await makeBot(h, "Unaffected Bot"));
    expect((await h.svc.computer.acquire(stopped, undefined)).granted).toBeTrue();
    expect((await h.svc.computer.acquire(unaffected, undefined)).granted).toBeTrue();

    expect((
      await computerRequest<{ state: string }>(
        h,
        "POST",
        computerPath("/api/computer/emergency-stop", stopped),
      )
    ).body.state).toBe("emergency-stopped");
    await expect(h.svc.computer.act(stopped, undefined, { name: "type", args: { text: "blocked" } }))
      .rejects.toThrow("computer input is emergency-stopped");
    await expect(h.svc.computer.act(unaffected, undefined, { name: "type", args: { text: "allowed" } }))
      .resolves.toMatchObject({ text: expect.stringMatching(/^fake-type#/) });

    expect((
      await computerRequest<{ state: string }>(
        h,
        "POST",
        computerPath("/api/computer/resume", stopped),
      )
    ).body.state).toBe("bot-using");
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
