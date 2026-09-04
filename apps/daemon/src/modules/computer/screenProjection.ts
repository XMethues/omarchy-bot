import { randomUUID } from "node:crypto";
import rtc, { type DataChannel, type PeerConnection, type RtpPacketizationConfig, type Track } from "node-datachannel";
import sharp from "sharp";
import type { SurfaceId } from "@omarchy-bot/domain";
import {
  SCREEN_CONTROL_CHANNEL,
  SCREEN_H264_CLOCK_RATE,
  SCREEN_H264_FMTP,
  SCREEN_H264_PROFILE,
  SCREEN_INPUT_CHANNEL,
  SCREEN_PREVIEW_CHANNEL,
  SCREEN_PROJECTION_PROTOCOL_VERSION,
  ScreenInputMessageDto,
  type ScreenInputAuthorityMessageDto,
  ScreenProjectionControlMessageDto,
  type ScreenProjectionAnswerDto,
  type ScreenProjectionModeDto,
  type ScreenProjectionOfferDto,
} from "@omarchy-bot/protocol";
import type { ComputerSurfaceOwner } from "./broker.ts";
import type {
  BotScreenManager,
  BotScreenInputEvent,
  BotScreenCaptureStream,
  BotScreenProjectionSource,
} from "./botScreenManager.ts";
import { InputDiagnostics, type InputDiagnosticCategory } from "./inputDiagnostics.ts";
import {
  h264Timestamp,
  parseH264ReceiveOffer,
  startH264Encoder,
  type H264EncoderProcess,
} from "./h264Encoder.ts";

const PREVIEW_INTERVAL_MS = 1_000;
const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
const MAX_FRAME_BYTES = MAX_BUFFERED_BYTES;
const CHUNK_BYTES = 48 * 1024;
const SIGNALING_TIMEOUT_MS = 5_000;

export type ProjectionViewMode = ScreenProjectionModeDto;
export type ProjectionLifecycleState = "connecting" | ProjectionViewMode | "closed" | "failed";

export interface ProjectionStatus {
  sessionId: string;
  surfaceId: SurfaceId;
  runtimeGeneration: number;
  state: ProjectionLifecycleState;
  mode: ProjectionViewMode;
  framesSent: number;
}

export interface ProjectionLoadMetrics {
  readonly sessionId: string;
  readonly surfaceId: SurfaceId;
  readonly sequence: number;
  readonly captureAttempts: number;
  readonly sourceFrames: number;
  readonly encodedFrames: number;
  readonly framesSent: number;
  readonly preCaptureBackpressureSkips: number;
  readonly encodedBackpressureDrops: number;
  readonly transportUnavailableSkips: number;
  readonly invalidFrameDrops: number;
  readonly sendFailures: number;
}

export interface ProjectionFailureDiagnostic {
  readonly error: string;
  readonly metrics: Readonly<ProjectionLoadMetrics>;
}


interface ProjectionSession {
  id: string;
  owner: ComputerSurfaceOwner;
  source: BotScreenProjectionSource;
  peer: PeerConnection;
  state: ProjectionLifecycleState;
  peerClosed: Promise<void>;
  resolvePeerClosed(): void;
  mode: ProjectionViewMode;
  preview?: DataChannel;
  control?: DataChannel;
  input?: DataChannel;
  videoTrack: Track;
  rtpConfig: RtpPacketizationConfig;
  encoder?: H264EncoderProcess | undefined;
  videoSequence: number;
  sequence: number;
  timer?: Timer | undefined;
  captureStream?: BotScreenCaptureStream | undefined;
  captureTask?: Promise<void> | undefined;
  captureCleanups: Set<Promise<void>>;
  nextFrameAt?: number | undefined;
  captureAttempts: number;
  sourceFrames: number;
  encodedFrames: number;
  framesSent: number;
  preCaptureBackpressureSkips: number;
  encodedBackpressureDrops: number;
  transportUnavailableSkips: number;
  invalidFrameDrops: number;
  sendFailures: number;
  captureInFlight: boolean;
  inputSuspended: boolean;
}

interface InputController {
  session: ProjectionSession;
  epoch: number;
  nextSequence: number;
  queue: Array<{
    event: BotScreenInputEvent;
    receivedAt: number;
    category?: InputDiagnosticCategory;
    redactedLength?: number;
  }>;
  draining: boolean;
  revoked: boolean;
  active: boolean;
  provisioned: boolean;
  announced: boolean;
  heldCodes: Set<string>;
  heldButtons: Set<"left" | "middle" | "right">;
  release: Promise<void>;
}

