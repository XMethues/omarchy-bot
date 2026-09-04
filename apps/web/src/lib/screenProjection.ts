import {
  SCREEN_CONTROL_CHANNEL,
  SCREEN_FRAME_CHANNEL,
  SCREEN_INPUT_CHANNEL,
  SCREEN_PROJECTION_PROTOCOL_VERSION,
  ScreenInputAuthorityMessageDto,
  ScreenKeyCodeDto,
  ScreenProjectionAnswerDto,
  ScreenProjectionFrameHeaderDto,
  type ScreenProjectionFrameHeaderDto as FrameHeader,
  type ScreenInputAuthorityMessageDto as InputAuthority,
  type ScreenProjectionModeDto,
} from "@omarchy-bot/protocol";

const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const CONNECTION_TIMEOUT_MS = 10_000;
const FIRST_FRAME_TIMEOUT_MS = 5_000;

export type ScreenProjectionMode = Exclude<ScreenProjectionModeDto, "idle">;
export type ScreenProjectionState = "connecting" | "preview" | "expanded" | "reconnecting" | "unavailable" | "closed";

export interface ScreenProjectionOwner {
  botId: string;
  surfaceId: string;
}

export interface ScreenProjectionCallbacks {
  onState(state: ScreenProjectionState): void;
  onFrame(frame: Blob | undefined): void;
  onError(error: string): void;
  onControlRevoked?(): void;
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
type PointerButton = "left" | "middle" | "right";


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
  #connectionTimer: number | undefined;
  #firstFrameTimer: number | undefined;
  #receivedFrame = false;
  #inputAuthority: InputAuthority | undefined;
  #inputSequence = 0;
  #releasingEpoch: number | undefined;
  #resumeAfterRelease = false;
  #geometry: ProjectionGeometry | undefined;
  readonly #heldPointerButtons = new Set<PointerButton>();

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
    this.#input.addEventListener("message", (event) => this.#receiveInputAuthority(event.data));
    this.#control.addEventListener("open", () => this.#activate());
    this.#peer.addEventListener("connectionstatechange", () => {
      if (this.#closed) return;
      if (this.#peer.connectionState === "disconnected") {
        this.releaseControl("teardown");
        clearTimeout(this.#firstFrameTimer);
        this.#firstFrameTimer = undefined;
        this.callbacks.onState("reconnecting");
        this.#armConnectionDeadline("The screen connection was lost.");
      } else if (this.#peer.connectionState === "connected") {
        this.#activate();
      } else if (this.#peer.connectionState === "failed") {
        this.#fail("Couldn’t connect to the Bot Screen.");
      }
    });
  }

  async connect(): Promise<void> {
    this.callbacks.onState("connecting");
    this.#armConnectionDeadline("Couldn’t connect to the Bot Screen.");
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
      if (localDescription === null) throw new Error("Couldn’t create the screen connection.");
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "offer", sdp: localDescription.sdp }),
        signal: this.#abort.signal,
      });
      const rawAnswer: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        const message =
          rawAnswer !== null
          && typeof rawAnswer === "object"
          && "error" in rawAnswer
          && typeof rawAnswer.error === "string"
            ? rawAnswer.error
            : "Couldn’t start the Bot Screen.";
        throw new Error(message);
      }
      const answer = ScreenProjectionAnswerDto.safeParse(rawAnswer);
      if (!answer.success) throw new Error("The Bot Screen returned an invalid connection response.");
      if (answer.data.surfaceId !== this.owner.surfaceId) {
        throw new Error("The Bot Screen connection did not match this screen.");
      }
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
      this.#fail(error instanceof Error ? error.message : "Couldn’t connect to the Bot Screen.");
    }
  }

  setMode(mode: ScreenProjectionMode): void {
    if (this.#desiredMode !== mode) {
      this.#inputAuthority = undefined;
      this.#releasingEpoch = undefined;
      this.#resumeAfterRelease = false;
      this.#clearHeldInput();
    }
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
  ): boolean {
    const namedButton: PointerButton | undefined =
      button === 0 ? "left" : button === 1 ? "middle" : button === 2 ? "right" : undefined;
    if (namedButton === undefined) return false;
    if (
      (state === "pressed" && this.#heldPointerButtons.has(namedButton))
      || (state === "released" && !this.#heldPointerButtons.has(namedButton))
    ) return false;
    const position = this.#mapPointer(
      clientX,
      clientY,
      renderedVideo.getBoundingClientRect(),
      state === "released",
    );
    if (
      position === undefined
      || !this.#sendPointer("pointer-button", { ...position, button: namedButton, state })
    ) return false;
    if (state === "pressed") this.#heldPointerButtons.add(namedButton);
    else this.#heldPointerButtons.delete(namedButton);
    return true;
  }

  pointerScroll(clientX: number, clientY: number, renderedVideo: Element, deltaX: number, deltaY: number): void {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (deltaX === 0 && deltaY === 0)) return;
    const position = this.#mapPointer(clientX, clientY, renderedVideo.getBoundingClientRect());
    if (position !== undefined) this.#sendPointer("pointer-scroll", { ...position, deltaX, deltaY });
  }

  keyTransition(
    code: string,
    state: "pressed" | "released",
    modifiers: { control: boolean; alt: boolean; shift: boolean; meta: boolean },
  ): boolean {
    const supported = ScreenKeyCodeDto.safeParse(code);
    if (!supported.success) return false;
    return this.#sendInput({ type: "key", code: supported.data, state, modifiers });
  }

  paste(text: string): boolean {
    if (
      text.length === 0
      || text.includes("\0")
      || new TextEncoder().encode(text).byteLength > 65_536
    ) return false;
    return this.#sendInput({ type: "paste", text });
  }

  releaseControl(reason: "blur" | "visibility-loss" | "navigation" | "teardown"): void {
    const authority = this.#inputAuthority;
    if (authority === undefined) return;
    if (this.#sendInput({ type: "release-control", reason })) {
      this.#releasingEpoch = authority.controllerEpoch;
      this.#inputAuthority = undefined;
      this.#clearHeldInput();
    }
  }

  resumeControl(): void {
    if (this.#desiredMode !== "expanded") return;
    if (this.#releasingEpoch !== undefined) {
      this.#resumeAfterRelease = true;
      return;
    }
    this.#activate();
  }

  close(): void {
    if (this.#closed) return;
    clearTimeout(this.#connectionTimer);
    clearTimeout(this.#firstFrameTimer);
    this.#connectionTimer = undefined;
    this.#firstFrameTimer = undefined;
    this.releaseControl("teardown");
    this.#closed = true;
    this.#abort.abort();
    this.#pending = undefined;
    this.#inputAuthority = undefined;
    this.#clearHeldInput();
    this.#geometry = undefined;
    this.#releasingEpoch = undefined;
    this.#resumeAfterRelease = false;
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
      || this.#releasingEpoch !== undefined
      || this.#runtimeGeneration === undefined
    ) return;
    clearTimeout(this.#connectionTimer);
    this.#connectionTimer = undefined;
    this.#control.send(JSON.stringify({
      version: SCREEN_PROJECTION_PROTOCOL_VERSION,
      type: "view",
      surfaceId: this.owner.surfaceId,
      runtimeGeneration: this.#runtimeGeneration,
      mode: this.#desiredMode,
    }));
    this.callbacks.onState(this.#desiredMode);
    if (!this.#receivedFrame && this.#firstFrameTimer === undefined) {
      this.#firstFrameTimer = window.setTimeout(
        () => this.#fail("No image arrived from the Bot Screen."),
        FIRST_FRAME_TIMEOUT_MS,
      );
    }
  }

  #receiveInputAuthority(raw: unknown): void {
    if (this.#closed || typeof raw !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const authority = ScreenInputAuthorityMessageDto.safeParse(parsed);
    if (
      !authority.success
      || authority.data.surfaceId !== this.owner.surfaceId
      || authority.data.runtimeGeneration !== this.#runtimeGeneration
      || !this.#matchesGeometry(authority.data)
    ) return;
    if (!authority.data.active) {
      if (
        this.#inputAuthority?.controllerEpoch === authority.data.controllerEpoch
        || this.#releasingEpoch === authority.data.controllerEpoch
      ) {
        this.#inputAuthority = undefined;
        this.#releasingEpoch = undefined;
        this.#clearHeldInput();
        if (this.#resumeAfterRelease) {
          this.#resumeAfterRelease = false;
          queueMicrotask(() => this.#activate());
        }
      }
      return;
    }
    if (
      this.#inputAuthority !== undefined
      && this.#inputAuthority.controllerEpoch !== authority.data.controllerEpoch
    ) this.#clearHeldInput();
    this.#inputAuthority = authority.data;
    this.#inputSequence = 0;
    this.#releasingEpoch = undefined;
    this.#resumeAfterRelease = false;
  }

  #mapPointer(
    clientX: number,
    clientY: number,
    renderedRect: PointerContentRect,
    clampToContent = false,
  ): { x: number; y: number } | undefined {
    const authority = this.#inputAuthority;
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
  ): boolean {
    return this.#sendInput({ type, ...event });
  }

  #sendInput(event: Record<string, unknown>): boolean {
    const authority = this.#inputAuthority;
    if (
      authority === undefined
      || this.#desiredMode !== "expanded"
      || this.#input.readyState !== "open"
    ) return false;
    this.#input.send(JSON.stringify({
      version: SCREEN_PROJECTION_PROTOCOL_VERSION,
      surfaceId: this.owner.surfaceId,
      runtimeGeneration: authority.runtimeGeneration,
      geometryGeneration: authority.geometryGeneration,
      controllerEpoch: authority.controllerEpoch,
      sequence: ++this.#inputSequence,
      ...event,
    }));
    return true;
  }
  #clearHeldInput(): void {
    this.#heldPointerButtons.clear();
    this.callbacks.onControlRevoked?.();
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
    this.#receivedFrame = true;
    clearTimeout(this.#firstFrameTimer);
    this.#firstFrameTimer = undefined;
    this.callbacks.onFrame(new Blob(pending.chunks, { type: pending.header.mediaType }));
  }

  #armConnectionDeadline(message: string): void {
    if (this.#connectionTimer !== undefined) return;
    this.#connectionTimer = window.setTimeout(() => this.#fail(message), CONNECTION_TIMEOUT_MS);
  }

  #fail(message: string): void {
    if (this.#closed) return;
    this.callbacks.onError(message);
    this.close();
    this.callbacks.onState("unavailable");
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
