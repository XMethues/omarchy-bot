import {
  SCREEN_CONTROL_CHANNEL,
  SCREEN_H264_CLOCK_RATE,
  SCREEN_H264_PROFILE,
  SCREEN_INPUT_CHANNEL,
  SCREEN_PREVIEW_CHANNEL,
  SCREEN_PROJECTION_PROTOCOL_VERSION,
  ScreenInputAuthorityMessageDto,
  ScreenKeyCodeDto,
  ScreenProjectionAnswerDto,
  ScreenProjectionFailureMessageDto,
  ScreenProjectionPreviewFrameHeaderDto,
  type ScreenProjectionBrowserMetricsDto,
  type ScreenProjectionFailureReasonDto,
  type ScreenProjectionPreviewFrameHeaderDto as PreviewFrameHeader,
  type ScreenInputAuthorityMessageDto as InputAuthority,
  type ScreenProjectionModeDto,
} from "@omarchy-bot/protocol";

const MAX_FRAME_BYTES = 8 * 1024 * 1024;

const FAILURE_MESSAGES: Record<ScreenProjectionFailureReasonDto, string> = {
  "unsupported-h264": "This browser does not support H.264 Web Control.",
  "missing-first-frame": "No current frame arrived from the Bot Screen.",
  "capture-failed": "The Bot Screen capture helper stopped producing frames.",
  "encoder-failed": "The Bot Screen video encoder failed.",
  "transport-failed": "The screen connection was lost.",
  "decode-failed": "The browser could not decode the Bot Screen video.",
};
const CONNECTION_TIMEOUT_MS = 10_000;
const FIRST_FRAME_TIMEOUT_MS = 5_000;

export type ScreenProjectionMode = Exclude<ScreenProjectionModeDto, "idle">;
export type ScreenProjectionState =
  "connecting" | "preview" | "expanded" | "reconnecting" | "snapshot" | "unavailable" | "closed";

export interface ScreenProjectionOwner {
  botId: string;
  surfaceId: string;
}

export interface ScreenProjectionFailure {
  surfaceId: string;
  reason: ScreenProjectionFailureReasonDto;
  message: string;
  snapshotAvailable: boolean;
}

export interface ScreenProjectionCallbacks {
  onState(state: ScreenProjectionState): void;
  onFrame(frame: Blob | undefined): void;
  onVideo(stream: MediaStream | undefined): void;
  onError(error: string): void;
  onFailure?(failure: ScreenProjectionFailure): void;
  onReconnectRequested?(): void;
  onControlStateChange?(active: boolean): void;
  onControlRevoked?(): void;
}