const KEY_CODES: Record<string, number> = {
  Escape: 1,
  Digit1: 2, Digit2: 3, Digit3: 4, Digit4: 5, Digit5: 6, Digit6: 7, Digit7: 8, Digit8: 9, Digit9: 10, Digit0: 11,
  Minus: 12, Equal: 13, Backspace: 14, Tab: 15,
  KeyQ: 16, KeyW: 17, KeyE: 18, KeyR: 19, KeyT: 20, KeyY: 21, KeyU: 22, KeyI: 23, KeyO: 24, KeyP: 25,
  BracketLeft: 26, BracketRight: 27, Enter: 28, ControlLeft: 29,
  KeyA: 30, KeyS: 31, KeyD: 32, KeyF: 33, KeyG: 34, KeyH: 35, KeyJ: 36, KeyK: 37, KeyL: 38,
  Semicolon: 39, Quote: 40, Backquote: 41, ShiftLeft: 42, Backslash: 43,
  KeyZ: 44, KeyX: 45, KeyC: 46, KeyV: 47, KeyB: 48, KeyN: 49, KeyM: 50,
  Comma: 51, Period: 52, Slash: 53, ShiftRight: 54, NumpadMultiply: 55, AltLeft: 56, Space: 57, CapsLock: 58,
  F1: 59, F2: 60, F3: 61, F4: 62, F5: 63, F6: 64, F7: 65, F8: 66, F9: 67, F10: 68,
  NumLock: 69, ScrollLock: 70, Numpad7: 71, Numpad8: 72, Numpad9: 73, NumpadSubtract: 74,
  Numpad4: 75, Numpad5: 76, Numpad6: 77, NumpadAdd: 78, Numpad1: 79, Numpad2: 80, Numpad3: 81,
  Numpad0: 82, NumpadDecimal: 83, F11: 87, F12: 88, NumpadEnter: 96, ControlRight: 97,
  NumpadDivide: 98, PrintScreen: 99, AltRight: 100, Home: 102, ArrowUp: 103, PageUp: 104,
  ArrowLeft: 105, ArrowRight: 106, End: 107, ArrowDown: 108, PageDown: 109, Insert: 110, Delete: 111,
  Pause: 119, MetaLeft: 125, MetaRight: 126, ContextMenu: 127,
};


interface Deadline<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: Error): void;
  cancel(): void;
}

function deadline<T>(message: string): Deadline<T> {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  let timer: Timer | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const reject = (error: Error): void => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    rejectPromise(error);
  };
  timer = setTimeout(() => reject(new Error(message)), SIGNALING_TIMEOUT_MS);
  timer.unref?.();
  return {
    promise,
    resolve: (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(value);
    },
    reject,
    cancel: () => reject(new Error("WebRTC signaling was cancelled")),
  };
}

/**
 * Owns WebRTC peers, capture pumps, and validated Web Controllers. HTTP
 * routes exchange SDP while runtime handles, geometry, authority, ordering,
 * protocol framing, motion coalescing, release barriers, and backpressure stay here.
 */
