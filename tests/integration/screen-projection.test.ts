import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import path from "node:path";
import { mkdirSync, rmSync } from "node:fs";
import rtc, { type DataChannel, type PeerConnection } from "node-datachannel";
import type { ComputerSurfaceOwner } from "../../apps/daemon/src/modules/computer/broker.ts";
import { FakeBotScreenRuntimeAdapter } from "../../apps/daemon/src/modules/computer/fakeBotScreenRuntime.ts";
import type {
  BotScreenProvision,
  BotScreenRuntime,
  BotScreenRuntimeAdapter,
} from "../../apps/daemon/src/modules/computer/botScreenManager.ts";
import { api, makeBot, sendToBot, startDaemon, waitThreadIdle, type Harness } from "./helpers/harness.ts";

const EXPECTED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWMQMgn7D8IAC5MDN627upEAAAAASUVORK5CYII=";
const DATA_CHANNEL_OPEN_TIMEOUT_MS = 15_000;

interface ProjectionAnswer {
  type: "answer";
  sdp: string;
  sessionId: string;
  surfaceId: string;
  runtimeGeneration: number;
  geometryGeneration: number;
  logicalWidth: number;
  logicalHeight: number;
  videoWidth: number;
  videoHeight: number;
  scale: number;
  security: {
    authentication: "none";
    httpsRequired: false;
  };
  candidates: Array<{ candidate: string; sdpMid: string }>;
}

class ObserveArtifactAdapter implements BotScreenRuntimeAdapter {
  readonly inner = new FakeBotScreenRuntimeAdapter();
  onObserve: (() => void) | undefined;

  async start(provision: BotScreenProvision): Promise<BotScreenRuntime> {
    const runtime = await this.inner.start(provision);
    const act: BotScreenRuntime["act"] = async (action, authority) => {
      const result = await runtime.act(action, authority);
      if (action.name === "observe") this.onObserve?.();
      return action.name === "observe"
        ? {
            ...result,
            image: { mediaType: "image/png", bytes: new Uint8Array([1, 2, 3]) },
          }
        : result;
    };
    return { ...runtime, act };
  }
}

async function ownerFor(h: Harness, botId: string): Promise<ComputerSurfaceOwner> {
  const bot = await api<{ id: string; surfaceId: string }>(h, "GET", `/api/bots/${botId}`);
  return { botId: bot.id, surfaceId: bot.surfaceId as ComputerSurfaceOwner["surfaceId"] };
}

function coordination(h: Harness, surfaceId: ComputerSurfaceOwner["surfaceId"]): {
  authority_kind: "idle" | "agent" | "web" | "takeover";
  controller_epoch: number;
} | null {
  return h.svc.db
    .query(
      `SELECT authority_kind, controller_epoch
       FROM computer_surface_coordination WHERE surface_id = ?`,
    )
    .get(surfaceId) as {
      authority_kind: "idle" | "agent" | "web" | "takeover";
      controller_epoch: number;
    } | null;
}

function waitFor<T>(
  description: string,
  subscribe: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
  timeoutMs = 5_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${description} timed out`)), timeoutMs);
    subscribe(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function createOffer(peer: PeerConnection): Promise<string> {
  const gathered = waitFor<void>("offer ICE gathering", (resolve) => {

    const resolveIfComplete = (): void => {
      if (peer.gatheringState() === "complete") resolve();
    };
    peer.onGatheringStateChange(resolveIfComplete);
    queueMicrotask(resolveIfComplete);
  });
  const described = waitFor<void>("offer local description", (resolve) => peer.onLocalDescription(() => resolve()));
  peer.createDataChannel("screen.frames.v1", { unordered: false });
  peer.createDataChannel("screen.control.v1", { unordered: false });
  peer.createDataChannel("screen.input.v1", { unordered: false });
  peer.setLocalDescription("offer");
  await described;
  await gathered;
  const description = peer.localDescription();
  if (description === null) throw new Error("WebRTC offer was not created");
  return description.sdp;
}
function within<T>(description: string, promise: Promise<T>, timeoutMs = 5_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${description}`)), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function openChannel(channel: DataChannel): Promise<DataChannel> {
  if (channel.isOpen()) return Promise.resolve(channel);
  return waitFor<DataChannel>(
    `${channel.getLabel()} channel opening`,
    (resolve, reject) => {
      channel.onOpen(() => resolve(channel));
      channel.onError((message) => reject(new Error(message)));
      channel.onClosed(() => reject(new Error(`${channel.getLabel()} closed before opening`)));
      if (channel.isOpen()) resolve(channel);
    },
    // Native SCTP startup is readiness-driven but can be CPU-starved by other
    // integration files; retain the state re-check and allow the observed edge.
    DATA_CHANNEL_OPEN_TIMEOUT_MS,
  );
}


