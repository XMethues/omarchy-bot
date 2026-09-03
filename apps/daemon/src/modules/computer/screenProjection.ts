import { randomUUID } from "node:crypto";
import rtc, { type DataChannel, type PeerConnection } from "node-datachannel";
import type { SurfaceId } from "@omarchy-bot/domain";
import {
  SCREEN_CONTROL_CHANNEL,
  SCREEN_FRAME_CHANNEL,
  SCREEN_INPUT_CHANNEL,
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
  BotScreenProjectionSource,
} from "./botScreenManager.ts";
import { InputDiagnostics, type InputDiagnosticCategory } from "./inputDiagnostics.ts";

const PREVIEW_INTERVAL_MS = 1_000;
const EXPANDED_INTERVAL_MS = 200;
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


interface ProjectionSession {
  id: string;
  owner: ComputerSurfaceOwner;
  source: BotScreenProjectionSource;
  peer: PeerConnection;
  state: ProjectionLifecycleState;
  mode: ProjectionViewMode;
  frames?: DataChannel;
  control?: DataChannel;
  input?: DataChannel;
  sequence: number;
  timer?: Timer | undefined;
  framesSent: number;
  captureInFlight: boolean;
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
  heldCodes: Set<string>;
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


function timeout<T>(message: string): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const timer = setTimeout(() => rejectPromise(new Error(message)), SIGNALING_TIMEOUT_MS);
  timer.unref?.();
  return {
    promise: promise.finally(() => clearTimeout(timer)),
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

/**
 * Owns WebRTC peers, capture pumps, and validated Web Controllers. HTTP
 * routes exchange SDP while runtime handles, geometry, authority, ordering,
 * protocol framing, motion coalescing, release barriers, and backpressure stay here.
 */
export class ScreenProjectionService {
  #sessions = new Map<string, ProjectionSession>();
  #controllers = new Map<SurfaceId, InputController>();
  #controllerEpochs = new Map<SurfaceId, number>();
  #releaseBarriers = new Map<SurfaceId, Promise<void>>();
  constructor(
    private readonly screens: BotScreenManager,
    private readonly diagnostics: InputDiagnostics,
  ) {}

  async answer(owner: ComputerSurfaceOwner, offer: ScreenProjectionOfferDto): Promise<ScreenProjectionAnswerDto> {
    if (offer.type !== "offer" || offer.sdp.trim() === "") throw new Error("a WebRTC SDP offer is required");
    const source = await this.screens.projectionSource(owner);
    if (source === undefined) throw new Error("Bot Screen is unavailable");

    const id = randomUUID();
    const peer = new rtc.PeerConnection(`screen-projection-${id}`, {
      iceServers: [],
      disableAutoNegotiation: true,
      maxMessageSize: MAX_FRAME_BYTES,
    });
    const session: ProjectionSession = {
      id,
      owner,
      source,
      peer,
      state: "connecting",
      mode: "idle",
      sequence: 0,
      captureInFlight: false,
      framesSent: 0,
    };
    this.#sessions.set(id, session);

    const localDescription = timeout<{ sdp: string; type: string }>("WebRTC answer creation timed out");
    const gathering = timeout<void>("WebRTC ICE gathering timed out");
    const candidates: Array<{ candidate: string; sdpMid: string }> = [];
    peer.onLocalDescription((sdp, type) => localDescription.resolve({ sdp, type }));
    peer.onLocalCandidate((candidate, sdpMid) => candidates.push({ candidate, sdpMid }));
    peer.onGatheringStateChange((state) => {
      if (state === "complete") gathering.resolve();
    });
    peer.onDataChannel((channel) => this.#acceptChannel(session, channel));
    peer.onStateChange((state) => {
      if (state === "closed" || state === "disconnected" || state === "failed") {
        this.#close(session, state === "failed");
      }
    });

    try {
      peer.setRemoteDescription(offer.sdp, "offer");
      peer.setLocalDescription("answer");
      const description = await localDescription.promise;
      await gathering.promise;
      const finalDescription = peer.localDescription();
      return {
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
        transport: "webrtc-data-channel-frames-v1",
        channels: {
          frames: SCREEN_FRAME_CHANNEL,
          control: SCREEN_CONTROL_CHANNEL,
          input: SCREEN_INPUT_CHANNEL,
        },
        security: { authentication: "none", httpsRequired: false },
        candidates,
      };
    } catch (error) {
      this.#close(session, true);
      throw error;
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

  close(owner: ComputerSurfaceOwner, sessionId: string): boolean {
    const session = this.#sessions.get(sessionId);
    if (session === undefined || session.owner.botId !== owner.botId || session.owner.surfaceId !== owner.surfaceId) {
      return false;
    }
    this.#close(session, false);
    return true;
  }

  closeSurface(surfaceId: SurfaceId): void {
    for (const session of this.#sessions.values()) {
      if (session.owner.surfaceId === surfaceId) this.#close(session, false);
    }
  }

  async shutdown(): Promise<void> {
    for (const session of [...this.#sessions.values()]) this.#close(session, false);
    await Promise.allSettled(this.#releaseBarriers.values());
    this.diagnostics.shutdown();
  }

  #acceptChannel(session: ProjectionSession, channel: DataChannel): void {
    if (this.#sessions.get(session.id) !== session) {
      channel.close();
      return;
    }
    const label = channel.getLabel();
    if (label === SCREEN_FRAME_CHANNEL) session.frames = channel;
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
      if (label === SCREEN_INPUT_CHANNEL && session.mode === "expanded") this.#claimInput(session);
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
    session.mode = mode;
    session.state = mode;
    if (mode === "expanded" && (changed || !this.#isInputController(session))) this.#claimInput(session);
    if (mode !== "idle") this.#schedule(session, 0);
  }

  #schedule(session: ProjectionSession, delay: number): void {
    if (session.timer !== undefined || session.mode === "idle" || this.#sessions.get(session.id) !== session) return;
    session.timer = setTimeout(() => {
      session.timer = undefined;
      void this.#projectFrame(session);
    }, delay);
    session.timer.unref?.();
  }

  async #projectFrame(session: ProjectionSession): Promise<void> {
    if (session.captureInFlight || session.mode === "idle" || this.#sessions.get(session.id) !== session) return;
    const channel = session.frames;
    if (channel === undefined || !channel.isOpen() || channel.bufferedAmount() > 0) {
      this.#scheduleNext(session);
      return;
    }

    session.captureInFlight = true;
    try {
      const capture = await session.source.capture();
      if (session.state === "idle" || this.#sessions.get(session.id) !== session) return;
      if (capture.bytes.byteLength === 0 || capture.bytes.byteLength > MAX_FRAME_BYTES) return;
      const byteLength = capture.bytes.byteLength;
      if (channel.bufferedAmount() + byteLength > MAX_BUFFERED_BYTES) return;
      const chunkCount = Math.ceil(byteLength / CHUNK_BYTES);
      const header = JSON.stringify({
        version: SCREEN_PROJECTION_PROTOCOL_VERSION,
        type: "frame",
        surfaceId: session.source.surfaceId,
        runtimeGeneration: session.source.runtimeGeneration,
        geometryGeneration: session.source.geometryGeneration,
        logicalWidth: session.source.logicalWidth,
        logicalHeight: session.source.logicalHeight,
        videoWidth: session.source.videoWidth,
        videoHeight: session.source.videoHeight,
        scale: session.source.scale,
        sequence: ++session.sequence,
        mediaType: capture.mediaType,
        capturedAt: new Date().toISOString(),
        mode: session.mode,
        byteLength,
        chunkCount,
      });
      if (!channel.sendMessage(header)) return;
      for (let offset = 0; offset < byteLength; offset += CHUNK_BYTES) {
        if (!channel.sendMessageBinary(capture.bytes.subarray(offset, Math.min(offset + CHUNK_BYTES, byteLength)))) return;
      }
      session.framesSent += 1;
    } catch {
      this.#close(session, true);
      return;
    } finally {
      session.captureInFlight = false;
      this.#scheduleNext(session);
    }
  }

  #scheduleNext(session: ProjectionSession): void {
    const delay = session.mode === "expanded" ? EXPANDED_INTERVAL_MS : PREVIEW_INTERVAL_MS;
    this.#schedule(session, delay);
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
    controller.nextSequence += 1;
    if (message.data.type === "release-control") {
      this.#revokeInput(controller);
      return;
    }

    let event: BotScreenInputEvent;
    if (message.data.type === "pointer-motion") {
      event = { type: "motion", x: message.data.x, y: message.data.y };
    } else if (message.data.type === "pointer-button") {
      event = {
        type: "button",
        x: message.data.x,
        y: message.data.y,
        button: message.data.button,
        state: message.data.state,
      };
    } else if (message.data.type === "pointer-scroll") {
      event = {
        type: "scroll",
        x: message.data.x,
        y: message.data.y,
        deltaX: message.data.deltaX,
        deltaY: message.data.deltaY,
      };
    } else if (message.data.type === "paste") {
      event = { type: "paste", text: message.data.text };
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
      event = { type: "key", keyCode: KEY_CODES[message.data.code]!, state: message.data.state };
    }
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

  #claimInput(session: ProjectionSession): void {
    if (
      this.#sessions.get(session.id) !== session
      || session.mode !== "expanded"
      || session.input === undefined
      || !session.input.isOpen()
      || this.#isInputController(session)
    ) return;
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
      heldCodes: new Set(),
      release: Promise.resolve(),
    };
    this.#controllers.set(surfaceId, controller);
    const barrier = this.#releaseBarriers.get(surfaceId) ?? Promise.resolve();
    controller.release = barrier.then(() => {
      if (
        controller.revoked
        || this.#controllers.get(surfaceId) !== controller
        || this.#sessions.get(session.id) !== session
        || session.mode !== "expanded"
      ) return;
      controller.active = true;
      this.#sendInputAuthority(controller, true);
      this.#recordDiagnostic(surfaceId, "controller", "accepted", 0);
    }).catch(() => this.#close(session, true));
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
    const surfaceId = controller.session.source.surfaceId;
    if (this.#controllers.get(surfaceId) === controller) this.#controllers.delete(surfaceId);
    this.#sendInputAuthority(controller, false);
    const prior = this.#releaseBarriers.get(surfaceId) ?? Promise.resolve();
    const startedAt = Date.now();
    const release = prior.catch(() => {}).then(async () => {
      try {
        await controller.session.source.releaseInput();
        this.#recordDiagnostic(surfaceId, "release", "released", Date.now() - startedAt);
      } catch (error) {
        this.#recordDiagnostic(surfaceId, "release", "failed", Date.now() - startedAt);
        throw error;
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
  #close(session: ProjectionSession, failed: boolean): void {
    if (this.#sessions.get(session.id) !== session) return;
    void this.#revokeInputFor(session).catch(() => {});
    this.#sessions.delete(session.id);
    if (session.timer !== undefined) clearTimeout(session.timer);
    session.timer = undefined;
    session.mode = "idle";
    session.state = failed ? "failed" : "closed";
    for (const channel of [session.frames, session.control, session.input]) {
      try {
        channel?.close();
      } catch {
        // Peer teardown is best-effort after the session has been made unreachable.
      }
    }
    try {
      session.peer.close();
    } catch {
      // Native peer may already be closed.
    }
  }
}