export class ScreenProjectionService {
  #sessions = new Map<string, ProjectionSession>();
  #failures = new Map<string, {
    botId: string;
    surfaceId: SurfaceId;
    diagnostic: ProjectionFailureDiagnostic;
  }>();
  #terminalCleanups = new Set<Promise<void>>();
  #terminations = new Map<string, {
    botId: string;
    surfaceId: SurfaceId;
    promise: Promise<void>;
  }>();
  #controllers = new Map<SurfaceId, InputController>();
  #controllerEpochs = new Map<SurfaceId, number>();
  #releaseBarriers = new Map<SurfaceId, Promise<void>>();
  #unsubscribeScreens: () => void;
  constructor(
    private readonly screens: BotScreenManager,
    private readonly diagnostics: InputDiagnostics,
    private readonly canAcceptWebControl: (owner: ComputerSurfaceOwner) => boolean,
    private readonly webControlClaimed: (owner: ComputerSurfaceOwner) => void,
    private readonly webControlReleased: (owner: ComputerSurfaceOwner) => void,
    private readonly expandedFrameRate = 15,
    private readonly webRtcPort = 0,
  ) {
    if (!Number.isSafeInteger(webRtcPort) || webRtcPort < 0 || webRtcPort > 65_535) {
      throw new Error("Screen Projection WebRTC port must be an integer from 0 to 65535");
    }
    if (!Number.isSafeInteger(expandedFrameRate) || expandedFrameRate < 1) {
      throw new Error("expanded Screen Projection frame rate must be a positive integer");
    }
    this.#unsubscribeScreens = screens.subscribe((transition) => {
      if (transition.state === "failed" || transition.state === "stopped") {
        this.closeSurface(transition.surfaceId);
      }
    });
  }

  async answer(owner: ComputerSurfaceOwner, offer: ScreenProjectionOfferDto): Promise<ScreenProjectionAnswerDto> {
    if (offer.type !== "offer" || offer.sdp.trim() === "") throw new Error("a WebRTC SDP offer is required");
    const codec = parseH264ReceiveOffer(offer.sdp);
    const source = await this.screens.projectionSource(owner);
    if (source === undefined) throw new Error("Bot Screen is unavailable");

    const id = randomUUID();
    const peer = new rtc.PeerConnection(`screen-projection-${id}`, {
      iceServers: [],
      disableAutoNegotiation: true,
      maxMessageSize: MAX_FRAME_BYTES,
      enableIceUdpMux: true,
      ...(this.webRtcPort === 0
        ? {}
        : { portRangeBegin: this.webRtcPort, portRangeEnd: this.webRtcPort }),
    });
    const video = new rtc.Video(codec.mid, "SendOnly");
    video.addH264Codec(codec.payloadType, SCREEN_H264_FMTP);
    video.setBitrate(6_000);
    const rtpConfig = new rtc.RtpPacketizationConfig(
      Number.parseInt(id.replaceAll("-", "").slice(0, 8), 16),
      "screen-projection",
      codec.payloadType,
      SCREEN_H264_CLOCK_RATE,
    );
    const videoTrack = peer.addTrack(video);
    videoTrack.setMediaHandler(new rtc.H264RtpPacketizer("StartSequence", rtpConfig));
    const peerClosed = Promise.withResolvers<void>();
    const session: ProjectionSession = {
      id,
      owner,
      source,
      peer,
      state: "connecting",
      peerClosed: peerClosed.promise,
      resolvePeerClosed: peerClosed.resolve,
      videoTrack,
      rtpConfig,
      mode: "idle",
      sequence: 0,
      videoSequence: 0,
      inputSuspended: false,
      captureCleanups: new Set(),
      captureInFlight: false,
      captureAttempts: 0,
      sourceFrames: 0,
      encodedFrames: 0,
      framesSent: 0,
      preCaptureBackpressureSkips: 0,
      encodedBackpressureDrops: 0,
      transportUnavailableSkips: 0,
      invalidFrameDrops: 0,
      sendFailures: 0,
    };
    this.#sessions.set(id, session);
    this.#terminalCleanups.add(session.peerClosed);
    void session.peerClosed.finally(() => this.#terminalCleanups.delete(session.peerClosed));

    const localDescription = deadline<{ sdp: string; type: string }>("WebRTC answer creation timed out");
    const gathering = deadline<void>("WebRTC ICE gathering timed out");
    const candidates: Array<{ candidate: string; sdpMid: string }> = [];
    peer.onLocalDescription((sdp, type) => localDescription.resolve({ sdp, type }));
    peer.onLocalCandidate((candidate, sdpMid) => candidates.push({ candidate, sdpMid }));
    peer.onGatheringStateChange((state) => {
      if (state === "complete") gathering.resolve();
    });
    peer.onDataChannel((channel) => this.#acceptChannel(session, channel));
    peer.onStateChange((state) => {
      if (state === "closed") session.resolvePeerClosed();
      if (state === "closed" || state === "disconnected" || state === "failed") {
        this.#close(session, state === "failed");
      }
    });
    videoTrack.onOpen(() => {
      if (session.mode === "expanded") this.#startVideo(session);
    });
    videoTrack.onClosed(() => this.#close(session, false));
    videoTrack.onError(() => this.#close(session, true));

    try {
      peer.setRemoteDescription(offer.sdp, "offer");
      peer.setLocalDescription("answer");
      const description = await localDescription.promise;
      await gathering.promise;
      const finalDescription = peer.localDescription();
      return {
        version: SCREEN_PROJECTION_PROTOCOL_VERSION,
        type: "answer",
        sdp: finalDescription?.sdp ?? description.sdp,
        sessionId: id,
        surfaceId: source.surfaceId,
        runtimeGeneration: source.runtimeGeneration,
        geometryGeneration: source.geometryGeneration,
        logicalWidth: source.logicalWidth,
        logicalHeight: source.logicalHeight,
        videoWidth: source.videoWidth,
        videoHeight: source.videoHeight,
        scale: source.scale,
        state: "connecting",
        capabilities: {
          previewImage: {
            transport: "data-channel",
            channel: SCREEN_PREVIEW_CHANNEL,
            mediaType: "image/png",
          },
          expandedVideo: {
            transport: "webrtc-video-track",
            codec: "video/H264",
            profileLevelId: SCREEN_H264_PROFILE,
            clockRate: SCREEN_H264_CLOCK_RATE,
          },
          control: { transport: "data-channel", channel: SCREEN_CONTROL_CHANNEL },
          input: { transport: "data-channel", channel: SCREEN_INPUT_CHANNEL },
          snapshotFallback: { transport: "http", mediaType: "image/png" },
        },
        security: { authentication: "none", httpsRequired: false },
        candidates,
      };
    } catch (error) {
      this.#close(session, true);
      throw error;
    } finally {
      localDescription.cancel();
      gathering.cancel();
      await Promise.allSettled([localDescription.promise, gathering.promise]);
    }
  }

  status(owner: ComputerSurfaceOwner, sessionId: string): ProjectionStatus | undefined {
    const session = this.#sessions.get(sessionId);
    if (session === undefined || session.owner.botId !== owner.botId || session.owner.surfaceId !== owner.surfaceId) {
      return undefined;
    }
    return {
      sessionId,
      surfaceId: session.source.surfaceId,
      runtimeGeneration: session.source.runtimeGeneration,
      state: session.state,
      mode: session.mode,
      framesSent: session.framesSent,
    };
  }

  /**
   * Internal diagnostic snapshot for load/conformance harnesses. This is not
   * exposed by the HTTP projection status contract.
   */
  loadMetrics(owner: ComputerSurfaceOwner, sessionId: string): Readonly<ProjectionLoadMetrics> | undefined {
    const session = this.#sessions.get(sessionId);
    if (session === undefined || session.owner.botId !== owner.botId || session.owner.surfaceId !== owner.surfaceId) {
      return undefined;
    }
    return Object.freeze({
      sessionId,
      surfaceId: session.source.surfaceId,
      sequence: session.sequence,
      captureAttempts: session.captureAttempts,
      sourceFrames: session.sourceFrames,
      encodedFrames: session.encodedFrames,
      framesSent: session.framesSent,
      preCaptureBackpressureSkips: session.preCaptureBackpressureSkips,
      encodedBackpressureDrops: session.encodedBackpressureDrops,
      transportUnavailableSkips: session.transportUnavailableSkips,
      invalidFrameDrops: session.invalidFrameDrops,
      sendFailures: session.sendFailures,
    });
  }

  /** Internal terminal failure snapshot for focused integration diagnostics. */
  failureDiagnostic(owner: ComputerSurfaceOwner, sessionId: string): ProjectionFailureDiagnostic | undefined {
    const failure = this.#failures.get(sessionId);
    if (failure === undefined || failure.botId !== owner.botId || failure.surfaceId !== owner.surfaceId) return undefined;
    return failure.diagnostic;
  }

  async close(owner: ComputerSurfaceOwner, sessionId: string): Promise<boolean> {
    const session = this.#sessions.get(sessionId);
    if (session === undefined || session.owner.botId !== owner.botId || session.owner.surfaceId !== owner.surfaceId) {
      const termination = this.#terminations.get(sessionId);
      if (termination !== undefined && termination.botId === owner.botId && termination.surfaceId === owner.surfaceId) {
        await termination.promise;
      }
      return false;
    }
    this.#close(session, false);
    const termination = this.#terminations.get(sessionId);
    if (termination !== undefined) await termination.promise;
    return true;
  }

  closeSurface(surfaceId: SurfaceId): void {
    for (const session of this.#sessions.values()) {
      if (session.owner.surfaceId === surfaceId) this.#close(session, false);
    }
  }

  async revokeControl(surfaceId: SurfaceId): Promise<void> {
    for (const session of this.#sessions.values()) {
      if (session.source.surfaceId === surfaceId) session.inputSuspended = true;
    }
    const controller = this.#controllers.get(surfaceId);
    if (controller !== undefined) await this.#revokeInput(controller);
  }

  async restoreControl(surfaceId: SurfaceId): Promise<void> {
    const session = [...this.#sessions.values()].find((candidate) =>
      candidate.source.surfaceId === surfaceId
      && candidate.mode === "expanded"
      && candidate.input?.isOpen() === true
    );
    if (session === undefined) throw new Error("Web Control session is unavailable");
    session.inputSuspended = false;
    if (!await this.#claimInput(session, true)) {
      session.inputSuspended = true;
      throw new Error("Web Control could not be restored");
    }
  }

  async shutdown(): Promise<void> {
    this.#unsubscribeScreens();
    const sessions = [...this.#sessions.values()];
    for (const session of sessions) this.#close(session, false);
    await Promise.allSettled([
      ...sessions.flatMap((session) => [
        ...(session.captureTask === undefined ? [] : [session.captureTask]),
        ...session.captureCleanups,
        session.peerClosed,
      ]),
      ...this.#terminalCleanups,
    ]);
    await Promise.allSettled(this.#releaseBarriers.values());
    this.diagnostics.shutdown();
  }

  #acceptChannel(session: ProjectionSession, channel: DataChannel): void {
    if (session.preview === channel || session.control === channel || session.input === channel) return;
    const label = channel.getLabel();
    if (label === SCREEN_PREVIEW_CHANNEL) session.preview = channel;
    else if (label === SCREEN_CONTROL_CHANNEL) {
      session.control = channel;
      channel.onMessage((raw) => this.#control(session, raw));
    } else if (label === SCREEN_INPUT_CHANNEL) {
      session.input = channel;
      channel.onMessage((raw) => this.#input(session, raw));
    } else {
      channel.close();
      return;
    }
    channel.onOpen(() => {
      if (this.#sessions.get(session.id) !== session) return;
      if (session.state === "connecting") session.state = "idle";
      if (label === SCREEN_INPUT_CHANNEL && session.mode === "expanded") {
        void this.#claimInput(session).catch(() => {});
      }
    });
    channel.onClosed(() => this.#close(session, false));
    channel.onError(() => this.#close(session, true));
  }

  #control(session: ProjectionSession, raw: string | Buffer | ArrayBuffer): void {
    if (typeof raw !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const message = ScreenProjectionControlMessageDto.safeParse(parsed);
    if (
      !message.success
      || this.#sessions.get(session.id) !== session
      || message.data.surfaceId !== session.source.surfaceId
      || message.data.runtimeGeneration !== session.source.runtimeGeneration
    ) return;
    this.#setMode(session, message.data.mode);
  }

  #setMode(session: ProjectionSession, mode: ProjectionViewMode): void {
    if (session.timer !== undefined) clearTimeout(session.timer);
    session.timer = undefined;
    if (session.mode === "expanded" && mode !== "expanded") this.#revokeInputFor(session);
    const changed = session.mode !== mode;
    if (changed) {
      this.#stopCaptureStream(session);
      this.#stopEncoder(session);
    }
    session.inputSuspended = false;
    session.mode = mode;
    session.nextFrameAt = mode === "idle" ? undefined : performance.now();
    session.state = mode;
    if (mode === "expanded") {
      this.#startVideo(session);
      if (changed || !this.#isInputController(session)) void this.#claimInput(session).catch(() => {});
    } else if (mode === "preview") {
      this.#schedule(session, 0);
    }
  }

  #startVideo(session: ProjectionSession): void {
    if (
      session.mode !== "expanded"
      || session.encoder !== undefined
      || !session.videoTrack.isOpen()
      || this.#sessions.get(session.id) !== session
    ) return;
    let encoder!: H264EncoderProcess;
    try {
      encoder = startH264Encoder({
        width: session.source.videoWidth,
        height: session.source.videoHeight,
        frameRate: this.expandedFrameRate,
        onAccessUnit: (unit) => {
          if (
            session.encoder !== encoder
            || session.mode !== "expanded"
            || this.#sessions.get(session.id) !== session
          ) return;
          session.encodedFrames += 1;
          if (!session.videoTrack.isOpen()) {
            session.transportUnavailableSkips += 1;
            return;
          }
          session.rtpConfig.timestamp = h264Timestamp(session.videoSequence, this.expandedFrameRate);
          session.videoSequence += 1;
          if (session.videoTrack.sendMessageBinary(unit.bytes)) {
            session.sequence += 1;
            session.framesSent += 1;
          } else {
            session.sendFailures += 1;
          }
        },
      });
    } catch (error) {
      this.#recordFailure(session, error);
      this.#close(session, true);
      return;
    }
    session.encoder = encoder;
    void encoder.done.then(
      () => {
        if (session.encoder !== encoder) return;
        this.#recordFailure(session, new Error("H.264 encoder exited unexpectedly"));
        this.#close(session, true);
      },
      (error) => {
        if (session.encoder !== encoder) return;
        this.#recordFailure(session, error);
        this.#close(session, true);
      },
    );
    this.#schedule(session, 0);
  }

  #schedule(session: ProjectionSession, delay: number): void {
    if (session.timer !== undefined || session.mode === "idle" || this.#sessions.get(session.id) !== session) return;
    session.timer = setTimeout(() => {
      session.timer = undefined;
      const captureTask = this.#projectFrame(session);
      session.captureTask = captureTask;
      void captureTask.finally(() => {
        if (session.captureTask === captureTask) session.captureTask = undefined;
      });
    }, delay);
    session.timer.unref?.();
  }

  async #projectFrame(session: ProjectionSession): Promise<void> {
    const mode = session.mode;
    if (session.captureInFlight || mode === "idle" || this.#captureStopped(session, mode)) return;
    const preview = session.preview;
    const encoder = session.encoder;
    if (
      (mode === "preview" && (preview === undefined || !preview.isOpen()))
      || (mode === "expanded" && (encoder === undefined || !session.videoTrack.isOpen()))
    ) {
      session.transportUnavailableSkips += 1;
      this.#scheduleNext(session);
      return;
    }
    if (mode === "preview" && preview!.bufferedAmount() > 0) {
      session.preCaptureBackpressureSkips += 1;
      this.#scheduleNext(session);
      return;
    }

    session.captureInFlight = true;
    session.captureAttempts += 1;
    try {
      let captureStream = session.captureStream;
      if (captureStream === undefined) {
        await Promise.allSettled(session.captureCleanups);
        if (this.#captureStopped(session, mode)) return;
        captureStream = await session.source.openCaptureStream();
      }
      if (this.#captureStopped(session, mode)) {
        await captureStream.close().catch(() => {});
        return;
      }
      session.captureStream = captureStream;
      const frame = await captureStream.next();
      if (session.captureStream !== captureStream || this.#captureStopped(session, mode)) return;
      session.sourceFrames += 1;
      const expectedByteLength = session.source.videoWidth * session.source.videoHeight * 4;
      if (
        frame.pixelFormat !== "rgba"
        || frame.width !== session.source.videoWidth
        || frame.height !== session.source.videoHeight
        || frame.bytes.byteLength !== expectedByteLength
      ) {
        session.invalidFrameDrops += 1;
        return;
      }
      if (mode === "expanded") {
        await encoder!.writeFrame(frame.bytes);
        return;
      }
      const encoded = await sharp(frame.bytes, {
        raw: { width: frame.width, height: frame.height, channels: 4 },
        failOn: "error",
        limitInputPixels: frame.width * frame.height,
      }).png().toBuffer();
      const bytes = new Uint8Array(encoded.buffer, encoded.byteOffset, encoded.byteLength);
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_FRAME_BYTES) {
        session.invalidFrameDrops += 1;
        return;
      }
      const byteLength = bytes.byteLength;
      if (preview!.bufferedAmount() + byteLength > MAX_BUFFERED_BYTES) {
        session.encodedBackpressureDrops += 1;
        return;
      }
      const chunkCount = Math.ceil(byteLength / CHUNK_BYTES);
      const header = JSON.stringify({
        version: SCREEN_PROJECTION_PROTOCOL_VERSION,
        type: "preview-frame",
        surfaceId: session.source.surfaceId,
        runtimeGeneration: session.source.runtimeGeneration,
        geometryGeneration: session.source.geometryGeneration,
        logicalWidth: session.source.logicalWidth,
        logicalHeight: session.source.logicalHeight,
        videoWidth: session.source.videoWidth,
        videoHeight: session.source.videoHeight,
        scale: session.source.scale,
        sequence: ++session.sequence,
        mediaType: "image/png" as const,
        capturedAt: frame.capturedAt.toISOString(),
        byteLength,
        chunkCount,
      });
      if (!preview!.sendMessage(header)) {
        session.sendFailures += 1;
        return;
      }
      for (let offset = 0; offset < byteLength; offset += CHUNK_BYTES) {
        if (!preview!.sendMessageBinary(bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, byteLength)))) {
          session.sendFailures += 1;
          return;
        }
      }
      session.framesSent += 1;
    } catch (error) {
      this.#recordFailure(session, error);
      this.#close(session, true);
      return;
    } finally {
      session.captureInFlight = false;
      this.#scheduleNext(session);
    }
  }

  #scheduleNext(session: ProjectionSession): void {
    const now = performance.now();
    const interval = session.mode === "expanded" ? 1_000 / this.expandedFrameRate : PREVIEW_INTERVAL_MS;
    session.nextFrameAt = Math.max((session.nextFrameAt ?? now) + interval, now);
    this.#schedule(session, session.nextFrameAt - now);
  }


  #input(session: ProjectionSession, raw: string | Buffer | ArrayBuffer): void {
    const controller = this.#controllers.get(session.source.surfaceId);
    if (
      controller?.session !== session
      || controller.revoked
      || !controller.active
      || session.mode !== "expanded"
      || typeof raw !== "string"
    ) {
      this.#rejectInput(session);
      return;
    }
    if (!this.canAcceptWebControl(session.owner)) {
      void this.#revokeInput(controller).catch(() => this.#close(session, true));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.#rejectInput(session);
      return;
    }
    const message = ScreenInputMessageDto.safeParse(parsed);
    if (
      !message.success
      || message.data.surfaceId !== session.source.surfaceId
      || message.data.runtimeGeneration !== session.source.runtimeGeneration
      || message.data.geometryGeneration !== session.source.geometryGeneration
      || message.data.controllerEpoch !== controller.epoch
      || message.data.sequence !== controller.nextSequence
      || (
        (message.data.type === "pointer-motion"
          || message.data.type === "pointer-button"
          || message.data.type === "pointer-scroll")
        && (message.data.x >= session.source.logicalWidth || message.data.y >= session.source.logicalHeight)
      )
      || (message.data.type === "pointer-scroll" && message.data.deltaX === 0 && message.data.deltaY === 0)
      || (
        message.data.type === "paste"
        && (
          message.data.text.includes("\0")
          || new TextEncoder().encode(message.data.text).byteLength > 65_536
        )
      )
    ) {
      this.#rejectInput(session);
      return;
    }
    const { surfaceId, runtimeGeneration, geometryGeneration, controllerEpoch, sequence } = message.data;
    if (message.data.type === "release-control") {
      controller.nextSequence += 1;
      this.#revokeInput(controller);
      return;
    }

    let event: BotScreenInputEvent;
    if (message.data.type === "pointer-motion") {
      event = {
        surfaceId,
        runtimeGeneration,
        geometryGeneration,
        controllerEpoch,
        sequence,
        type: "motion",
        x: message.data.x,
        y: message.data.y,
      };
    } else if (message.data.type === "pointer-button") {
      if (message.data.state === "pressed") {
        if (controller.heldButtons.has(message.data.button)) {
          this.#rejectInput(session);
          return;
        }
        controller.heldButtons.add(message.data.button);
      } else if (!controller.heldButtons.delete(message.data.button)) {
        this.#rejectInput(session);
        return;
      }
      event = {
        surfaceId,
        runtimeGeneration,
        geometryGeneration,
        controllerEpoch,
        sequence,
        type: "button",
        x: message.data.x,
        y: message.data.y,
        button: message.data.button,
        state: message.data.state,
      };
    } else if (message.data.type === "pointer-scroll") {
      event = {
        surfaceId,
        runtimeGeneration,
        geometryGeneration,
        controllerEpoch,
        sequence,
        type: "scroll",
        x: message.data.x,
        y: message.data.y,
        deltaX: message.data.deltaX,
        deltaY: message.data.deltaY,
      };
    } else if (message.data.type === "paste") {
      event = {
        surfaceId,
        runtimeGeneration,
        geometryGeneration,
        controllerEpoch,
        sequence,
        type: "paste",
        text: message.data.text,
      };
    } else {
      const heldCodes = new Set(controller.heldCodes);
      if (message.data.state === "pressed") {
        if (heldCodes.has(message.data.code)) {
          this.#rejectInput(session);
          return;
        }
        heldCodes.add(message.data.code);
      } else {
        if (!heldCodes.delete(message.data.code)) {
          this.#rejectInput(session);
          return;
        }
      }
      const actualModifiers = {
        control: heldCodes.has("ControlLeft") || heldCodes.has("ControlRight"),
        alt: heldCodes.has("AltLeft") || heldCodes.has("AltRight"),
        shift: heldCodes.has("ShiftLeft") || heldCodes.has("ShiftRight"),
        meta: heldCodes.has("MetaLeft") || heldCodes.has("MetaRight"),
      };
      if (
        actualModifiers.control !== message.data.modifiers.control
        || actualModifiers.alt !== message.data.modifiers.alt
        || actualModifiers.shift !== message.data.modifiers.shift
        || actualModifiers.meta !== message.data.modifiers.meta
      ) {
        this.#rejectInput(session);
        return;
      }
      controller.heldCodes = heldCodes;
      event = {
        surfaceId,
        runtimeGeneration,
        geometryGeneration,
        controllerEpoch,
        sequence,
        type: "key",
        keyCode: KEY_CODES[message.data.code]!,
        state: message.data.state,
      };
    }
    controller.nextSequence += 1;
    const category: InputDiagnosticCategory | undefined = message.data.type === "pointer-button"
      ? "pointer-button"
      : message.data.type === "pointer-scroll"
        ? "pointer-scroll"
        : message.data.type === "paste"
          ? "paste"
          : message.data.type === "key"
            ? (
                message.data.state === "pressed"
                && (message.data.modifiers.control || message.data.modifiers.alt || message.data.modifiers.meta)
                  ? "shortcut"
                  : "key"
              )
            : undefined;
    const queued = {
      event,
      receivedAt: Date.now(),
      ...(category === undefined ? {} : { category }),
      ...(message.data.type === "paste" ? { redactedLength: Array.from(message.data.text).length } : {}),
    };
    if (queued.category !== undefined) {
      this.#recordDiagnostic(
        session.source.surfaceId,
        queued.category,
        "accepted",
        0,
        queued.redactedLength,
      );
    }
    const last = controller.queue.at(-1);
    if (event.type === "motion" && last?.event.type === "motion") controller.queue[controller.queue.length - 1] = queued;
    else controller.queue.push(queued);
    if (!controller.draining) {
      controller.draining = true;
      queueMicrotask(() => void this.#drainInput(controller));
    }
  }

  async #drainInput(controller: InputController): Promise<void> {
    try {
      while (
        !controller.revoked
        && controller.active
        && this.#controllers.get(controller.session.source.surfaceId) === controller
      ) {
        const queued = controller.queue.shift();
        if (queued === undefined) return;
        try {
          await controller.session.source.input(queued.event);
        } catch {
          if (queued.category !== undefined) {
            this.#recordDiagnostic(
              controller.session.source.surfaceId,
              queued.category,
              "failed",
              Date.now() - queued.receivedAt,
              queued.redactedLength,
            );
          }
          this.#close(controller.session, true);
          return;
        }
      }
    } finally {
      controller.draining = false;
      if (!controller.revoked && controller.active && controller.queue.length > 0) {
        controller.draining = true;
        queueMicrotask(() => void this.#drainInput(controller));
      }
    }
  }

  async #claimInput(session: ProjectionSession, force = false): Promise<boolean> {
    if (
      this.#sessions.get(session.id) !== session
      || session.mode !== "expanded"
      || session.input === undefined
      || !session.input.isOpen()
      || (!force && !this.canAcceptWebControl(session.owner))
      || this.#isInputController(session)
      || session.inputSuspended
    ) return false;
    const surfaceId = session.source.surfaceId;
    const previous = this.#controllers.get(surfaceId);
    if (previous !== undefined && previous.session !== session) this.#close(previous.session, false);
    const epoch = (this.#controllerEpochs.get(surfaceId) ?? 0) + 1;
    this.#controllerEpochs.set(surfaceId, epoch);
    const controller: InputController = {
      session,
      epoch,
      nextSequence: 1,
      queue: [],
      draining: false,
      revoked: false,
      active: false,
      provisioned: false,
      announced: false,
      heldCodes: new Set(),
      heldButtons: new Set(),
      release: Promise.resolve(),
    };
    this.#controllers.set(surfaceId, controller);
    const barrier = this.#releaseBarriers.get(surfaceId) ?? Promise.resolve();
    let activationFailed = false;
    controller.release = barrier.then(async () => {
      if (
        controller.revoked
        || this.#controllers.get(surfaceId) !== controller
        || this.#sessions.get(session.id) !== session
        || session.mode !== "expanded"
      ) return;
      await session.source.setInputAuthority(epoch);
      controller.provisioned = true;
      if (
        controller.revoked
        || this.#controllers.get(surfaceId) !== controller
        || this.#sessions.get(session.id) !== session
        || session.mode !== "expanded"
        || (!force && !this.canAcceptWebControl(session.owner))
      ) {
        return;
      }
      controller.active = true;
      this.webControlClaimed(session.owner);
      controller.announced = true;
      this.#sendInputAuthority(controller, true);
      this.#recordDiagnostic(surfaceId, "controller", "accepted", 0);
    }).catch(() => {
      activationFailed = true;
    });
    await controller.release;
    if (activationFailed) {
      this.#close(session, true);
      return false;
    }
    if (!controller.active && controller.provisioned && !controller.revoked) {
      await this.#revokeInput(controller);
    }
    return controller.active;
  }

  #rejectInput(session: ProjectionSession): void {
    this.#recordDiagnostic(session.source.surfaceId, "invalid", "rejected", 0);
    this.#close(session, true);
  }

  #recordDiagnostic(
    surfaceId: SurfaceId,
    category: InputDiagnosticCategory,
    outcome: "accepted" | "rejected" | "failed" | "released",
    latencyMs: number,
    redactedLength?: number,
  ): void {
    try {
      this.diagnostics.record(surfaceId, category, outcome, latencyMs, redactedLength);
    } catch {
      // Local diagnostics must never interrupt control or held-input cleanup.
    }
  }

  #isInputController(session: ProjectionSession): boolean {
    return this.#controllers.get(session.source.surfaceId)?.session === session;
  }

  #revokeInputFor(session: ProjectionSession): Promise<void> {
    const controller = this.#controllers.get(session.source.surfaceId);
    return controller?.session === session ? this.#revokeInput(controller) : Promise.resolve();
  }

  #revokeInput(controller: InputController): Promise<void> {
    if (controller.revoked) return controller.release;
    controller.revoked = true;
    controller.active = false;
    controller.queue.length = 0;
    controller.heldCodes.clear();
    controller.heldButtons.clear();
    const surfaceId = controller.session.source.surfaceId;
    if (this.#controllers.get(surfaceId) === controller) this.#controllers.delete(surfaceId);
    this.#sendInputAuthority(controller, false);
    const activation = controller.release;
    const priorRelease = this.#releaseBarriers.get(surfaceId) ?? Promise.resolve();
    const prior = Promise.all([activation.catch(() => {}), priorRelease.catch(() => {})]);
    const startedAt = Date.now();
    const release = prior.then(async () => {
      try {
        if (controller.provisioned) await controller.session.source.releaseInput(controller.epoch);
        this.#recordDiagnostic(surfaceId, "release", "released", Date.now() - startedAt);
      } catch (error) {
        this.#recordDiagnostic(surfaceId, "release", "failed", Date.now() - startedAt);
        throw error;
      } finally {
        if (controller.announced) {
          controller.announced = false;
          this.webControlReleased(controller.session.owner);
        }
      }
    });
    controller.release = release;
    this.#releaseBarriers.set(surfaceId, release);
    void release.finally(() => {
      if (this.#releaseBarriers.get(surfaceId) === release) this.#releaseBarriers.delete(surfaceId);
    }).catch(() => {});
    return release;
  }

  #sendInputAuthority(controller: InputController, active: boolean): void {
    const { input, source } = controller.session;
    if (input === undefined || !input.isOpen()) return;
    const message: ScreenInputAuthorityMessageDto = {
      version: SCREEN_PROJECTION_PROTOCOL_VERSION,
      type: "input-authority",
      active,
      surfaceId: source.surfaceId,
      runtimeGeneration: source.runtimeGeneration,
      geometryGeneration: source.geometryGeneration,
      controllerEpoch: controller.epoch,
      logicalWidth: source.logicalWidth,
      logicalHeight: source.logicalHeight,
      videoWidth: source.videoWidth,
      videoHeight: source.videoHeight,
      scale: source.scale,
    };
    try {
      input.sendMessage(JSON.stringify(message));
    } catch {
      // Revocation may race the native data channel closing.
    }
  }

  #captureStopped(session: ProjectionSession, mode = session.mode): boolean {
    return session.mode !== mode || mode === "idle" || this.#sessions.get(session.id) !== session;
  }

  #stopCaptureStream(session: ProjectionSession): void {
    const stream = session.captureStream;
    session.captureStream = undefined;
    if (stream === undefined) return;
    const cleanup = stream.close();
    session.captureCleanups.add(cleanup);
    this.#terminalCleanups.add(cleanup);
    void cleanup.finally(() => {
      session.captureCleanups.delete(cleanup);
      this.#terminalCleanups.delete(cleanup);
    }).catch(() => {});
  }

  #stopEncoder(session: ProjectionSession): void {
    const encoder = session.encoder;
    session.encoder = undefined;
    if (encoder === undefined) return;
    const cleanup = encoder.close();
    session.captureCleanups.add(cleanup);
    this.#terminalCleanups.add(cleanup);
    void cleanup.finally(() => {
      session.captureCleanups.delete(cleanup);
      this.#terminalCleanups.delete(cleanup);
    }).catch(() => {});
  }

  #recordFailure(session: ProjectionSession, cause: unknown): void {
    const metrics = Object.freeze({
      sessionId: session.id,
      surfaceId: session.source.surfaceId,
      sequence: session.sequence,
      captureAttempts: session.captureAttempts,
      sourceFrames: session.sourceFrames,
      encodedFrames: session.encodedFrames,
      framesSent: session.framesSent,
      preCaptureBackpressureSkips: session.preCaptureBackpressureSkips,
      encodedBackpressureDrops: session.encodedBackpressureDrops,
      transportUnavailableSkips: session.transportUnavailableSkips,
      invalidFrameDrops: session.invalidFrameDrops,
      sendFailures: session.sendFailures,
    });
    this.#failures.set(session.id, {
      botId: session.owner.botId,
      surfaceId: session.owner.surfaceId,
      diagnostic: Object.freeze({
        error: cause instanceof Error ? cause.message : String(cause),
        metrics,
      }),
    });
    const oldest = this.#failures.keys().next();
    if (this.#failures.size > 64 && !oldest.done) this.#failures.delete(oldest.value);
  }

  #close(session: ProjectionSession, failed: boolean): void {
    if (this.#sessions.get(session.id) !== session) return;
    void this.#revokeInputFor(session).catch(() => {});
    this.#sessions.delete(session.id);
    if (session.timer !== undefined) clearTimeout(session.timer);
    session.timer = undefined;
    this.#stopCaptureStream(session);
    this.#stopEncoder(session);
    session.mode = "idle";
    session.state = failed ? "failed" : "closed";
    for (const channel of [session.preview, session.control, session.input]) {
      try {
        channel?.close();
      } catch {
        // Peer teardown is best-effort after the session has been made unreachable.
      }
    }
    const termination = Promise.allSettled([
      ...(session.captureTask === undefined ? [] : [session.captureTask]),
      ...session.captureCleanups,
      session.peerClosed,
    ]).then(() => {});
    const terminal = {
      botId: session.owner.botId,
      surfaceId: session.owner.surfaceId,
      promise: termination,
    };
    this.#terminations.set(session.id, terminal);
    void termination.finally(() => {
      if (this.#terminations.get(session.id) === terminal) this.#terminations.delete(session.id);
    });
    try {
      session.peer.close();
    } catch {
      // Native peer may already be closed.
    }
    if (session.peer.state() === "closed") session.resolvePeerClosed();
  }
}