async function connectProjection(
  h: Harness,
  owner: ComputerSurfaceOwner,
  name: string,
): Promise<{
  peer: PeerConnection;
  frames: DataChannel;
  control: DataChannel;
  input: DataChannel;
  answer: ProjectionAnswer;
}> {
  const peer = new rtc.PeerConnection(name, { iceServers: [] });
  const gathered = waitFor<void>(`${name} ICE gathering`, (resolve) => {
    const resolveIfComplete = (): void => {
      if (peer.gatheringState() === "complete") resolve();
    };
    peer.onGatheringStateChange(resolveIfComplete);
    queueMicrotask(resolveIfComplete);
  });
  const described = waitFor<void>(`${name} local description`, (resolve) => peer.onLocalDescription(() => resolve()));
  const frames = peer.createDataChannel("screen.frames.v1", { unordered: false });
  const control = peer.createDataChannel("screen.control.v1", { unordered: false });
  const input = peer.createDataChannel("screen.input.v1", { unordered: false });
  peer.setLocalDescription("offer");
  await described;
  await gathered;
  const offer = peer.localDescription();
  if (offer === null) throw new Error("WebRTC offer was not created");
  const response = await fetch(
    `${h.baseUrl}/api/computer/projection?botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "offer", sdp: offer.sdp }),
    },
  );
  expect(response.status).toBe(201);
  const answer = await response.json() as ProjectionAnswer;
  peer.setRemoteDescription(answer.sdp, "answer");
  for (const candidate of answer.candidates) peer.addRemoteCandidate(candidate.candidate, candidate.sdpMid);
  await Promise.all([openChannel(frames), openChannel(control), openChannel(input)]);
  return { peer, frames, control, input, answer };
}

function authority(input: DataChannel, active = true): Promise<{
  active: boolean;
  surfaceId: string;
  runtimeGeneration: number;
  geometryGeneration: number;
  controllerEpoch: number;
}> {
  return waitFor(`${active ? "input authority grant" : "input authority revocation"}`, (resolve, reject) => {
    input.onMessage((raw) => {
      if (typeof raw !== "string") return;
      const message = JSON.parse(raw) as { type?: string };
      if (message.type === "input-authority" && "active" in message && message.active === active) {
        resolve(message as never);
      }
    });
    input.onClosed(() => reject(new Error("input channel closed before authority changed")));
    input.onError((message) => reject(new Error(message)));
  });
}

function authorityCycle(input: DataChannel): {
  revoked: Promise<void>;
  granted: Promise<{
    active: true;
    surfaceId: string;
    runtimeGeneration: number;
    geometryGeneration: number;
    controllerEpoch: number;
  }>;
} {
  const revoked = Promise.withResolvers<void>();
  const granted = Promise.withResolvers<{
    active: true;
    surfaceId: string;
    runtimeGeneration: number;
    geometryGeneration: number;
    controllerEpoch: number;
  }>();
  let sawRevocation = false;
  input.onMessage((raw) => {
    if (typeof raw !== "string") return;
    const message = JSON.parse(raw) as {
      type?: string;
      active?: boolean;
      surfaceId: string;
      runtimeGeneration: number;
      geometryGeneration: number;
      controllerEpoch: number;
    };
    if (message.type !== "input-authority") return;
    if (message.active === false) {
      sawRevocation = true;
      revoked.resolve();
    } else if (message.active === true && sawRevocation) {
      granted.resolve({ ...message, active: true });
    }
  });
  return { revoked: revoked.promise, granted: granted.promise };
}
describe("WebRTC Screen Projection signaling", () => {
  let h: Harness;
  let peer: PeerConnection | undefined;

  beforeEach(async () => {
    h = await startDaemon();
  });

  afterEach(async () => {
    peer?.close();
    await h.stop();
  });

  test("projects versioned direct Surface frames only after a viewer becomes active", async () => {
    const owner = await ownerFor(h, await makeBot(h, "Projected screen"));
    peer = new rtc.PeerConnection("projection-test-browser", { iceServers: [] });

    const gathered = waitFor<void>("direct projection ICE gathering", (resolve) => {
      const resolveIfComplete = (): void => {
        if (peer!.gatheringState() === "complete") resolve();
      };
      peer!.onGatheringStateChange(resolveIfComplete);
      queueMicrotask(resolveIfComplete);
    });
    const described = waitFor<void>(
      "direct projection local description",
      (resolve) => peer!.onLocalDescription(() => resolve()),
    );
    const frames = peer.createDataChannel("screen.frames.v1", { unordered: false });
    const control = peer.createDataChannel("screen.control.v1", { unordered: false });
    const input = peer.createDataChannel("screen.input.v1", { unordered: false });
    peer.setLocalDescription("offer");
    await described;
    await gathered;
    const offer = peer.localDescription();
    if (offer === null) throw new Error("WebRTC offer was not created");

    const response = await fetch(
      `${h.baseUrl}/api/computer/projection?botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "offer", sdp: offer.sdp }),
      },
    );
    expect(response.status).toBe(201);
    const answer = await response.json() as ProjectionAnswer;
    const sessionId = answer.sessionId;
    expect(typeof sessionId).toBe("string");
    expect(answer).toMatchObject({
      type: "answer",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: 1,
      logicalWidth: 1920,
      logicalHeight: 1080,
      videoWidth: 1920,
      videoHeight: 1080,
      scale: 1,
      security: { authentication: "none", httpsRequired: false },
    });
    expect(answer.sdp).toContain("a=fingerprint:");

    peer.setRemoteDescription(answer.sdp, "answer");
    for (const candidate of answer.candidates) peer.addRemoteCandidate(candidate.candidate, candidate.sdpMid);
    await Promise.all([openChannel(frames), openChannel(control), openChannel(input)]);

    const statusUrl =
      `${h.baseUrl}/api/computer/projection?botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}&sessionId=${encodeURIComponent(sessionId)}`;
    const idleStatus = await fetch(statusUrl);
    const idleBody = await idleStatus.json();
    expect({ status: idleStatus.status, body: idleBody }).toMatchObject({
      status: 200,
      body: {
        sessionId,
        surfaceId: owner.surfaceId,
        runtimeGeneration: 1,
        state: "idle",
        mode: "idle",
        framesSent: 0,
      },
    });
    expect(idleBody).not.toHaveProperty("encodedFrames");
    expect(h.svc.projections.loadMetrics(owner, sessionId)).toMatchObject({
      sequence: 0,
      captureAttempts: 0,
      sourceFrames: 0,
      encodedFrames: 0,
      framesSent: 0,
      preCaptureBackpressureSkips: 0,
      encodedBackpressureDrops: 0,
      transportUnavailableSkips: 0,
      invalidFrameDrops: 0,
      sendFailures: 0,
    });

    const messages: Array<string | Buffer | ArrayBuffer> = [];
    const receivedFrame = waitFor<void>("projected frame", (resolve) => {
      frames.onMessage((message) => {
        messages.push(message);
        if (messages.length === 2) resolve();
      });
    });
    expect(control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      mode: "preview",
    }))).toBeTrue();
    await receivedFrame;

    expect(JSON.parse(String(messages[0]))).toMatchObject({
      version: 1,
      type: "frame",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: 1,
      logicalWidth: 1920,
      logicalHeight: 1080,
      videoWidth: 1920,
      videoHeight: 1080,
      scale: 1,
      sequence: 1,
      mediaType: "image/png",
      mode: "preview",
    });
    expect(Buffer.from(messages[1] as Buffer).toString("base64")).toBe(EXPECTED_PNG_BASE64);
    const activeStatus = await fetch(statusUrl);
    expect(activeStatus.status).toBe(200);
    expect(await activeStatus.json()).toMatchObject({ state: "preview", mode: "preview", framesSent: 1 });
    expect(h.svc.projections.loadMetrics(owner, sessionId)).toMatchObject({
      sequence: 1,
      captureAttempts: 1,
      sourceFrames: 1,
      encodedFrames: 1,
      framesSent: 1,
      encodedBackpressureDrops: 0,
      invalidFrameDrops: 0,
      sendFailures: 0,
    });
  }, 15_000);

  test("expanded Screen Projection targets at least 15 delivered frames per second", async () => {
    const owner = await ownerFor(h, await makeBot(h, "Expanded frame rate"));
    const connection = await connectProjection(h, owner, "expanded-frame-rate-browser");
    peer = connection.peer;
    const eighthFrame = Promise.withResolvers<void>();
    let frames = 0;
    connection.frames.onMessage((raw) => {
      if (typeof raw !== "string") return;
      const message = JSON.parse(raw) as { type?: string };
      if (message.type !== "frame") return;
      frames += 1;
      if (frames === 8) eighthFrame.resolve();
    });

    const startedAt = performance.now();
    expect(connection.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: connection.answer.runtimeGeneration,
      mode: "expanded",
    }))).toBeTrue();
    await eighthFrame.promise;
    expect(performance.now() - startedAt).toBeLessThanOrEqual(550);
  }, 15_000);

  test("rejects a WebRTC offer when Bot and Surface do not own each other", async () => {
    const first = await ownerFor(h, await makeBot(h, "Projection owner"));
    const second = await ownerFor(h, await makeBot(h, "Different projection owner"));
    peer = new rtc.PeerConnection("projection-mismatch-browser", { iceServers: [] });
    const sdp = await createOffer(peer);

    const response = await fetch(
      `${h.baseUrl}/api/computer/projection?botId=${encodeURIComponent(first.botId)}&surfaceId=${encodeURIComponent(second.surfaceId)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "offer", sdp }),
      },
    );

    expect(response.status).toBe(404);
  }, 15_000);

  test("malformed SDP settles signaling deadlines without an unhandled rejection", async () => {
    const owner = await ownerFor(h, await makeBot(h, "Malformed projection"));
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown): void => {
      unhandled.push(error);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      const response = await fetch(
        `${h.baseUrl}/api/computer/projection?botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ type: "offer", sdp: "not-a-valid-sdp" }),
        },
      );
      expect(response.status).toBe(503);
      // The former rejection came from the real five-second signaling deadline.
      await Bun.sleep(5_100);
      expect(unhandled).toEqual([]);
      expect((await fetch(`${h.baseUrl}/api/health`)).status).toBe(200);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  }, 15_000);
});


