import { randomUUID } from "node:crypto";
import rtc, { type DataChannel, type PeerConnection } from "node-datachannel";
import type { SurfaceId } from "@omarchy-bot/domain";
import {
  SCREEN_CONTROL_CHANNEL,
  SCREEN_FRAME_CHANNEL,
  SCREEN_INPUT_CHANNEL,
  SCREEN_PROJECTION_PROTOCOL_VERSION,
  ScreenPointerInputMessageDto,
  ScreenProjectionControlMessageDto,
  type ScreenPointerAuthorityMessageDto,
  type ScreenProjectionAnswerDto,
  type ScreenProjectionModeDto,
  type ScreenProjectionOfferDto,
} from "@omarchy-bot/protocol";
import type { ComputerSurfaceOwner } from "./broker.ts";
import type {
  BotScreenManager,
  BotScreenPointerEvent,
  BotScreenProjectionSource,
} from "./botScreenManager.ts";

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

interface PointerController {
  session: ProjectionSession;
  epoch: number;
  nextSequence: number;
  queue: BotScreenPointerEvent[];
  draining: boolean;
  revoked: boolean;
}


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
 * Owns WebRTC peers, capture pumps, and validated pointer controllers. HTTP
 * routes exchange SDP while runtime handles, geometry, authority, ordering,
 * protocol framing, coalescing, and backpressure stay here.
 */
export class ScreenProjectionService {
  #sessions = new Map<string, ProjectionSession>();
  #controllers = new Map<SurfaceId, PointerController>();
  #controllerEpochs = new Map<SurfaceId, number>();

  constructor(private readonly screens: BotScreenManager) {}

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
      if (state === "closed" || state === "failed") this.#close(session, state === "failed");
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

  shutdown(): void {
    for (const session of [...this.#sessions.values()]) this.#close(session, false);
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
      if (label === SCREEN_INPUT_CHANNEL && session.mode === "expanded") this.#claimPointer(session);
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
    if (session.mode === "expanded" && mode !== "expanded") this.#revokePointerFor(session);
    const changed = session.mode !== mode;
    session.mode = mode;
    session.state = mode;
    if (mode === "expanded" && (changed || !this.#isPointerController(session))) this.#claimPointer(session);
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
    if (controller?.session !== session || controller.revoked || session.mode !== "expanded") return;
    if (typeof raw !== "string") {
      this.#close(session, true);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.#close(session, true);
      return;
    }
    const message = ScreenPointerInputMessageDto.safeParse(parsed);
    if (
      !message.success
      || message.data.surfaceId !== session.source.surfaceId
      || message.data.runtimeGeneration !== session.source.runtimeGeneration
      || message.data.geometryGeneration !== session.source.geometryGeneration
      || message.data.controllerEpoch !== controller.epoch
      || message.data.sequence !== controller.nextSequence
      || message.data.x >= session.source.logicalWidth
      || message.data.y >= session.source.logicalHeight
      || (message.data.type === "pointer-scroll" && message.data.deltaX === 0 && message.data.deltaY === 0)
    ) {
      this.#close(session, true);
      return;
    }
    controller.nextSequence += 1;
    const event: BotScreenPointerEvent = message.data.type === "pointer-motion"
      ? { type: "motion", x: message.data.x, y: message.data.y }
      : message.data.type === "pointer-button"
        ? {
            type: "button",
            x: message.data.x,
            y: message.data.y,
            button: message.data.button,
            state: message.data.state,
          }
        : {
            type: "scroll",
            x: message.data.x,
            y: message.data.y,
            deltaX: message.data.deltaX,
            deltaY: message.data.deltaY,
          };
    const last = controller.queue.at(-1);
    if (event.type === "motion" && last?.type === "motion") controller.queue[controller.queue.length - 1] = event;
    else controller.queue.push(event);
    if (!controller.draining) {
      controller.draining = true;
      queueMicrotask(() => void this.#drainPointer(controller));
    }
  }

  async #drainPointer(controller: PointerController): Promise<void> {
    try {
      while (
        !controller.revoked
        && this.#controllers.get(controller.session.source.surfaceId) === controller
      ) {
        const event = controller.queue.shift();
        if (event === undefined) return;
        await controller.session.source.pointer(event);
      }
    } catch {
      this.#close(controller.session, true);
    } finally {
      controller.draining = false;
      if (!controller.revoked && controller.queue.length > 0) {
        controller.draining = true;
        queueMicrotask(() => void this.#drainPointer(controller));
      }
    }
  }

  #claimPointer(session: ProjectionSession): void {
    if (
      this.#sessions.get(session.id) !== session
      || session.mode !== "expanded"
      || session.input === undefined
      || !session.input.isOpen()
      || this.#isPointerController(session)
    ) return;
    const previous = this.#controllers.get(session.source.surfaceId);
    if (previous !== undefined && previous.session !== session) this.#close(previous.session, false);
    const epoch = (this.#controllerEpochs.get(session.source.surfaceId) ?? 0) + 1;
    this.#controllerEpochs.set(session.source.surfaceId, epoch);
    const controller: PointerController = {
      session,
      epoch,
      nextSequence: 1,
      queue: [],
      draining: false,
      revoked: false,
    };
    this.#controllers.set(session.source.surfaceId, controller);
    this.#sendPointerAuthority(controller, true);
  }

  #isPointerController(session: ProjectionSession): boolean {
    return this.#controllers.get(session.source.surfaceId)?.session === session;
  }

  #revokePointerFor(session: ProjectionSession): void {
    const controller = this.#controllers.get(session.source.surfaceId);
    if (controller?.session === session) this.#revokePointer(controller);
  }

  #revokePointer(controller: PointerController): void {
    if (controller.revoked) return;
    controller.revoked = true;
    controller.queue.length = 0;
    if (this.#controllers.get(controller.session.source.surfaceId) === controller) {
      this.#controllers.delete(controller.session.source.surfaceId);
    }
    this.#sendPointerAuthority(controller, false);
    void controller.session.source.releasePointer().catch(() => {});
  }

  #sendPointerAuthority(controller: PointerController, active: boolean): void {
    const { input, source } = controller.session;
    if (input === undefined || !input.isOpen()) return;
    const message: ScreenPointerAuthorityMessageDto = {
      version: SCREEN_PROJECTION_PROTOCOL_VERSION,
      type: "pointer-authority",
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
    this.#revokePointerFor(session);
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
