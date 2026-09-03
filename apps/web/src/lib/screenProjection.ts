import {
  SCREEN_CONTROL_CHANNEL,
  SCREEN_FRAME_CHANNEL,
  SCREEN_INPUT_CHANNEL,
  SCREEN_PROJECTION_PROTOCOL_VERSION,
  ScreenPointerAuthorityMessageDto,
  ScreenProjectionAnswerDto,
  ScreenProjectionFrameHeaderDto,
  type ScreenPointerAuthorityMessageDto as PointerAuthority,
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

interface PointerContentRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ProjectionGeometry {
  geometryGeneration: number;
  logicalWidth: number;
  logicalHeight: number;
  videoWidth: number;
  videoHeight: number;
  scale: number;
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
  #pointerAuthority: PointerAuthority | undefined;
  #pointerSequence = 0;
  #geometry: ProjectionGeometry | undefined;

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
    this.#input.addEventListener("message", (event) => this.#receivePointerAuthority(event.data));
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
      this.#geometry = {
        geometryGeneration: answer.data.geometryGeneration,
        logicalWidth: answer.data.logicalWidth,
        logicalHeight: answer.data.logicalHeight,
        videoWidth: answer.data.videoWidth,
        videoHeight: answer.data.videoHeight,
        scale: answer.data.scale,
      };
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
    if (this.#desiredMode !== mode) this.#pointerAuthority = undefined;
    this.#desiredMode = mode;
    this.#activate();
  }

  pointerMotion(clientX: number, clientY: number, renderedVideo: Element, clampToContent = false): void {
    const position = this.#mapPointer(clientX, clientY, renderedVideo.getBoundingClientRect(), clampToContent);
    if (position !== undefined) this.#sendPointer("pointer-motion", position);
  }

  pointerButton(
    clientX: number,
    clientY: number,
    renderedVideo: Element,
    button: number,
    state: "pressed" | "released",
  ): void {
    const namedButton = button === 0 ? "left" : button === 1 ? "middle" : button === 2 ? "right" : undefined;
    if (namedButton === undefined) return;
    const position = this.#mapPointer(
      clientX,
      clientY,
      renderedVideo.getBoundingClientRect(),
      state === "released",
    );
    if (position !== undefined) this.#sendPointer("pointer-button", { ...position, button: namedButton, state });
  }

  pointerScroll(clientX: number, clientY: number, renderedVideo: Element, deltaX: number, deltaY: number): void {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (deltaX === 0 && deltaY === 0)) return;
    const position = this.#mapPointer(clientX, clientY, renderedVideo.getBoundingClientRect());
    if (position !== undefined) this.#sendPointer("pointer-scroll", { ...position, deltaX, deltaY });
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#abort.abort();
    this.#pending = undefined;
    this.#pointerAuthority = undefined;
    this.#geometry = undefined;
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

  #receivePointerAuthority(raw: unknown): void {
    if (this.#closed || typeof raw !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const authority = ScreenPointerAuthorityMessageDto.safeParse(parsed);
    if (
      !authority.success
      || authority.data.surfaceId !== this.owner.surfaceId
      || authority.data.runtimeGeneration !== this.#runtimeGeneration
      || !this.#matchesGeometry(authority.data)
    ) return;
    if (!authority.data.active) {
      if (this.#pointerAuthority?.controllerEpoch === authority.data.controllerEpoch) {
        this.#pointerAuthority = undefined;
      }
      return;
    }
    this.#pointerAuthority = authority.data;
    this.#pointerSequence = 0;
  }

  #mapPointer(
    clientX: number,
    clientY: number,
    renderedRect: PointerContentRect,
    clampToContent = false,
  ): { x: number; y: number } | undefined {
    const authority = this.#pointerAuthority;
    if (
      authority === undefined
      || !Number.isFinite(clientX)
      || !Number.isFinite(clientY)
      || renderedRect.width <= 0
      || renderedRect.height <= 0
    ) return undefined;
    const contentScale = Math.min(
      renderedRect.width / authority.videoWidth,
      renderedRect.height / authority.videoHeight,
    );
    const contentWidth = authority.videoWidth * contentScale;
    const contentHeight = authority.videoHeight * contentScale;
    const contentLeft = renderedRect.left + (renderedRect.width - contentWidth) / 2;
    const contentTop = renderedRect.top + (renderedRect.height - contentHeight) / 2;
    if (
      !clampToContent
      && (
        clientX < contentLeft
        || clientY < contentTop
        || clientX > contentLeft + contentWidth
        || clientY > contentTop + contentHeight
      )
    ) return undefined;
    const mappedClientX = Math.min(contentLeft + contentWidth, Math.max(contentLeft, clientX));
    const mappedClientY = Math.min(contentTop + contentHeight, Math.max(contentTop, clientY));
    return {
      x: Math.min(
        authority.logicalWidth - 1,
        ((mappedClientX - contentLeft) / contentWidth) * authority.logicalWidth,
      ),
      y: Math.min(
        authority.logicalHeight - 1,
        ((mappedClientY - contentTop) / contentHeight) * authority.logicalHeight,
      ),
    };
  }

  #sendPointer(
    type: "pointer-motion" | "pointer-button" | "pointer-scroll",
    event: Record<string, number | string>,
  ): void {
    const authority = this.#pointerAuthority;
    if (
      authority === undefined
      || this.#desiredMode !== "expanded"
      || this.#input.readyState !== "open"
    ) return;
    this.#input.send(JSON.stringify({
      version: SCREEN_PROJECTION_PROTOCOL_VERSION,
      type,
      surfaceId: this.owner.surfaceId,
      runtimeGeneration: authority.runtimeGeneration,
      geometryGeneration: authority.geometryGeneration,
      controllerEpoch: authority.controllerEpoch,
      sequence: ++this.#pointerSequence,
      ...event,
    }));
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
        || !this.#matchesGeometry(header.data)
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

  #matchesGeometry(value: ProjectionGeometry): boolean {
    const geometry = this.#geometry;
    return geometry !== undefined
      && value.geometryGeneration === geometry.geometryGeneration
      && value.logicalWidth === geometry.logicalWidth
      && value.logicalHeight === geometry.logicalHeight
      && value.videoWidth === geometry.videoWidth
      && value.videoHeight === geometry.videoHeight
      && value.scale === geometry.scale;
  }
}