describe("expanded pointer Web Control", () => {
  let h: Harness;
  const peers: PeerConnection[] = [];

  afterEach(async () => {
    for (const connectedPeer of peers.splice(0)) connectedPeer.close();
    await h.stop();
  });
  test("normal daemon shutdown clears the diagnostics sweep timer", async () => {
    const originalSetInterval = globalThis.setInterval;
    const originalClearInterval = globalThis.clearInterval;
    const hourlyTimers = new Set<Timer>();
    const clearedTimers = new Set<Timer>();
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
      const timer = originalSetInterval(...args);
      if (args[1] === 60 * 60 * 1_000) hourlyTimers.add(timer);
      return timer;
    }) as typeof setInterval;
    globalThis.clearInterval = ((timer?: Timer) => {
      if (timer !== undefined && hourlyTimers.has(timer)) clearedTimers.add(timer);
      originalClearInterval(timer);
    }) as typeof clearInterval;
    try {
      h = await startDaemon(undefined, { botScreenAdapter: new FakeBotScreenRuntimeAdapter() });
      expect(hourlyTimers.size).toBe(1);
      await h.stop();
      expect(clearedTimers).toEqual(hourlyTimers);
      h = { ...h, stop: async () => {} };
    } finally {
      globalThis.setInterval = originalSetInterval;
      globalThis.clearInterval = originalClearInterval;
    }
  });

  test("standalone expanded Web Control owns scoped Broker state until release", async () => {
    const runtime = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: runtime });
    const owner = await ownerFor(h, await makeBot(h, "Standalone Web Control"));
    const projection = await connectProjection(h, owner, "standalone-control-browser");
    peers.push(projection.peer);
    let stateEvents = 0;
    const released = Promise.withResolvers<void>();
    const unsubscribe = h.svc.events.subscribe((event) => {
      if (
        event.aggregateType !== "computer"
        || event.aggregateId !== owner.surfaceId
        || event.type !== "computer.state.changed"
      ) return;
      stateEvents += 1;
      if (coordination(h, owner.surfaceId)?.authority_kind === "idle") released.resolve();
    });

    try {
      const granted = authority(projection.input);
      projection.control.sendMessage(JSON.stringify({
        version: 1,
        type: "view",
        surfaceId: owner.surfaceId,
        runtimeGeneration: projection.answer.runtimeGeneration,
        mode: "expanded",
      }));
      await granted;
      const query = `botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`;
      expect(await fetch(`${h.baseUrl}/api/computer/state?${query}`).then((response) => response.json()))
        .toMatchObject({ state: "user-control", takeover: "unavailable" });
      expect(coordination(h, owner.surfaceId)).toMatchObject({ authority_kind: "web" });

      const revoked = authority(projection.input, false);
      projection.control.sendMessage(JSON.stringify({
        version: 1,
        type: "view",
        surfaceId: owner.surfaceId,
        runtimeGeneration: projection.answer.runtimeGeneration,
        mode: "preview",
      }));
      await revoked;
      await released.promise;
      expect(await fetch(`${h.baseUrl}/api/computer/state?${query}`).then((response) => response.json()))
        .toMatchObject({ state: "ready", takeover: "unavailable" });
      expect(coordination(h, owner.surfaceId)).toMatchObject({ authority_kind: "idle" });
      expect(stateEvents).toBe(2);
    } finally {
      unsubscribe();
    }
  }, 15_000);

  test("failed final artifact persistence restores the still-open Takeover controller", async () => {
    const adapter = new ObserveArtifactAdapter();
    adapter.inner.blockActions();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const owner = await ownerFor(h, await makeBot(h, "Takeover recovery"));
    const projection = await connectProjection(h, owner, "takeover-recovery-browser");
    peers.push(projection.peer);
    const controller = new AbortController();
    const action = h.svc.computer.agentToolAct(
      owner,
      "takeover-recovery-turn",
      "takeover-recovery-tool",
      { name: "click", args: {} },
      controller.signal,
    );
    action.catch(() => {});
    await adapter.inner.waitForActions(1);
    const takeover = h.svc.computer.takeOver(owner);
    adapter.inner.releaseActions();
    await expect(takeover).resolves.toEqual({ ok: true });

    const initialGrant = authority(projection.input);
    projection.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: projection.answer.runtimeGeneration,
      mode: "expanded",
    }));
    await initialGrant;
    rmSync(path.join(h.home, "artifacts"), { recursive: true, force: true });
    const cycle = authorityCycle(projection.input);
    const query = `botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`;
    const failedReturn = fetch(`${h.baseUrl}/api/computer/return-to-bot?${query}`, { method: "POST" });
    await within("Takeover controller revocation", cycle.revoked);
    const restored = await within("Takeover controller restoration", cycle.granted);
    const failedResponse = await within("failed return response", failedReturn);
    expect(failedResponse.status).toBe(502);
    expect(await failedResponse.json()).toEqual({
      error: "The Bot Screen could not be observed. You still have control.",
    });
    expect(await fetch(`${h.baseUrl}/api/computer/state?${query}`).then((response) => response.json()))
      .toMatchObject({ state: "user-control", takeover: "active" });
    expect(coordination(h, owner.surfaceId)).toMatchObject({ authority_kind: "takeover" });

    const inputReceived = adapter.inner.waitForInputEvents(1);
    projection.input.sendMessage(JSON.stringify({
      version: 1,
      type: "pointer-motion",
      surfaceId: owner.surfaceId,
      runtimeGeneration: restored.runtimeGeneration,
      geometryGeneration: restored.geometryGeneration,
      controllerEpoch: restored.controllerEpoch,
      sequence: 1,
      x: 100,
      y: 200,
    }));
    await within("restored controller input", inputReceived);

    mkdirSync(path.join(h.home, "artifacts"), { recursive: true });

    const finalRevocation = authority(projection.input, false);
    const returned = h.svc.computer.imDone(owner);
    await within("final Takeover controller revocation", finalRevocation);
    expect(await within("successful return", returned)).toMatchObject({ observation: "fake-observe#3" });
    await expect(within("completed Agent action", action)).resolves.toMatchObject({ text: "fake-observe#3" });
  }, 20_000);
  test("double failure waits without authority and a fresh controller resumes Takeover", async () => {
    const adapter = new ObserveArtifactAdapter();
    adapter.inner.blockActions();
    h = await startDaemon(undefined, { botScreenAdapter: adapter });
    const owner = await ownerFor(h, await makeBot(h, "Interrupted Takeover"));
    const projection = await connectProjection(h, owner, "interrupted-takeover-browser");
    peers.push(projection.peer);
    const controller = new AbortController();
    const action = h.svc.computer.agentToolAct(
      owner,
      "interrupted-takeover-turn",
      "interrupted-takeover-tool",
      { name: "click", args: {} },
      controller.signal,
    );
    action.catch(() => {});
    await adapter.inner.waitForActions(1);
    const takeover = h.svc.computer.takeOver(owner);
    adapter.inner.releaseActions();
    await expect(takeover).resolves.toEqual({ ok: true });

    const initialGrant = authority(projection.input);
    projection.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: projection.answer.runtimeGeneration,
      mode: "expanded",
    }));
    await initialGrant;
    adapter.onObserve = () => {
      adapter.onObserve = undefined;
      h.svc.projections.close(owner, projection.answer.sessionId);
    };
    rmSync(path.join(h.home, "artifacts"), { recursive: true, force: true });
    const revoked = authority(projection.input, false);
    const query = `botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`;
    const failedReturn = fetch(`${h.baseUrl}/api/computer/return-to-bot?${query}`, { method: "POST" });
    await within("interrupted controller revocation", revoked);
    const failedResponse = await within("double-failure response", failedReturn);
    expect(failedResponse.status).toBe(502);
    expect(await failedResponse.json()).toEqual({
      error: "The Bot Screen could not be observed and Web Control was interrupted. Reconnect to continue Takeover.",
    });
    expect(await Promise.race([
      action.then(() => "settled" as const, () => "settled" as const),
      Promise.resolve("pending" as const),
    ])).toBe("pending");
    expect(await fetch(`${h.baseUrl}/api/computer/state?${query}`).then((response) => response.json()))
      .toMatchObject({ state: "ready", takeover: "active" });
    expect(coordination(h, owner.surfaceId)).toMatchObject({ authority_kind: "idle" });

    const replacement = await connectProjection(h, owner, "replacement-takeover-browser");
    peers.push(replacement.peer);
    const replacementGrant = authority(replacement.input);
    replacement.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: replacement.answer.runtimeGeneration,
      mode: "expanded",
    }));
    await replacementGrant;
    expect(await fetch(`${h.baseUrl}/api/computer/state?${query}`).then((response) => response.json()))
      .toMatchObject({ state: "user-control", takeover: "active" });
    expect(coordination(h, owner.surfaceId)).toMatchObject({ authority_kind: "takeover" });

    mkdirSync(path.join(h.home, "artifacts"), { recursive: true });
    const finalRevocation = authority(replacement.input, false);
    const returned = h.svc.computer.imDone(owner);
    await within("replacement controller revocation", finalRevocation);
    expect(await within("replacement return", returned)).toMatchObject({ observation: "fake-observe#3" });
    await expect(within("resumed Agent action", action)).resolves.toMatchObject({ text: "fake-observe#3" });
  }, 20_000);
  test("excludes browser input during a pending Bot action and grants it only for the held Takeover", async () => {
    const runtime = new FakeBotScreenRuntimeAdapter();
    runtime.blockActions();
    h = await startDaemon(undefined, { botScreenAdapter: runtime });
    const botId = await makeBot(h, "Takeover controlled screen");
    const owner = await ownerFor(h, botId);
    const projection = await connectProjection(h, owner, "takeover-browser");
    peers.push(projection.peer);

    const standaloneAuthority = authority(projection.input);
    projection.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      mode: "expanded",
    }));
    await standaloneAuthority;

    const revokedForBot = authority(projection.input, false);
    const turn = await sendToBot(h, botId, "computer:click:takeover");
    await revokedForBot;
    await runtime.waitForReleases(1);
    await runtime.waitForActions(1);
    expect(runtime.inputEvents).toHaveLength(0);

    const path = `botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`;
    const available = await fetch(`${h.baseUrl}/api/computer/state?${path}`).then((response) => response.json());
    expect(available).toMatchObject({ takeover: "available", state: "bot-using" });
    const takeover = fetch(`${h.baseUrl}/api/computer/take-control?${path}`, { method: "POST" });
    await fetch(`${h.baseUrl}/api/computer/state?${path}`);
    runtime.releaseActions();
    const taken = await takeover;
    expect(taken.status).toBe(200);
    expect(await taken.json()).toMatchObject({ takeover: "active", state: "user-control" });

    const takeoverAuthority = authority(projection.input);
    projection.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      mode: "expanded",
    }));
    const grant = await takeoverAuthority;
    projection.input.sendMessage(JSON.stringify({
      version: 1,
      type: "pointer-motion",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: 1,
      controllerEpoch: grant.controllerEpoch,
      sequence: 1,
      x: 100,
      y: 120,
    }));
    await runtime.waitForInputEvents(1);

    const revokedWhenDone = authority(projection.input, false);
    const returned = await fetch(`${h.baseUrl}/api/computer/return-to-bot?${path}`, { method: "POST" });
    await revokedWhenDone;
    expect(returned.status).toBe(200);
    expect(await returned.json()).toMatchObject({ takeover: "unavailable" });
    await waitThreadIdle(h, turn.threadId);
    expect(runtime.releaseCount).toBeGreaterThanOrEqual(2);
    expect(runtime.inputEvents).toHaveLength(1);
  }, 20_000);

  test("binds ordered pointer input to the current Surface, runtime, geometry, controller, and sequence", async () => {
    const runtime = new FakeBotScreenRuntimeAdapter(undefined, { pointerDelayMs: 20 });
    h = await startDaemon(undefined, { botScreenAdapter: runtime });
    const owner = await ownerFor(h, await makeBot(h, "Pointer controlled screen"));
    const first = await connectProjection(h, owner, "pointer-browser-one");
    peers.push(first.peer);
    const firstAuthority = authority(first.input);
    first.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      mode: "expanded",
    }));
    const firstGrant = await firstAuthority;
    expect(firstGrant).toMatchObject({
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: 1,
    });

    const envelope = {
      version: 1,
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: 1,
      controllerEpoch: firstGrant.controllerEpoch,
    };
    for (let sequence = 1; sequence <= 80; sequence += 1) {
      first.input.sendMessage(JSON.stringify({
        ...envelope,
        type: "pointer-motion",
        sequence,
        x: sequence,
        y: sequence * 2,
      }));
    }
    first.input.sendMessage(JSON.stringify({
      ...envelope,
      type: "pointer-button",
      sequence: 81,
      x: 80,
      y: 160,
      button: "left",
      state: "pressed",
    }));
    first.input.sendMessage(JSON.stringify({
      ...envelope,
      type: "pointer-motion",
      sequence: 82,
      x: 400,
      y: 300,
    }));
    first.input.sendMessage(JSON.stringify({
      ...envelope,
      type: "pointer-button",
      sequence: 83,
      x: 400,
      y: 300,
      button: "left",
      state: "released",
    }));
    first.input.sendMessage(JSON.stringify({
      ...envelope,
      type: "pointer-scroll",
      sequence: 84,
      x: 400,
      y: 300,
      deltaX: -2,
      deltaY: 12,
    }));

    await runtime.waitForPointerEvent(({ event }) => event.type === "scroll");
    const firstBatch = runtime.pointerEvents.map(({ event }) => event);
    const motions = firstBatch.filter((event) => event.type === "motion");
    expect(motions.length).toBeLessThan(80);
    expect(motions.at(-2)).toMatchObject({ type: "motion", x: 80, y: 160 });
    expect(motions.at(-1)).toMatchObject({ type: "motion", x: 400, y: 300 });
    expect(firstBatch.filter((event) => event.type !== "motion")).toMatchObject([
      { type: "button", x: 80, y: 160, button: "left", state: "pressed" },
      { type: "button", x: 400, y: 300, button: "left", state: "released" },
      { type: "scroll", x: 400, y: 300, deltaX: -2, deltaY: 12 },
    ]);
    expect(firstBatch.at(-1)).toEqual({
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: 1,
      controllerEpoch: firstGrant.controllerEpoch,
      sequence: 84,
      type: "scroll",
      x: 400,
      y: 300,
      deltaX: -2,
      deltaY: 12,
    });
    const second = await connectProjection(h, owner, "pointer-browser-two");
    peers.push(second.peer);
    const secondAuthority = authority(second.input);
    second.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      mode: "expanded",
    }));
    const secondGrant = await secondAuthority;
    expect(secondGrant.controllerEpoch).toBeGreaterThan(firstGrant.controllerEpoch);
    try {
      first.input.sendMessage(JSON.stringify({ ...envelope, type: "pointer-motion", sequence: 85, x: 900, y: 700 }));
    } catch {
      // Replacement may already have closed the stale controller channel.
    }
    second.input.sendMessage(JSON.stringify({
      ...envelope,
      controllerEpoch: secondGrant.controllerEpoch,
      type: "pointer-motion",
      sequence: 1,
      x: 100,
      y: 120,
    }));
    await runtime.waitForPointerEvents(firstBatch.length + 1);
    expect(runtime.pointerEvents.at(-1)?.event).toMatchObject({ type: "motion", x: 100, y: 120 });

    second.input.sendMessage(JSON.stringify({
      ...envelope,
      controllerEpoch: secondGrant.controllerEpoch,
      geometryGeneration: 2,
      type: "pointer-motion",
      sequence: 2,
      x: 200,
      y: 220,
    }));
    second.input.sendMessage(JSON.stringify({
      ...envelope,
      controllerEpoch: secondGrant.controllerEpoch,
      type: "pointer-motion",
      sequence: 3,
      x: 300,
      y: 320,
    }));
    await runtime.waitForReleases(2);
    expect(runtime.pointerEvents).toHaveLength(firstBatch.length + 1);
  }, 20_000);

  test("rejects duplicate and unmatched buttons while clearing held buttons and keys at revocation", async () => {
    const runtime = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: runtime });
    const owner = await ownerFor(h, await makeBot(h, "Validated button transitions"));
    const grant = async (name: string) => {
      const projection = await connectProjection(h, owner, name);
      peers.push(projection.peer);
      const granted = authority(projection.input);
      projection.control.sendMessage(JSON.stringify({
        version: 1,
        type: "view",
        surfaceId: owner.surfaceId,
        runtimeGeneration: 1,
        mode: "expanded",
      }));
      return { ...projection, epoch: (await granted).controllerEpoch };
    };
    const envelope = (epoch: number) => ({
      version: 1,
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: 1,
      controllerEpoch: epoch,
    });

    const unmatched = await grant("unmatched-button-browser");
    unmatched.input.sendMessage(JSON.stringify({
      ...envelope(unmatched.epoch),
      type: "pointer-button",
      button: "left",
      state: "released",
      x: 10,
      y: 20,
      sequence: 1,
    }));
    await runtime.waitForReleases(1);
    expect(runtime.inputEvents).toHaveLength(0);

    const duplicate = await grant("duplicate-button-browser");
    duplicate.input.sendMessage(JSON.stringify({
      ...envelope(duplicate.epoch),
      type: "pointer-button",
      button: "left",
      state: "pressed",
      x: 30,
      y: 40,
      sequence: 1,
    }));
    await runtime.waitForInputEvents(1);
    duplicate.input.sendMessage(JSON.stringify({
      ...envelope(duplicate.epoch),
      type: "pointer-button",
      button: "left",
      state: "pressed",
      x: 50,
      y: 60,
      sequence: 2,
    }));
    await runtime.waitForReleases(2);
    expect(runtime.inputEvents).toHaveLength(1);

    const suspended = await grant("held-button-browser");
    suspended.input.sendMessage(JSON.stringify({
      ...envelope(suspended.epoch),
      type: "key",
      code: "ShiftLeft",
      state: "pressed",
      modifiers: { control: false, alt: false, shift: true, meta: false },
      sequence: 1,
    }));
    suspended.input.sendMessage(JSON.stringify({
      ...envelope(suspended.epoch),
      type: "pointer-button",
      button: "right",
      state: "pressed",
      x: 70,
      y: 80,
      sequence: 2,
    }));
    await runtime.waitForInputEvents(3);
    suspended.input.sendMessage(JSON.stringify({
      ...envelope(suspended.epoch),
      type: "release-control",
      reason: "visibility-loss",
      sequence: 3,
    }));
    await runtime.waitForReleases(3);

    const rearmed = authority(suspended.input);
    suspended.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      mode: "expanded",
    }));
    const rearmedEpoch = (await rearmed).controllerEpoch;
    expect(rearmedEpoch).toBeGreaterThan(suspended.epoch);
    suspended.input.sendMessage(JSON.stringify({
      ...envelope(rearmedEpoch),
      type: "pointer-button",
      button: "right",
      state: "released",
      x: 70,
      y: 80,
      sequence: 1,
    }));
    await runtime.waitForReleases(4);
    expect(runtime.inputEvents).toHaveLength(3);

    const stillRunning = await grant("still-running-button-browser");
    stillRunning.input.sendMessage(JSON.stringify({
      ...envelope(stillRunning.epoch),
      type: "pointer-button",
      button: "middle",
      state: "pressed",
      x: 90,
      y: 100,
      sequence: 1,
    }));
    stillRunning.input.sendMessage(JSON.stringify({
      ...envelope(stillRunning.epoch),
      type: "pointer-button",
      button: "middle",
      state: "released",
      x: 90,
      y: 100,
      sequence: 2,
    }));
    await runtime.waitForInputEvents(5);
    expect(runtime.inputEvents.map(({ event }) => event)).toMatchObject([
      { type: "button", button: "left", state: "pressed" },
      { type: "key", keyCode: 42, state: "pressed" },
      { type: "button", button: "right", state: "pressed" },
      { type: "button", button: "middle", state: "pressed" },
      { type: "button", button: "middle", state: "released" },
    ]);
  }, 20_000);

  test("delivers keyboard transitions, modifiers, shortcuts, and one-way paste in controller order", async () => {
    const runtime = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: runtime });
    const owner = await ownerFor(h, await makeBot(h, "Keyboard controlled screen"));
    const projection = await connectProjection(h, owner, "keyboard-browser");
    peers.push(projection.peer);
    const granted = authority(projection.input);
    projection.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      mode: "expanded",
    }));
    const grant = await granted;
    const envelope = {
      version: 1,
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: 1,
      controllerEpoch: grant.controllerEpoch,
    };
    const messages = [
      { type: "key", code: "ControlLeft", state: "pressed", modifiers: { control: true, alt: false, shift: false, meta: false } },
      { type: "key", code: "KeyL", state: "pressed", modifiers: { control: true, alt: false, shift: false, meta: false } },
      { type: "key", code: "KeyL", state: "released", modifiers: { control: true, alt: false, shift: false, meta: false } },
      { type: "key", code: "ControlLeft", state: "released", modifiers: { control: false, alt: false, shift: false, meta: false } },
      { type: "paste", text: "one-way λ paste" },
    ];
    messages.forEach((message, index) => projection.input.sendMessage(JSON.stringify({
      ...envelope,
      ...message,
      sequence: index + 1,
    })));

    await runtime.waitForInputEvents(messages.length);
    expect(runtime.inputEvents.map(({ event }) => event)).toMatchObject([
      { type: "key", keyCode: 29, state: "pressed" },
      { type: "key", keyCode: 38, state: "pressed" },
      { type: "key", keyCode: 38, state: "released" },
      { type: "key", keyCode: 29, state: "released" },
      { type: "paste", text: "one-way λ paste" },
    ]);
  }, 15_000);

  test("releases held keys and buttons before replacement and rejects the stale controller epoch", async () => {

    const runtime = new FakeBotScreenRuntimeAdapter(undefined, { releaseDelayMs: 100 });
    h = await startDaemon(undefined, { botScreenAdapter: runtime });
    const owner = await ownerFor(h, await makeBot(h, "Replaceable controller screen"));
    const first = await connectProjection(h, owner, "held-input-browser-one");
    peers.push(first.peer);
    const firstGranted = authority(first.input);
    first.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      mode: "expanded",
    }));
    const firstGrant = await firstGranted;
    const firstEnvelope = {
      version: 1,
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: 1,
      controllerEpoch: firstGrant.controllerEpoch,
    };
    first.input.sendMessage(JSON.stringify({
      ...firstEnvelope,
      type: "key",
      code: "ControlLeft",
      state: "pressed",
      modifiers: { control: true, alt: false, shift: false, meta: false },
      sequence: 1,
    }));
    first.input.sendMessage(JSON.stringify({
      ...firstEnvelope,
      type: "pointer-button",
      button: "left",
      state: "pressed",
      x: 40,
      y: 50,
      sequence: 2,
    }));
    await runtime.waitForInputEvents(2);

    const second = await connectProjection(h, owner, "held-input-browser-two");
    peers.push(second.peer);
    const secondGranted = authority(second.input);
    const replacementStarted = Date.now();
    second.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      mode: "expanded",
    }));
    const secondGrant = await secondGranted;
    expect(runtime.releaseCount).toBe(1);
    expect(Date.now() - replacementStarted).toBeGreaterThanOrEqual(80);
    expect(secondGrant.controllerEpoch).toBeGreaterThan(firstGrant.controllerEpoch);

    try {
      first.input.sendMessage(JSON.stringify({
        ...firstEnvelope,
        type: "key",
        code: "KeyA",
        state: "pressed",
        modifiers: { control: true, alt: false, shift: false, meta: false },
        sequence: 3,
      }));
    } catch {
      // The replaced peer may already have closed its stale input channel.
    }
    second.input.sendMessage(JSON.stringify({
      ...firstEnvelope,
      controllerEpoch: firstGrant.controllerEpoch,
      type: "key",
      code: "KeyA",
      state: "pressed",
      modifiers: { control: false, alt: false, shift: false, meta: false },
      sequence: 1,
    }));
    await runtime.waitForReleases(2);
    expect(runtime.inputEvents).toHaveLength(2);
  }, 20_000);
  test("retains only redacted semantic input diagnostics and expires records after seven days", async () => {
    const runtime = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: runtime });
    const owner = await ownerFor(h, await makeBot(h, "Diagnosed keyboard screen"));
    const database = new Database(path.join(h.home, "db.sqlite"));
    database.query(
      `INSERT INTO input_diagnostics
       (surface_id, occurred_at, actor_kind, action_category, outcome, redacted_length, latency_ms)
       VALUES (?, ?, 'browser', 'paste', 'accepted', 99, 1)`,
    ).run(owner.surfaceId, new Date(Date.now() - 8 * 24 * 3600_000).toISOString());
    const projection = await connectProjection(h, owner, "diagnostic-browser");
    peers.push(projection.peer);
    const granted = authority(projection.input);
    projection.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      mode: "expanded",
    }));
    const grant = await granted;
    const envelope = {
      version: 1,
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: 1,
      controllerEpoch: grant.controllerEpoch,
    };
    projection.input.sendMessage(JSON.stringify({
      ...envelope,
      type: "key",
      code: "KeyX",
      state: "pressed",
      modifiers: { control: false, alt: false, shift: false, meta: false },
      sequence: 1,
    }));
    projection.input.sendMessage(JSON.stringify({
      ...envelope,
      type: "key",
      code: "KeyX",
      state: "released",
      modifiers: { control: false, alt: false, shift: false, meta: false },
      sequence: 2,
    }));
    projection.input.sendMessage(JSON.stringify({
      ...envelope,
      type: "paste",
      text: "never persist λ",
      sequence: 3,
    }));
    await runtime.waitForInputEvents(3);
    await Promise.resolve();
    await Promise.resolve();

    const rows = database.query<{
      surface_id: string;
      actor_kind: string;
      action_category: string;
      outcome: string;
      redacted_length: number | null;
      latency_ms: number;
    }, []>(
      `SELECT surface_id, actor_kind, action_category, outcome, redacted_length, latency_ms
       FROM input_diagnostics WHERE action_category IN ('key', 'paste') ORDER BY id`,
    ).all();
    expect(rows.map(({ latency_ms: _latency, ...row }) => row)).toEqual([
      {
        surface_id: owner.surfaceId,
        actor_kind: "browser",
        action_category: "key",
        outcome: "accepted",
        redacted_length: null,
      },
      {
        surface_id: owner.surfaceId,
        actor_kind: "browser",
        action_category: "key",
        outcome: "accepted",
        redacted_length: null,
      },
      {
        surface_id: owner.surfaceId,
        actor_kind: "browser",
        action_category: "paste",
        outcome: "accepted",
        redacted_length: 15,
      },
    ]);
    expect(rows.every(({ latency_ms }) => latency_ms >= 0)).toBeTrue();
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain("never persist");
    expect(stored).not.toContain("KeyX");
    expect(Object.keys(rows[0] ?? {})).not.toContain("controller_id");
    database.close();
  }, 15_000);

  test("fails closed on missing, stale, mismatched, duplicated, or out-of-order fields", async () => {

    const runtime = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: runtime });
    const owner = await ownerFor(h, await makeBot(h, "Validated pointer screen"));
    const other = await ownerFor(h, await makeBot(h, "Other pointer screen"));
    let releaseCount = 0;

    const grant = async (name: string): Promise<{ peer: PeerConnection; input: DataChannel; epoch: number }> => {
      const projection = await connectProjection(h, owner, name);
      peers.push(projection.peer);
      const granted = authority(projection.input);
      projection.control.sendMessage(JSON.stringify({
        version: 1,
        type: "view",
        surfaceId: owner.surfaceId,
        runtimeGeneration: 1,
        mode: "expanded",
      }));
      return {
        peer: projection.peer,
        input: projection.input,
        epoch: (await granted).controllerEpoch,
      };
    };
    const reject = async (
      name: string,
      change: (message: Record<string, unknown>, epoch: number) => void,
    ): Promise<void> => {
      const { peer, input, epoch } = await grant(name);
      const message: Record<string, unknown> = {
        version: 1,
        type: "pointer-motion",
        surfaceId: owner.surfaceId,
        runtimeGeneration: 1,
        geometryGeneration: 1,
        controllerEpoch: epoch,
        sequence: 1,
        x: 20,
        y: 30,
      };
      change(message, epoch);
      input.sendMessage(JSON.stringify(message));
      releaseCount += 1;
      await runtime.waitForReleases(releaseCount);
      peer.close();
    };

    await reject("wrong-surface-pointer", (message) => {
      message.surfaceId = other.surfaceId;
    });
    await reject("stale-runtime-pointer", (message) => {
      message.runtimeGeneration = 2;
    });
    await reject("stale-controller-pointer", (message, epoch) => {
      message.controllerEpoch = epoch + 1;
    });
    await reject("missing-geometry-pointer", (message) => {
      delete message.geometryGeneration;
    });
    await reject("out-of-order-pointer", (message) => {
      message.sequence = 2;
    });

    const duplicate = await grant("duplicate-pointer");
    duplicate.input.sendMessage(JSON.stringify({
      version: 1,
      type: "pointer-motion",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: 1,
      controllerEpoch: duplicate.epoch,
      sequence: 1,
      x: 40,
      y: 50,
    }));
    await runtime.waitForPointerEvents(1);
    duplicate.input.sendMessage(JSON.stringify({
      version: 1,
      type: "pointer-motion",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: 1,
      controllerEpoch: duplicate.epoch,
      sequence: 1,
      x: 60,
      y: 70,
    }));
    await runtime.waitForReleases(++releaseCount);
    duplicate.peer.close();
    expect(runtime.pointerEvents.map(({ event }) => event)).toMatchObject([{ type: "motion", x: 40, y: 50 }]);
  }, 35_000);
  test("revokes held input on browser suspension and helper failure before issuing a new epoch", async () => {
    const runtime = new FakeBotScreenRuntimeAdapter(undefined, { inputFailureAt: 2 });
    h = await startDaemon(undefined, { botScreenAdapter: runtime });
    const owner = await ownerFor(h, await makeBot(h, "Failure cleanup screen"));
    const projection = await connectProjection(h, owner, "cleanup-browser");
    peers.push(projection.peer);
    const firstGranted = authority(projection.input);
    projection.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      mode: "expanded",
    }));
    const firstGrant = await firstGranted;
    const envelope = {
      version: 1,
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: 1,
      controllerEpoch: firstGrant.controllerEpoch,
    };
    projection.input.sendMessage(JSON.stringify({
      ...envelope,
      type: "key",
      code: "ShiftLeft",
      state: "pressed",
      modifiers: { control: false, alt: false, shift: true, meta: false },
      sequence: 1,
    }));
    projection.input.sendMessage(JSON.stringify({
      ...envelope,
      type: "release-control",
      reason: "visibility-loss",
      sequence: 2,
    }));
    await runtime.waitForReleases(1);

    const secondGranted = authority(projection.input);
    projection.control.sendMessage(JSON.stringify({
      version: 1,
      type: "view",
      surfaceId: owner.surfaceId,
      runtimeGeneration: 1,
      mode: "expanded",
    }));
    const secondGrant = await secondGranted;
    expect(secondGrant.controllerEpoch).toBeGreaterThan(firstGrant.controllerEpoch);
    projection.input.sendMessage(JSON.stringify({
      ...envelope,
      controllerEpoch: secondGrant.controllerEpoch,
      type: "key",
      code: "KeyA",
      state: "pressed",
      modifiers: { control: false, alt: false, shift: false, meta: false },
      sequence: 1,
    }));
    await runtime.waitForReleases(2);
    expect(runtime.inputEvents.map(({ event }) => event)).toMatchObject([
      { type: "key", keyCode: 42, state: "pressed" },
    ]);
  }, 15_000);
});
