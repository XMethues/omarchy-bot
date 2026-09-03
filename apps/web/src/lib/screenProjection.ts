import {
  SCREEN_CONTROL_CHANNEL,
  SCREEN_FRAME_CHANNEL,
  SCREEN_INPUT_CHANNEL,
  SCREEN_PROJECTION_PROTOCOL_VERSION,
  ScreenProjectionAnswerDto,
  ScreenProjectionFrameHeaderDto,
  type ScreenProjectionFrameHeaderDto as FrameHeader,
  type ScreenProjectionModeDto,
} from "@omarchy-bot/protocol";

const MAX_FRAME_BYTES = 8 * 1024 * 1024;

export type ScreenProjectionMode = Exclude<ScreenProjectionModeDto, "idle">;
export type ScreenProjectionState = "connecting" | "preview" | "expanded" | "reconnecting" | "unavailable" | "closed";

export interface ScreenProjectionOwner {
  botId: string;
  surfaceId: string;
}

export interface ScreenProjectionCallbacks {
  onState(state: ScreenProjectionState): void;
  onFrame(frame: Blob | undefined): void;
}


interface PendingFrame {
  header: FrameHeader;
  chunks: ArrayBuffer[];
  receivedBytes: number;
}


/** Browser-side deep module for SDP exchange, frame reassembly, and stale peer teardown. */
export class ScreenProjectionConnection {
  readonly #peer = new RTCPeerConnection({ iceServers: [] });
  readonly #frames: RTCDataChannel;
  readonly #control: RTCDataChannel;
  readonly #input: RTCDataChannel;
  readonly #abort = new AbortController();
  #sessionId?: string;
  #runtimeGeneration?: number;
  #desiredMode: ScreenProjectionMode = "preview";
  #pending: PendingFrame | undefined;
  #closed = false;

  constructor(
    private readonly endpoint: string,
    private readonly owner: ScreenProjectionOwner,
    private readonly callbacks: ScreenProjectionCallbacks,
  ) {
    this.#frames = this.#peer.createDataChannel(SCREEN_FRAME_CHANNEL, { ordered: true });
    this.#frames.binaryType = "arraybuffer";
    this.#control = this.#peer.createDataChannel(SCREEN_CONTROL_CHANNEL, { ordered: true });
    this.#input = this.#peer.createDataChannel(SCREEN_INPUT_CHANNEL, { ordered: true });
    this.#frames.addEventListener("message", (event) => this.#receive(event.data));
    this.#control.addEventListener("open", () => this.#activate());
    this.#peer.addEventListener("connectionstatechange", () => {
      if (this.#closed) return;
      if (this.#peer.connectionState === "disconnected") this.callbacks.onState("reconnecting");
      if (this.#peer.connectionState === "connected") this.#activate();
      if (this.#peer.connectionState === "failed") {
        this.close();
        this.callbacks.onState("unavailable");
      }
    });
  }

  async connect(): Promise<void> {
    this.callbacks.onState("connecting");
    try {
      const offer = await this.#peer.createOffer();
      await this.#peer.setLocalDescription(offer);
      if (this.#peer.iceGatheringState !== "complete") {
        await new Promise<void>((resolve) => {
          const gathered = (): void => {
            if (this.#peer.iceGatheringState !== "complete") return;
            this.#peer.removeEventListener("icegatheringstatechange", gathered);
            resolve();
          };
          this.#peer.addEventListener("icegatheringstatechange", gathered);
        });
      }
      if (this.#closed) return;
      const localDescription = this.#peer.localDescription;
      if (localDescription === null) throw new Error("WebRTC offer was not created");
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "offer", sdp: localDescription.sdp }),
        signal: this.#abort.signal,
      });
      const rawAnswer: unknown = await response.json().catch(() => undefined);
      const answer = ScreenProjectionAnswerDto.safeParse(rawAnswer);
      if (!response.ok || !answer.success) throw new Error("Screen Projection signaling failed");
      if (answer.data.surfaceId !== this.owner.surfaceId) throw new Error("Screen Projection Surface does not match");
      this.#sessionId = answer.data.sessionId;
      this.#runtimeGeneration = answer.data.runtimeGeneration;
      await this.#peer.setRemoteDescription({ type: answer.data.type, sdp: answer.data.sdp });
      for (const candidate of answer.data.candidates) {
        await this.#peer.addIceCandidate({ candidate: candidate.candidate, sdpMid: candidate.sdpMid });
      }
      this.#activate();
    } catch (error) {
      if (this.#closed || (error instanceof DOMException && error.name === "AbortError")) return;
      this.close();
      this.callbacks.onState("unavailable");
    }
  }

  setMode(mode: ScreenProjectionMode): void {
    this.#desiredMode = mode;
    this.#activate();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#abort.abort();
    this.#pending = undefined;
    this.callbacks.onFrame(undefined);
    this.callbacks.onState("closed");
    if (this.#control.readyState === "open" && this.#runtimeGeneration !== undefined) {
      this.#control.send(JSON.stringify({
        version: SCREEN_PROJECTION_PROTOCOL_VERSION,
        type: "view",
        surfaceId: this.owner.surfaceId,
        runtimeGeneration: this.#runtimeGeneration,
        mode: "idle",
      }));
    }
    this.#frames.close();
    this.#control.close();
    this.#input.close();
    this.#peer.close();
    if (this.#sessionId !== undefined) {
      void fetch(this.endpoint, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: this.#sessionId }),
        keepalive: true,
      }).catch(() => {});
    }
  }

  #activate(): void {
    if (
      this.#closed
      || this.#control.readyState !== "open"
      || this.#sessionId === undefined
      || this.#runtimeGeneration === undefined
    ) return;
    this.#control.send(JSON.stringify({
      version: SCREEN_PROJECTION_PROTOCOL_VERSION,
      type: "view",
      surfaceId: this.owner.surfaceId,
      runtimeGeneration: this.#runtimeGeneration,
      mode: this.#desiredMode,
    }));
    this.callbacks.onState(this.#desiredMode);
  }

  #receive(raw: unknown): void {
    if (this.#closed) return;
    if (typeof raw === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.#pending = undefined;
        return;
      }
      const header = ScreenProjectionFrameHeaderDto.safeParse(parsed);
      if (
        !header.success
        || header.data.byteLength > MAX_FRAME_BYTES
        || header.data.surfaceId !== this.owner.surfaceId
        || header.data.runtimeGeneration !== this.#runtimeGeneration
      ) {
        this.#pending = undefined;
        return;
      }
      this.#pending = { header: header.data, chunks: [], receivedBytes: 0 };
      return;
    }
    if (!(raw instanceof ArrayBuffer) || this.#pending === undefined) return;
    const pending = this.#pending;
    pending.chunks.push(raw);
    pending.receivedBytes += raw.byteLength;
    if (pending.receivedBytes > pending.header.byteLength || pending.chunks.length > pending.header.chunkCount) {
      this.#pending = undefined;
      return;
    }
    if (pending.chunks.length !== pending.header.chunkCount) return;
    this.#pending = undefined;
    if (pending.receivedBytes !== pending.header.byteLength) return;
    this.callbacks.onFrame(new Blob(pending.chunks, { type: pending.header.mediaType }));
  }
}
