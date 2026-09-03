import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import rtc, { type DataChannel, type PeerConnection } from "node-datachannel";
import type { ComputerSurfaceOwner } from "../../apps/daemon/src/modules/computer/broker.ts";
import { api, makeBot, startDaemon, type Harness } from "./helpers/harness.ts";

const EXPECTED_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWMQMgn7D8IAC5MDN627upEAAAAASUVORK5CYII=";

interface ProjectionAnswer {
  type: "answer";
  sdp: string;
  sessionId: string;
  surfaceId: string;
  runtimeGeneration: number;
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
