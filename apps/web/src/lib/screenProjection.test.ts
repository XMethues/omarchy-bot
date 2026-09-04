import { afterEach, describe, expect, test } from "bun:test";
import {
  SCREEN_CONTROL_CHANNEL,
  SCREEN_H264_CLOCK_RATE,
  SCREEN_H264_PROFILE,
  SCREEN_INPUT_CHANNEL,
  SCREEN_PREVIEW_CHANNEL,
  SCREEN_PROJECTION_PROTOCOL_VERSION,
} from "@omarchy-bot/protocol";
import { ScreenProjectionConnection } from "./screenProjection.ts";

class FakeDataChannel {
  readonly sent: string[] = [];
  readonly listeners = new Map<string, Array<(event: { data: unknown }) => void>>();
  binaryType = "blob";
  readyState = "open";
  bufferedAmount = 0;

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(message: string): void {
    this.sent.push(message);
  }

  emitMessage(data: unknown): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data });
  }

  close(): void {
    this.readyState = "closed";
  }
}

class FakePeerConnection {
  static latest: FakePeerConnection | undefined;
  readonly channels = new Map<string, FakeDataChannel>();
  readonly listeners = new Map<string, Array<(event: Record<string, unknown>) => void>>();
  iceGatheringState = "complete";
  localDescription: RTCSessionDescriptionInit | null = { type: "offer", sdp: "v=0\r\n" };
  connectionState = "connected";

  constructor() {
    FakePeerConnection.latest = this;
  }

  createDataChannel(label: string): FakeDataChannel {
    const channel = new FakeDataChannel();
    this.channels.set(label, channel);
    return channel;
  }

  addTransceiver(): { setCodecPreferences(): void } {
    return { setCodecPreferences() {} };
  }

  addEventListener(type: string, listener: (event: Record<string, unknown>) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(): void {}

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: "offer", sdp: "v=0\r\n" };
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description;
  }

  async setRemoteDescription(): Promise<void> {}
  async addIceCandidate(): Promise<void> {}

  emitTrack(): void {
    const track = { kind: "video", addEventListener() {} };
    for (const listener of this.listeners.get("track") ?? []) listener({ track, streams: [{}] });
  }

  async getStats(): Promise<Map<string, never>> {
    return new Map<string, never>();
  }

  close(): void {
    this.connectionState = "closed";
  }
}

const originalPeerConnection = globalThis.RTCPeerConnection;
const originalRtpReceiver = globalThis.RTCRtpReceiver;
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

afterEach(() => {
  Object.assign(globalThis, {
    RTCPeerConnection: originalPeerConnection,
    RTCRtpReceiver: originalRtpReceiver,
    fetch: originalFetch,
    window: originalWindow,
  });
  FakePeerConnection.latest = undefined;
});

describe("Screen Projection input authority", () => {
  test("keeps key sequencing across video frames that republish the same controller epoch", async () => {
    Object.assign(globalThis, {
      RTCPeerConnection: FakePeerConnection,
      RTCRtpReceiver: {
        getCapabilities: () => ({
          codecs: [{
            mimeType: "video/H264",
            clockRate: SCREEN_H264_CLOCK_RATE,
            sdpFmtpLine: `level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=${SCREEN_H264_PROFILE}`,
          }],
        }),
      },
      window: globalThis,
      fetch: async () => new Response(JSON.stringify({
        version: SCREEN_PROJECTION_PROTOCOL_VERSION,
        type: "answer",
        sdp: "v=0\r\n",
        sessionId: "projection-session",
        surfaceId: "surf_0123456789abcdef0123456789abcdef",
        runtimeGeneration: 1,
        geometryGeneration: 1,
        logicalWidth: 1920,
        logicalHeight: 1080,
        videoWidth: 1920,
        videoHeight: 1080,
        scale: 1,
        state: "connecting",
        capabilities: {
          previewImage: { transport: "data-channel", channel: SCREEN_PREVIEW_CHANNEL, mediaType: "image/png" },
          expandedVideo: { transport: "webrtc-video-track", codec: "video/H264", profileLevelId: SCREEN_H264_PROFILE, clockRate: SCREEN_H264_CLOCK_RATE },
          control: { transport: "data-channel", channel: SCREEN_CONTROL_CHANNEL },
          input: { transport: "data-channel", channel: SCREEN_INPUT_CHANNEL },
          snapshotFallback: { transport: "http", mediaType: "image/png" },
        },
        security: { authentication: "none", httpsRequired: false },
        candidates: [],
      }), { status: 200 }),
    });

    const controlStates: boolean[] = [];
    const connection = new ScreenProjectionConnection(
      "/api/computer/projection",
      { botId: "bot", surfaceId: "surf_0123456789abcdef0123456789abcdef" },
      {
        onState() {},
        onFrame() {},
        onVideo() {},
        onError() {},
        onControlStateChange: (active) => controlStates.push(active),
      },
    );
    await connection.connect();
    connection.setMode("expanded");

    const peer = FakePeerConnection.latest!;
    peer.emitTrack();
    const input = peer.channels.get(SCREEN_INPUT_CHANNEL)!;
    input.emitMessage(JSON.stringify({
      version: SCREEN_PROJECTION_PROTOCOL_VERSION,
      type: "input-authority",
      active: true,
      surfaceId: "surf_0123456789abcdef0123456789abcdef",
      runtimeGeneration: 1,
      geometryGeneration: 1,
      controllerEpoch: 7,
      logicalWidth: 1920,
      logicalHeight: 1080,
      videoWidth: 1920,
      videoHeight: 1080,
      scale: 1,
    }));

    expect(connection.videoFramePainted(1920, 1080)).toBe(true);
    expect(connection.keyTransition("KeyA", "pressed", { control: false, alt: false, shift: false, meta: false })).toBe(true);
    expect(connection.keyTransition("KeyA", "released", { control: false, alt: false, shift: false, meta: false })).toBe(true);

    expect(connection.videoFramePainted(1920, 1080)).toBe(true);
    expect(connection.keyTransition("KeyB", "pressed", { control: false, alt: false, shift: false, meta: false })).toBe(true);
    expect(connection.keyTransition("KeyB", "released", { control: false, alt: false, shift: false, meta: false })).toBe(true);

    const keyMessages = input.sent.map((message) => JSON.parse(message)).filter((message) => message.type === "key");
    expect(keyMessages.map((message) => [message.sequence, message.code, message.state])).toEqual([
      [1, "KeyA", "pressed"],
      [2, "KeyA", "released"],
      [3, "KeyB", "pressed"],
      [4, "KeyB", "released"],
    ]);
    expect(controlStates).toEqual([true]);
    connection.close();
  });
});
