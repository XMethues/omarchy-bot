import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import rtc, { type DataChannel, type PeerConnection } from "node-datachannel";
import type { ComputerSurfaceOwner } from "../../apps/daemon/src/modules/computer/broker.ts";
import { FakeBotScreenRuntimeAdapter } from "../../apps/daemon/src/modules/computer/fakeBotScreenRuntime.ts";
import { api, makeBot, startDaemon, type Harness } from "./helpers/harness.ts";

const EXPECTED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWMQMgn7D8IAC5MDN627upEAAAAASUVORK5CYII=";

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

async function ownerFor(h: Harness, botId: string): Promise<ComputerSurfaceOwner> {
  const bot = await api<{ id: string; surfaceId: string }>(h, "GET", `/api/bots/${botId}`);
  return { botId: bot.id, surfaceId: bot.surfaceId as ComputerSurfaceOwner["surfaceId"] };
}

function waitFor<T>(subscribe: (resolve: (value: T) => void, reject: (error: Error) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebRTC test timed out")), 5_000);
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
  const gathered = waitFor<void>((resolve) => {
    peer.onGatheringStateChange((state) => {
      if (state === "complete") resolve();
    });
  });
  const described = waitFor<void>((resolve) => peer.onLocalDescription(() => resolve()));
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

function openChannel(channel: DataChannel): Promise<DataChannel> {
  if (channel.isOpen()) return Promise.resolve(channel);
  return waitFor<DataChannel>((resolve, reject) => {
    channel.onOpen(() => resolve(channel));
    channel.onError((message) => reject(new Error(message)));
  });
}


async function connectProjection(
  h: Harness,
  owner: ComputerSurfaceOwner,
  name: string,
): Promise<{
  peer: PeerConnection;
  control: DataChannel;
  input: DataChannel;
  answer: ProjectionAnswer;
}> {
  const peer = new rtc.PeerConnection(name, { iceServers: [] });
  const gathered = waitFor<void>((resolve) => {
    peer.onGatheringStateChange((state) => {
      if (state === "complete") resolve();
    });
  });
  const described = waitFor<void>((resolve) => peer.onLocalDescription(() => resolve()));
  peer.createDataChannel("screen.frames.v1", { unordered: false });
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
  await Promise.all([openChannel(control), openChannel(input)]);
  return { peer, control, input, answer };
}

function authority(input: DataChannel): Promise<{
  surfaceId: string;
  runtimeGeneration: number;
  geometryGeneration: number;
  controllerEpoch: number;
}> {
  return waitFor((resolve) => {
    input.onMessage((raw) => {
      if (typeof raw !== "string") return;
      const message = JSON.parse(raw) as { type?: string };
      if (message.type === "pointer-authority") resolve(message as never);
    });
  });
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

    const gathered = waitFor<void>((resolve) => {
      peer!.onGatheringStateChange((state) => {
        if (state === "complete") resolve();
      });
    });
    const described = waitFor<void>((resolve) => peer!.onLocalDescription(() => resolve()));
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

    const messages: Array<string | Buffer | ArrayBuffer> = [];
    const receivedFrame = waitFor<void>((resolve) => {
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
});

describe("expanded pointer Web Control", () => {
  let h: Harness;
  const peers: PeerConnection[] = [];

  afterEach(async () => {
    for (const connectedPeer of peers) connectedPeer.close();
    await h.stop();
  });

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
    expect(motions.at(-2)).toEqual({ type: "motion", x: 80, y: 160 });
    expect(motions.at(-1)).toEqual({ type: "motion", x: 400, y: 300 });
    expect(firstBatch.filter((event) => event.type !== "motion")).toEqual([
      { type: "button", x: 80, y: 160, button: "left", state: "pressed" },
      { type: "button", x: 400, y: 300, button: "left", state: "released" },
      { type: "scroll", x: 400, y: 300, deltaX: -2, deltaY: 12 },
    ]);
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
    expect(runtime.pointerEvents.at(-1)?.event).toEqual({ type: "motion", x: 100, y: 120 });

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

  test("fails closed on missing, stale, mismatched, duplicated, or out-of-order fields", async () => {
    const runtime = new FakeBotScreenRuntimeAdapter();
    h = await startDaemon(undefined, { botScreenAdapter: runtime });
    const owner = await ownerFor(h, await makeBot(h, "Validated pointer screen"));
    const other = await ownerFor(h, await makeBot(h, "Other pointer screen"));
    let releaseCount = 0;

    const grant = async (name: string): Promise<{ input: DataChannel; epoch: number }> => {
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
      return { input: projection.input, epoch: (await granted).controllerEpoch };
    };
    const reject = async (
      name: string,
      change: (message: Record<string, unknown>, epoch: number) => void,
    ): Promise<void> => {
      const { input, epoch } = await grant(name);
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
    expect(runtime.pointerEvents.map(({ event }) => event)).toEqual([{ type: "motion", x: 40, y: 50 }]);
  }, 35_000);
});