interface PendingFrame {
  header: PreviewFrameHeader;
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
  readonly #preview: RTCDataChannel;
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
  #receivedPreview = false;
  #inputAuthority: InputAuthority | undefined;
  #offeredInputAuthority: InputAuthority | undefined;
  #videoStream: MediaStream | undefined;
  #videoReady = false;
  readonly #h264Available: boolean;
  #inputSequence = 0;
  #releasingEpoch: number | undefined;
  #resumeAfterRelease = false;
  #geometry: ProjectionGeometry | undefined;
  readonly #heldPointerButtons = new Set<PointerButton>();
  #browserMetrics: ScreenProjectionBrowserMetricsDto = {
    browserReceives: 0,
    browserDecodes: 0,
    browserPaints: 0,
    decodeDrops: 0,
    paintDrops: 0,
    captureToPaintLatencySamples: 0,
    captureToPaintLatencyTotalMs: 0,
    captureToPaintLatencyMaxMs: 0,
  };
  #lastMetricsSentAt = 0;
  #reconnectRequested = false;

  constructor(
    private readonly endpoint: string,
    private readonly owner: ScreenProjectionOwner,
    private readonly callbacks: ScreenProjectionCallbacks,
  ) {
    this.#preview = this.#peer.createDataChannel(SCREEN_PREVIEW_CHANNEL, { ordered: true });
    this.#preview.binaryType = "arraybuffer";
    this.#control = this.#peer.createDataChannel(SCREEN_CONTROL_CHANNEL, { ordered: true });
    this.#input = this.#peer.createDataChannel(SCREEN_INPUT_CHANNEL, { ordered: true });
    this.#preview.addEventListener("message", (event) => this.#receive(event.data));
    this.#input.addEventListener("message", (event) => this.#receiveInputAuthority(event.data));
    this.#control.addEventListener("message", (event) => this.#receiveProjectionFailure(event.data));
    this.#control.addEventListener("open", () => this.#activate());
    const transceiver = this.#peer.addTransceiver("video", { direction: "recvonly" });
    const h264Codecs = RTCRtpReceiver.getCapabilities("video")?.codecs.filter((codec) =>
      codec.mimeType.toLowerCase() === "video/h264"
      && new RegExp(`profile-level-id=${SCREEN_H264_PROFILE}(?:;|$)`, "i").test(codec.sdpFmtpLine ?? "")
      && /(?:^|;)packetization-mode=1(?:;|$)/i.test(codec.sdpFmtpLine ?? "")
    ) ?? [];
    this.#h264Available = h264Codecs.length > 0;
    if (this.#h264Available) transceiver.setCodecPreferences(h264Codecs);
    this.#peer.addEventListener("track", (event) => {
      if (this.#closed || event.track.kind !== "video") return;
      this.#videoStream = event.streams[0] ?? new MediaStream([event.track]);
      this.#videoReady = false;
      event.track.addEventListener("ended", () => {
        if (!this.#closed) this.#requestReconnect();
      }, { once: true });
      this.callbacks.onVideo(this.#videoStream);
    });
    this.#peer.addEventListener("connectionstatechange", () => {
      if (this.#closed) return;
      if (this.#peer.connectionState === "disconnected") {
        this.#requestReconnect();
      } else if (this.#peer.connectionState === "connected") {
        this.#reconnectRequested = false;
        this.#activate();
      } else if (this.#peer.connectionState === "failed") {
        this.#fail("transport-failed", "Couldn’t connect to the Bot Screen.");
      }
    });
  }

  async connect(): Promise<void> {
    this.callbacks.onState("connecting");
    this.#armConnectionDeadline("Couldn’t connect to the Bot Screen.");
    if (!this.#h264Available) {
      this.#fail("unsupported-h264", "This browser does not support H.264 Web Control.");
      return;
    }
    let failureReason: ScreenProjectionFailureReasonDto = "transport-failed";
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
        body: JSON.stringify({
          version: SCREEN_PROJECTION_PROTOCOL_VERSION,
          type: "offer",
          sdp: localDescription.sdp,
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
        }),
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
        if (
          rawAnswer !== null
          && typeof rawAnswer === "object"
          && "failure" in rawAnswer
          && rawAnswer.failure === "unsupported-h264"
        ) failureReason = "unsupported-h264";
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
      this.#fail(
        failureReason,
        error instanceof Error ? error.message : "Couldn’t connect to the Bot Screen.",
      );
    }
  }

  setMode(mode: ScreenProjectionMode): void {
    if (this.#desiredMode !== mode) {
      if (this.#inputAuthority !== undefined) this.callbacks.onControlStateChange?.(false);
      this.#inputAuthority = undefined;
      this.#offeredInputAuthority = undefined;
      this.#releasingEpoch = undefined;
      this.#resumeAfterRelease = false;
      this.#videoReady = false;
      this.#clearHeldInput();
    }
    this.#desiredMode = mode;
    this.#activate();
  }

  /** Makes input interactive only after a correctly sized H.264 frame was browser-painted. */
  videoFramePainted(
    videoWidth: number,
    videoHeight: number,
    metadata?: { captureTime?: number; paintedAt?: number },
  ): boolean {
    const geometry = this.#geometry;
    if (
      this.#closed
      || this.#desiredMode !== "expanded"
      || this.#videoStream === undefined
      || geometry === undefined
    ) return false;
    if (videoWidth !== geometry.videoWidth || videoHeight !== geometry.videoHeight) {
      this.#fail("decode-failed", "The Bot Screen video did not match its current geometry.");
      return false;
    }
    this.#videoReady = true;
    clearTimeout(this.#firstFrameTimer);
    this.#firstFrameTimer = undefined;
    this.callbacks.onState("expanded");
    this.#publishInputAuthority();
    this.#browserMetrics.browserPaints += 1;
    const paintedAt = metadata?.paintedAt ?? performance.now();
    if (metadata?.captureTime !== undefined && metadata.captureTime <= paintedAt) {
      const latency = paintedAt - metadata.captureTime;
      this.#browserMetrics.captureToPaintLatencySamples += 1;
      this.#browserMetrics.captureToPaintLatencyTotalMs += latency;
      this.#browserMetrics.captureToPaintLatencyMaxMs = Math.max(
        this.#browserMetrics.captureToPaintLatencyMaxMs,
        latency,
      );
    }
    void this.#sampleBrowserMetrics();
    return true;
  }

  videoDecodeFailed(): void {
    if (!this.#closed && this.#desiredMode === "expanded") {
      this.#fail("decode-failed", "The browser could not decode the Bot Screen video.");
    }
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

  suspend(reason: "visibility-loss" | "navigation" | "teardown"): void {
    if (this.#closed) return;
    this.releaseControl(reason);
    clearTimeout(this.#firstFrameTimer);
    this.#firstFrameTimer = undefined;
    this.#videoReady = false;
    if (this.#control.readyState === "open" && this.#runtimeGeneration !== undefined) {
      this.#control.send(JSON.stringify({
        version: SCREEN_PROJECTION_PROTOCOL_VERSION,
        type: "view",
        surfaceId: this.owner.surfaceId,
        runtimeGeneration: this.#runtimeGeneration,
        mode: "idle",
      }));
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
    if (this.#inputAuthority !== undefined) this.callbacks.onControlStateChange?.(false);
    this.#inputAuthority = undefined;
    this.#offeredInputAuthority = undefined;
    this.#clearHeldInput();
    this.#geometry = undefined;
    this.#videoStream = undefined;
    this.#videoReady = false;
    this.#releasingEpoch = undefined;
    this.#resumeAfterRelease = false;
    this.callbacks.onFrame(undefined);
    this.callbacks.onVideo(undefined);
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
    this.#preview.close();
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
    if (this.#desiredMode === "preview") {
      this.callbacks.onState("preview");
      if (this.#receivedPreview) return;
    } else if (this.#videoReady) {
      this.callbacks.onState("expanded");
      return;
    } else {
      this.callbacks.onState("connecting");
    }
    if (this.#firstFrameTimer === undefined) {
      this.#firstFrameTimer = window.setTimeout(
        () => this.#fail(
          "missing-first-frame",
          this.#desiredMode === "expanded"
            ? "No H.264 video arrived from the Bot Screen."
            : "No image arrived from the Bot Screen.",
        ),
        FIRST_FRAME_TIMEOUT_MS,
      );
    }
  }

  #receiveProjectionFailure(raw: unknown): void {
    if (this.#closed || typeof raw !== "string") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const failure = ScreenProjectionFailureMessageDto.safeParse(parsed);
    if (
      !failure.success
      || failure.data.surfaceId !== this.owner.surfaceId
      || failure.data.runtimeGeneration !== this.#runtimeGeneration
    ) return;
    this.#fail(failure.data.reason, FAILURE_MESSAGES[failure.data.reason]);
  }

  #requestReconnect(): void {
    if (this.#closed || this.#reconnectRequested) return;
    this.#reconnectRequested = true;
    this.releaseControl("teardown");
    clearTimeout(this.#firstFrameTimer);
    this.#firstFrameTimer = undefined;
    this.#pending = undefined;
    this.#receivedPreview = false;
    this.#videoReady = false;
    this.#offeredInputAuthority = undefined;
    this.callbacks.onFrame(undefined);
    this.callbacks.onVideo(undefined);
    this.callbacks.onState("reconnecting");
    if (this.callbacks.onReconnectRequested !== undefined) {
      queueMicrotask(() => {
        if (!this.#closed) this.callbacks.onReconnectRequested?.();
      });
    } else {
      this.#armConnectionDeadline("The screen connection was lost.");
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
        || this.#offeredInputAuthority?.controllerEpoch === authority.data.controllerEpoch
        || this.#releasingEpoch === authority.data.controllerEpoch
      ) {
        if (this.#inputAuthority !== undefined) this.callbacks.onControlStateChange?.(false);
        this.#inputAuthority = undefined;
        this.#offeredInputAuthority = undefined;
        this.#releasingEpoch = undefined;
        this.#clearHeldInput();
        if (this.#resumeAfterRelease) {
          this.#resumeAfterRelease = false;
          queueMicrotask(() => this.#activate());
        }
      }
      return;
    }
    this.#offeredInputAuthority = authority.data;
    this.#publishInputAuthority();
  }

  #publishInputAuthority(): void {
    const authority = this.#offeredInputAuthority;
    if (authority === undefined || this.#desiredMode !== "expanded" || !this.#videoReady) return;
    if (this.#inputAuthority?.controllerEpoch === authority.controllerEpoch) return;
    if (this.#inputAuthority !== undefined) this.#clearHeldInput();
    this.callbacks.onControlStateChange?.(true);
    this.#inputAuthority = authority;
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
    if (this.#closed || this.#desiredMode !== "preview") return;
    if (typeof raw === "string") {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.#pending = undefined;
        return;
      }
      const header = ScreenProjectionPreviewFrameHeaderDto.safeParse(parsed);
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
    this.#receivedPreview = true;
    clearTimeout(this.#firstFrameTimer);
    this.#firstFrameTimer = undefined;
    this.callbacks.onFrame(new Blob(pending.chunks, { type: pending.header.mediaType }));
  }

  #armConnectionDeadline(message: string): void {
    if (this.#connectionTimer !== undefined) return;
    this.#connectionTimer = window.setTimeout(
      () => this.#fail("transport-failed", message),
      CONNECTION_TIMEOUT_MS,
    );
  }

  async #sampleBrowserMetrics(): Promise<void> {
    const getStats = this.#peer.getStats;
    if (typeof getStats === "function") {
      try {
        const report = await getStats.call(this.#peer);
        report.forEach((entry) => {
          const metric = entry as RTCStats & {
            kind?: string;
            mediaType?: string;
            framesReceived?: number;
            framesDecoded?: number;
            framesDropped?: number;
          };
          if (
            metric.type !== "inbound-rtp"
            || (metric.kind ?? metric.mediaType) !== "video"
          ) return;
          this.#browserMetrics.browserReceives = Math.max(
            this.#browserMetrics.browserReceives,
            metric.framesReceived ?? 0,
          );
          this.#browserMetrics.browserDecodes = Math.max(
            this.#browserMetrics.browserDecodes,
            metric.framesDecoded ?? 0,
          );
          this.#browserMetrics.decodeDrops = Math.max(
            this.#browserMetrics.decodeDrops,
            metric.framesDropped ?? 0,
          );
        });
      } catch {
        // Browser stats are diagnostic only and never interrupt Screen Projection.
      }
    }
    this.#browserMetrics.browserReceives = Math.max(
      this.#browserMetrics.browserReceives,
      this.#browserMetrics.browserPaints,
    );
    this.#browserMetrics.browserDecodes = Math.max(
      this.#browserMetrics.browserDecodes,
      this.#browserMetrics.browserPaints,
    );
    this.#browserMetrics.paintDrops = Math.max(
      this.#browserMetrics.paintDrops,
      this.#browserMetrics.browserDecodes - this.#browserMetrics.browserPaints,
    );
    const now = performance.now();
    if (
      now - this.#lastMetricsSentAt < 1_000
      || this.#control.readyState !== "open"
      || this.#control.bufferedAmount > 0
      || this.#runtimeGeneration === undefined
    ) return;
    try {
      this.#control.send(JSON.stringify({
        version: SCREEN_PROJECTION_PROTOCOL_VERSION,
        type: "browser-metrics",
        surfaceId: this.owner.surfaceId,
        runtimeGeneration: this.#runtimeGeneration,
        metrics: this.#browserMetrics,
      }));
      this.#lastMetricsSentAt = now;
    } catch {
      // A closing metrics channel must not delay control or change Surface state.
    }
  }

  #fail(reason: ScreenProjectionFailureReasonDto, message: string): void {
    if (this.#closed) return;
    this.callbacks.onError(message);
    this.close();
    void this.#loadSnapshotFallback(reason, message);
  }

  async #loadSnapshotFallback(
    reason: ScreenProjectionFailureReasonDto,
    message: string,
  ): Promise<void> {
    const snapshot = new URL(this.endpoint, window.location.href);
    snapshot.pathname = snapshot.pathname.replace(/\/projection$/, "/snapshot");
    let snapshotAvailable = false;
    try {
      const response = await fetch(snapshot);
      if (!response.ok || response.headers.get("content-type") !== "image/png") throw new Error();
      this.callbacks.onFrame(await response.blob());
      snapshotAvailable = true;
    } catch {
      this.callbacks.onFrame(undefined);
    }
    this.callbacks.onFailure?.({
      surfaceId: this.owner.surfaceId,
      reason,
      message,
      snapshotAvailable,
    });
    this.callbacks.onState(snapshotAvailable ? "snapshot" : "unavailable");
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
