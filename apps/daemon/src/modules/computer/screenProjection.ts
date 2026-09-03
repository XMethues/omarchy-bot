import { randomUUID } from "node:crypto";
import rtc, { type DataChannel, type PeerConnection } from "node-datachannel";
import type { SurfaceId } from "@omarchy-bot/domain";
import {
  SCREEN_CONTROL_CHANNEL,
  SCREEN_FRAME_CHANNEL,
  SCREEN_INPUT_CHANNEL,
  SCREEN_PROJECTION_PROTOCOL_VERSION,
  ScreenProjectionControlMessageDto,
  type ScreenProjectionAnswerDto,
  type ScreenProjectionModeDto,
  type ScreenProjectionOfferDto,
} from "@omarchy-bot/protocol";
import type { ComputerSurfaceOwner } from "./broker.ts";
import type { BotScreenManager, BotScreenProjectionSource } from "./botScreenManager.ts";

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
 * Owns every WebRTC peer and capture pump. HTTP routes only exchange SDP, while
 * runtime handles, capture cadence, protocol framing, and backpressure stay here.
 */
export class ScreenProjectionService {
  #sessions = new Map<string, ProjectionSession>();

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
      // Deliberately retained as an inert, named seam. Tickets 05–06 own input semantics.
      session.input = channel;
    } else {
      channel.close();
      return;
    }
    channel.onOpen(() => {
      if (this.#sessions.get(session.id) === session && session.state === "connecting") session.state = "idle";
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
    session.mode = mode;
    session.state = mode;
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

  #close(session: ProjectionSession, failed: boolean): void {
    if (this.#sessions.get(session.id) !== session) return;
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
