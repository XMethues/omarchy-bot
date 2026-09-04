import type { Server } from "bun";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os, { type NetworkInterfaceInfo } from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import type { SurfaceId } from "../../../packages/domain/src/ids.ts";
import type { BrowserFrameMetric } from "./bot-screen-capacity-report.ts";

interface BrowserOwner {
  botId: string;
  surfaceId: SurfaceId;
}

interface InstrumentFrame {
  sequence: number;
  signature: number;
  capturedAtEpochMs: number | null;
  receivedAtMs: number;
  decodedAtMs?: number;
  displayedAtMs?: number;
  captureToBrowserMs?: number;
}

interface VideoStats {
  framesReceived: number;
  framesDecoded: number;
  framesDropped: number;
  packetsLost: number;
}

interface InstrumentState {
  received: InstrumentFrame[];
  decoded: InstrumentFrame[];
  displayed: InstrumentFrame[];
  inputAuthorityMessages: Array<{ active: boolean; controllerEpoch: number; receivedAtMs: number }>;
  inputAuthorityActive: boolean;
  sentInputMessages: Array<{ type: string | null; state?: string; reason?: string; sentAtMs: number }>;
  pendingInput?: {
    baselineSequence: number;
    baselineSignature: number;
    sentAtMs?: number;
    visibleAtMs?: number;
  };
  armInput(): void;
  sampleVideoStats(): Promise<VideoStats>;
}

declare global {
  interface Window {
    __botScreenLoad: InstrumentState;
  }
}

export interface BrowserWindowMetric extends BrowserFrameMetric {
  durationMs: number;
  renderingSequences: number[];
  transportDrops: number;
  decodeDrops: number;
  paintDrops: number;
  captureToBrowserMs: number[];
  pipelineBoundary: {
    start: { received: number; decoded: number; dropped: number; displayed: number };
    end: { received: number; decoded: number; dropped: number; displayed: number };
  };
}

export function selectNonLoopbackLanAddress(
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>,
  requestedInterface?: string,
): { interfaceName: string; address: string } {
  if (requestedInterface !== undefined && interfaces[requestedInterface] === undefined) {
    throw new Error(`OMARCHY_BOT_LOAD_LAN_INTERFACE ${requestedInterface} does not exist`);
  }
  const virtualInterface = /^(?:br-|docker|podman|tailscale|veth|virbr|vmnet|wg)/;
  const candidates = Object.entries(interfaces)
    .filter(([name]) => requestedInterface === undefined || name === requestedInterface)
    .flatMap(([interfaceName, entries]) => (entries ?? []).map((entry) => ({ interfaceName, entry })))
    .filter(({ interfaceName, entry }) =>
      !virtualInterface.test(interfaceName)
      && entry.family === "IPv4"
      && !entry.internal
      && !entry.address.startsWith("127.")
    )
    .sort((left, right) =>
      left.interfaceName.localeCompare(right.interfaceName) || left.entry.address.localeCompare(right.entry.address)
    );
  const selected = candidates[0];
  if (selected === undefined) {
    throw new Error("the browser load harness requires a non-loopback IPv4 LAN interface");
  }
  return { interfaceName: selected.interfaceName, address: selected.entry.address };
}

export async function buildFinalWebClient(projectRoot: string): Promise<void> {
  const build = Bun.spawn(["bun", "run", "--filter=@omarchy-bot/web", "build"], {
    cwd: projectRoot,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  const status = await build.exited;
  const index = path.join(projectRoot, "apps/web/dist/index.html");
  if (status !== 0 || !existsSync(index)) {
    throw new Error(`final web client build failed with status ${status}`);
  }
}

function installBrowserInstrumentation(): void {
  const received: InstrumentFrame[] = [];
  const decoded: InstrumentFrame[] = [];
  const displayed: InstrumentFrame[] = [];
  const awaitingBlob: InstrumentFrame[] = [];
  const frameByUrl = new Map<string, InstrumentFrame>();
  const processedUrls = new Set<string>();
  const observedVideos = new WeakSet<HTMLVideoElement>();
  const peerConnections = new Set<RTCPeerConnection>();
  let videoSequence = 0;
  let pendingHeader: { sequence: number; chunkCount: number; capturedAt?: string } | undefined;
  let chunks = 0;

  const instrument: InstrumentState = {
    received,
    decoded,
    displayed,
    inputAuthorityMessages: [],
    inputAuthorityActive: false,
    sentInputMessages: [],
    armInput() {
      const baseline = displayed.at(-1);
      if (baseline === undefined) throw new Error("cannot arm input before a browser-painted frame");
      instrument.pendingInput = {
        baselineSequence: baseline.sequence,
        baselineSignature: baseline.signature,
      };
    },
    async sampleVideoStats() {
      const totals: VideoStats = {
        framesReceived: 0,
        framesDecoded: 0,
        framesDropped: 0,
        packetsLost: 0,
      };
      for (const peer of peerConnections) {
        const report = await peer.getStats();
        report.forEach((entry) => {
          const metric = entry as RTCStats & {
            kind?: string;
            mediaType?: string;
            framesReceived?: number;
            framesDecoded?: number;
            framesDropped?: number;
            packetsLost?: number;
          };
          if (
            metric.type !== "inbound-rtp"
            || (metric.kind ?? metric.mediaType) !== "video"
          ) return;
          totals.framesReceived += metric.framesReceived ?? 0;
          totals.framesDecoded += metric.framesDecoded ?? 0;
          totals.framesDropped += metric.framesDropped ?? 0;
          totals.packetsLost += Math.max(0, metric.packetsLost ?? 0);
        });
      }
      return totals;
    },
  };
  Object.defineProperty(window, "__botScreenLoad", { value: instrument });

  const nativeCreateObjectUrl = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (blob: Blob): string => {
    const url = nativeCreateObjectUrl(blob);
    const frame = awaitingBlob.shift();
    if (frame !== undefined) frameByUrl.set(url, frame);
    return url;
  };

  const nativeCreateDataChannel = RTCPeerConnection.prototype.createDataChannel;
  RTCPeerConnection.prototype.createDataChannel = function(label, options): RTCDataChannel {
    peerConnections.add(this);
    const channel = nativeCreateDataChannel.call(this, label, options);
    if (label === "screen.preview.v2") {
      channel.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (typeof event.data === "string") {
          try {
            const header = JSON.parse(event.data) as { type?: string; sequence?: number; chunkCount?: number; capturedAt?: string };
            pendingHeader = header.type === "preview-frame"
              && typeof header.sequence === "number"
              && typeof header.chunkCount === "number"
              ? { sequence: header.sequence, chunkCount: header.chunkCount, ...(header.capturedAt === undefined ? {} : { capturedAt: header.capturedAt }) }
              : undefined;
            chunks = 0;
          } catch {
            pendingHeader = undefined;
          }
          return;
        }
        if (pendingHeader === undefined || !(event.data instanceof ArrayBuffer)) return;
        chunks += 1;
        if (chunks !== pendingHeader.chunkCount) return;
        const capturedAtEpochMs = pendingHeader.capturedAt === undefined ? null : Date.parse(pendingHeader.capturedAt);
        const frame: InstrumentFrame = {
          sequence: pendingHeader.sequence,
          signature: 0,
          capturedAtEpochMs: Number.isFinite(capturedAtEpochMs) ? capturedAtEpochMs : null,
          receivedAtMs: performance.now(),
        };
        received.push(frame);
        awaitingBlob.push(frame);
        pendingHeader = undefined;
        chunks = 0;
      });
    }
    if (label === "screen.input.v2") {
      channel.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (typeof event.data !== "string") return;
        try {
          const message = JSON.parse(event.data) as {
            type?: string;
            active?: boolean;
            controllerEpoch?: number;
          };
          if (
            message.type !== "input-authority"
            || typeof message.active !== "boolean"
            || typeof message.controllerEpoch !== "number"
          ) return;
          instrument.inputAuthorityActive = message.active;
          instrument.inputAuthorityMessages.push({
            active: message.active,
            controllerEpoch: message.controllerEpoch,
            receivedAtMs: performance.now(),
          });
        } catch {
          // Production client owns validation; instrumentation records only valid authority messages.
        }
      });
      const nativeSend = channel.send.bind(channel);
      channel.send = (data: string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>): void => {
        const pendingInput = instrument.pendingInput;
        if (typeof data === "string") {
          try {
            const event = JSON.parse(data) as { type?: string; state?: string; reason?: string };
            instrument.sentInputMessages.push({
              type: event.type ?? null,
              ...(event.state === undefined ? {} : { state: event.state }),
              ...(event.reason === undefined ? {} : { reason: event.reason }),
              sentAtMs: performance.now(),
            });
            if (
              event.type === "key"
              && event.state === "pressed"
              && pendingInput !== undefined
              && pendingInput.sentAtMs === undefined
            ) pendingInput.sentAtMs = performance.now();
          } catch {
            // Production client owns validation; instrumentation timestamps parseable sends.
          }
          nativeSend(data);
        } else if (data instanceof Blob) nativeSend(data);
        else if (data instanceof ArrayBuffer) nativeSend(data);
        else nativeSend(data);
      };
    }
    return channel;
  };

  const observeImage = async (image: HTMLImageElement): Promise<void> => {
    const url = image.src;
    const frame = frameByUrl.get(url)
      ?? received.findLast((candidate) => candidate.decodedAtMs === undefined);
    if (frame === undefined || processedUrls.has(url)) return;
    try {
      await image.decode();
      if (image.src !== url) return;
      processedUrls.add(url);
      frame.decodedAtMs = performance.now();
      decoded.push(frame);
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      if (image.src !== url) return;
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context === null) return;
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let signature = 2166136261;
      for (let index = 0; index < pixels.length; index += 16) {
        signature ^= pixels[index]!;
        signature = Math.imul(signature, 16777619);
      }
      frame.signature = signature >>> 0;
      frame.displayedAtMs = performance.now();
      if (frame.capturedAtEpochMs !== null) {
        frame.captureToBrowserMs = Date.now() - frame.capturedAtEpochMs;
      }
      displayed.push(frame);
      const input = instrument.pendingInput;
      if (
        input?.sentAtMs !== undefined
        && input.visibleAtMs === undefined
        && frame.sequence > input.baselineSequence
        && frame.signature !== input.baselineSignature
      ) input.visibleAtMs = frame.displayedAtMs;
    } catch {
      // A newer frame may revoke this Blob URL before decode/paint; that frame is
      // intentionally not counted as browser-visible.
    }
  };

  const observeVideo = (video: HTMLVideoElement): void => {
    if (observedVideos.has(video)) return;
    observedVideos.add(video);
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 180;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) return;
    const paint = (_now: DOMHighResTimeStamp, metadata: VideoFrameCallbackMetadata): void => {
      if (!video.isConnected || video.srcObject === null) return;
      const decodedAtMs = performance.now();
      const frame: InstrumentFrame = {
        sequence: ++videoSequence,
        signature: 0,
        capturedAtEpochMs: null,
        receivedAtMs: decodedAtMs,
        decodedAtMs,
      };
      received.push(frame);
      decoded.push(frame);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let signature = 2166136261;
      for (let index = 0; index < pixels.length; index += 16) {
        signature ^= pixels[index]!;
        signature = Math.imul(signature, 16777619);
      }
      frame.signature = signature >>> 0;
      frame.displayedAtMs = performance.now();
      const captureTime = "captureTime" in metadata ? metadata.captureTime : undefined;
      if (typeof captureTime === "number" && Number.isFinite(captureTime)) {
        frame.captureToBrowserMs = frame.displayedAtMs - captureTime;
      }
      displayed.push(frame);
      const input = instrument.pendingInput;
      if (
        input?.sentAtMs !== undefined
        && input.visibleAtMs === undefined
        && frame.sequence > input.baselineSequence
        && frame.signature !== input.baselineSignature
      ) input.visibleAtMs = frame.displayedAtMs;
      video.requestVideoFrameCallback(paint);
    };
    video.requestVideoFrameCallback(paint);
  };

  const scan = (): void => {
    const video = document.querySelector<HTMLVideoElement>('video[data-testid="computer-expanded-video"]');
    const preview = document.querySelector<HTMLImageElement>('img[data-testid="computer-preview"]');
    if (video !== null) observeVideo(video);
    else if (preview !== null) void observeImage(preview);
  };
  addEventListener("DOMContentLoaded", () => {
    new MutationObserver(scan).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["src"],
      childList: true,
      subtree: true,
    });
    document.addEventListener("load", (event) => {
      if (event.target instanceof HTMLImageElement) void observeImage(event.target);
    }, true);
    scan();
  }, { once: true });
}

type ProjectionFailureLookup = (
  owner: BrowserOwner,
  sessionId: string,
) => unknown;

export class BrowserSurfaceSession {
  #windowStartedAtMs?: number;
  #windowStartedVideoStats?: VideoStats;

  private constructor(
    readonly owner: BrowserOwner,
    readonly lanEndpoint: string,
    readonly projectionSessionId: string,
    private readonly videoWidth: number,
    private readonly videoHeight: number,
    private readonly page: Page,
    private readonly context: BrowserContext,
    private readonly failureLookup?: ProjectionFailureLookup,
  ) {}

  static async open(
    browser: Browser,
    lanEndpoint: string,
    owner: BrowserOwner,
    failureLookup?: ProjectionFailureLookup,
  ): Promise<BrowserSurfaceSession> {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
    });
    const page = await context.newPage();
    await page.addInitScript(installBrowserInstrumentation);
    await page.goto(`${lanEndpoint}/?bot=${encodeURIComponent(owner.botId)}`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("header-computer").waitFor({ state: "visible", timeout: 15_000 });
    try {
      await page.waitForFunction(() =>
        document.querySelector('[data-testid="header-computer"]')?.getAttribute("aria-disabled") !== "true"
      );
    } catch {
      const diagnostics = await page.evaluate(async () => {
        const response = await fetch("/api/bots");
        return {
          status: response.status,
          body: await response.text(),
          page: document.body.innerText.slice(0, 1_000),
        };
      });
      throw new Error(`final web client did not select the Bot: ${JSON.stringify(diagnostics)}`);
    }
    const projectionResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/computer/projection"
        && response.request().method() === "POST"
        && response.status() === 201;
    });
    await page.getByTestId("header-computer").click();
    const answer = await (await projectionResponse).json() as {
      sessionId?: unknown;
      videoWidth?: unknown;
      videoHeight?: unknown;
    };
    if (
      typeof answer.sessionId !== "string"
      || typeof answer.videoWidth !== "number"
      || typeof answer.videoHeight !== "number"
    ) throw new Error("final web client projection answer lacked its media contract");
    const preview = page.getByTestId("computer-preview");
    await preview.waitFor({ state: "visible", timeout: 15_000 });
    try {
      await page.waitForFunction(() => window.__botScreenLoad.displayed.length > 0, undefined, { timeout: 15_000 });
    } catch {
      const pageDiagnostics = await page.evaluate(async ({ botId, surfaceId, sessionId }) => {
        const image = document.querySelector<HTMLImageElement>('img[data-testid="computer-preview"]');
        const response = await fetch(
          `/api/computer/projection?botId=${encodeURIComponent(botId)}&surfaceId=${encodeURIComponent(surfaceId)}&sessionId=${encodeURIComponent(sessionId)}`,
        );
        return {
          instrumentation: {
            received: window.__botScreenLoad.received.length,
            decoded: window.__botScreenLoad.decoded.length,
            displayed: window.__botScreenLoad.displayed.length,
          },
          image: image === null
            ? null
            : {
                srcScheme: (image.currentSrc || image.src).split(":", 1)[0] ?? "",
                srcLength: (image.currentSrc || image.src).length,
                complete: image.complete,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
              },
          projection: {
            status: response.status,
            body: await response.text(),
          },
        };
      }, { botId: owner.botId, surfaceId: owner.surfaceId, sessionId: answer.sessionId });
      const diagnostics = {
        ...pageDiagnostics,
        internalFailure: failureLookup?.(owner, answer.sessionId) ?? null,
      };
      throw new Error(`final web client did not paint Computer Preview: ${JSON.stringify(diagnostics)}`);
    }
    return new BrowserSurfaceSession(
      owner,
      lanEndpoint,
      answer.sessionId,
      answer.videoWidth,
      answer.videoHeight,
      page,
      context,
      failureLookup,
    );
  }

  async expand(): Promise<void> {
    const previewPaints = await this.page.evaluate(() => window.__botScreenLoad.displayed.length);
    await this.page.getByTestId("computer-preview-expand").click();
    await this.page.getByTestId("expanded-web-control").waitFor({ state: "visible", timeout: 10_000 });
    await this.page.waitForFunction(
      ({ width, height, after }) => {
        const video = document.querySelector<HTMLVideoElement>('video[data-testid="computer-expanded-video"]');
        return video?.videoWidth === width
          && video.videoHeight === height
          && window.__botScreenLoad.displayed.length > after
          && window.__botScreenLoad.inputAuthorityActive;
      },
      { width: this.videoWidth, height: this.videoHeight, after: previewPaints },
      { timeout: 10_000 },
    );
  }

  async measureInputToVisible(afterWebInputSent?: () => Promise<void>): Promise<number> {
    await this.page.evaluate(() => {
      window.__botScreenLoad.armInput();
    });
    const control = this.page.getByTestId("expanded-web-control");
    await control.focus();
    let sent = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await this.page.keyboard.press(attempt % 2 === 0 ? "A" : "B");
      sent = await this.page.evaluate(() =>
        window.__botScreenLoad.pendingInput?.sentAtMs !== undefined
      );
      if (sent) break;
      await this.page.waitForTimeout(50);
    }
    if (!sent) {
      const pageDiagnostics = await this.page.evaluate(async ({ botId, surfaceId, sessionId }) => {
        const response = await fetch(
          `/api/computer/projection?botId=${encodeURIComponent(botId)}&surfaceId=${encodeURIComponent(surfaceId)}&sessionId=${encodeURIComponent(sessionId)}`,
        );
        return {
          inputAuthority: {
            active: window.__botScreenLoad.inputAuthorityActive,
            messages: window.__botScreenLoad.inputAuthorityMessages,
          },
          sentInputMessages: window.__botScreenLoad.sentInputMessages,
          projection: {
            status: response.status,
            body: await response.text(),
          },
        };
      }, {
        botId: this.owner.botId,
        surfaceId: this.owner.surfaceId,
        sessionId: this.projectionSessionId,
      });
      const diagnostics = {
        ...pageDiagnostics,
        internalFailure: this.failureLookup?.(this.owner, this.projectionSessionId) ?? null,
      };
      throw new Error(`Web Control did not send browser input: ${JSON.stringify(diagnostics)}`);
    }
    await afterWebInputSent?.();
    try {
      await this.page.waitForFunction(() => {
        const input = window.__botScreenLoad.pendingInput;
        return input?.sentAtMs !== undefined && input.visibleAtMs !== undefined;
      }, undefined, { timeout: 5_000 });
    } catch {
      const pageDiagnostics = await this.page.evaluate(async ({ botId, surfaceId, sessionId }) => {
        const response = await fetch(
          `/api/computer/projection?botId=${encodeURIComponent(botId)}&surfaceId=${encodeURIComponent(surfaceId)}&sessionId=${encodeURIComponent(sessionId)}`,
        );
        return {
          input: window.__botScreenLoad.pendingInput,
          inputAuthority: {
            active: window.__botScreenLoad.inputAuthorityActive,
            messages: window.__botScreenLoad.inputAuthorityMessages,
          },
          sentInputMessages: window.__botScreenLoad.sentInputMessages,
          received: window.__botScreenLoad.received.slice(-5),
          decoded: window.__botScreenLoad.decoded.slice(-5),
          displayed: window.__botScreenLoad.displayed.slice(-5),
          projection: {
            status: response.status,
            body: await response.text(),
          },
        };
      }, {
        botId: this.owner.botId,
        surfaceId: this.owner.surfaceId,
        sessionId: this.projectionSessionId,
      });
      const diagnostics = {
        ...pageDiagnostics,
        internalFailure: this.failureLookup?.(this.owner, this.projectionSessionId) ?? null,
      };
      throw new Error(`browser input did not produce painted feedback: ${JSON.stringify(diagnostics)}`);
    }
    return this.page.evaluate(() => {
      const input = window.__botScreenLoad.pendingInput;
      if (input?.sentAtMs === undefined || input.visibleAtMs === undefined) throw new Error("input was not browser-visible");
      return input.visibleAtMs - input.sentAtMs;
    });
  }

  async startWindow(): Promise<void> {
    const started = await this.page.evaluate(async () => ({
      startedAtMs: performance.now(),
      videoStats: await window.__botScreenLoad.sampleVideoStats(),
    }));
    this.#windowStartedAtMs = started.startedAtMs;
    this.#windowStartedVideoStats = started.videoStats;
  }

  async movePointer(step: number): Promise<void> {
    const control = this.page.getByTestId("expanded-web-control");
    const box = await control.boundingBox();
    if (box === null) return;
    await this.page.mouse.move(
      box.x + 20 + (step * 37) % Math.max(1, box.width - 40),
      box.y + 20 + (step * 19) % Math.max(1, box.height - 40),
    );
    if (step % 4 === 0) await this.page.mouse.wheel(0, step % 8 === 0 ? 240 : -240);
  }

  async finishWindow(videoWindow?: { durationMs: number }): Promise<BrowserWindowMetric> {
    const startedAtMs = this.#windowStartedAtMs;
    if (startedAtMs === undefined) throw new Error("browser measurement window was not started");
    const startVideoStats = this.#windowStartedVideoStats;
    if (startVideoStats === undefined) throw new Error("browser video stats window was not started");
    if (videoWindow !== undefined) {
      await this.page.evaluate(() => new Promise<void>((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve, 0))
      ));
    }
    const surfaceId: string = this.owner.surfaceId;
    const lanEndpoint = this.lanEndpoint;
    return this.page.evaluate(async ({ start, startVideoStats, surfaceId, lanEndpoint, videoWindow }) => {
      const state = window.__botScreenLoad;
      const endedAtMs = performance.now();
      const endVideoStats = await state.sampleVideoStats();
      const durationMs = videoWindow?.durationMs ?? endedAtMs - start;
      const received = state.received.filter((frame) =>
        frame.receivedAtMs >= start && frame.receivedAtMs <= endedAtMs
      );
      const decoded = state.decoded.filter((frame) =>
        (frame.decodedAtMs ?? -1) >= start && (frame.decodedAtMs ?? Infinity) <= endedAtMs
      );
      const displayed = state.displayed.filter((frame) =>
        (frame.displayedAtMs ?? -1) >= start && (frame.displayedAtMs ?? Infinity) <= endedAtMs
      );
      const video = videoWindow !== undefined;
      const receivedFrames = video
        ? endVideoStats.framesReceived - startVideoStats.framesReceived
        : received.length;
      const decodedFrames = video
        ? endVideoStats.framesDecoded - startVideoStats.framesDecoded
        : decoded.length;
      const displayedFrames = displayed.length;
      const renderingSequences = [...new Set(displayed.map((frame) => frame.sequence))]
        .sort((left, right) => left - right);
      const seconds = durationMs / 1_000;
      return {
        surfaceId,
        lanEndpoint,
        finalWebClient: true as const,
        durationMs: Number(durationMs.toFixed(2)),
        renderingSequences,
        pipelineBoundary: {
          start: {
            received: startVideoStats.framesReceived,
            decoded: startVideoStats.framesDecoded,
            dropped: startVideoStats.framesDropped,
            displayed: state.displayed.filter((frame) => (frame.displayedAtMs ?? Infinity) < start).length,
          },
          end: {
            received: endVideoStats.framesReceived,
            decoded: endVideoStats.framesDecoded,
            dropped: endVideoStats.framesDropped,
            displayed: state.displayed.length,
          },
        },
        transportDrops: 0,
        browserFramesDropped: video
          ? endVideoStats.framesDropped - startVideoStats.framesDropped
          : 0,
        packetsLost: video
          ? endVideoStats.packetsLost - startVideoStats.packetsLost
          : 0,
        receivedFrames,
        decodedFrames,
        displayedFrames,
        decodeDrops: receivedFrames - decodedFrames,
        paintDrops: decodedFrames - displayedFrames,
        receivedFps: Number((receivedFrames / seconds).toFixed(2)),
        decodedFps: Number((decodedFrames / seconds).toFixed(2)),
        displayedFps: Number((displayedFrames / seconds).toFixed(2)),
        captureToBrowserMs: displayed.flatMap((frame) =>
          frame.captureToBrowserMs === undefined ? [] : [Number(frame.captureToBrowserMs.toFixed(2))]
        ),
      };
    }, { start: startedAtMs, startVideoStats, surfaceId, lanEndpoint, videoWindow });
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}

export class FinalWebBrowserHarness {
  readonly lanEndpoint: string;
  readonly lanInterface: string;
  readonly browserName: string;
  readonly #browser: Browser;
  readonly #proxy: Server<undefined>;
  readonly #tlsRoot: string;

  private constructor(
    browser: Browser,
    proxy: Server<undefined>,
    lanEndpoint: string,
    lanInterface: string,
    browserName: string,
    tlsRoot: string,
    private readonly failureLookup?: ProjectionFailureLookup,
  ) {
    this.#browser = browser;
    this.#proxy = proxy;
    this.lanEndpoint = lanEndpoint;
    this.lanInterface = lanInterface;
    this.browserName = browserName;
    this.#tlsRoot = tlsRoot;
  }

  static async start(
    upstreamBaseUrl: string,
    failureLookup?: ProjectionFailureLookup,
  ): Promise<FinalWebBrowserHarness> {
    const selected = selectNonLoopbackLanAddress(os.networkInterfaces(), process.env.OMARCHY_BOT_LOAD_LAN_INTERFACE);
    const upstream = new URL(upstreamBaseUrl);
    const tlsRoot = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-screen-load-tls-"));
    const keyPath = path.join(tlsRoot, "key.pem");
    const certificatePath = path.join(tlsRoot, "certificate.pem");
    const openssl = Bun.which("openssl");
    if (openssl === null) {
      rmSync(tlsRoot, { recursive: true, force: true });
      throw new Error("the browser load harness requires openssl for its LAN HTTPS endpoint");
    }
    const certificate = Bun.spawn([
      openssl,
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certificatePath,
      "-days",
      "1",
      "-subj",
      `/CN=${selected.address}`,
      "-addext",
      `subjectAltName=IP:${selected.address}`,
    ], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    if (await certificate.exited !== 0) {
      rmSync(tlsRoot, { recursive: true, force: true });
      throw new Error("could not create the browser load harness LAN certificate");
    }
    const proxy = Bun.serve({
      hostname: selected.address,
      port: 0,
      tls: {
        key: Bun.file(keyPath),
        cert: Bun.file(certificatePath),
      },
      fetch(request) {
        const incoming = new URL(request.url);
        const target = new URL(`${incoming.pathname}${incoming.search}`, upstream);
        return fetch(new Request(target, request));
      },
    });
    const executablePath = process.env.OMARCHY_BOT_LOAD_BROWSER_BIN
      ?? Bun.which("brave")
      ?? Bun.which("chromium")
      ?? Bun.which("chromium-browser");
    if (executablePath === null || executablePath === undefined) {
      proxy.stop(true);
      rmSync(tlsRoot, { recursive: true, force: true });
      throw new Error("the real load harness requires Brave or Chromium");
    }
    try {
      const browser = await chromium.launch({
        executablePath,
        headless: true,
        args: [
          "--disable-background-timer-throttling",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
        ],
      });
      return new FinalWebBrowserHarness(
        browser,
        proxy,
        `https://${selected.address}:${proxy.port}`,
        selected.interfaceName,
        path.basename(executablePath),
        tlsRoot,
        failureLookup,
      );
    } catch (error) {
      proxy.stop(true);
      rmSync(tlsRoot, { recursive: true, force: true });
      throw error;
    }
  }

  open(owner: BrowserOwner): Promise<BrowserSurfaceSession> {
    return BrowserSurfaceSession.open(this.#browser, this.lanEndpoint, owner, this.failureLookup);
  }

  async close(): Promise<void> {
    await this.#browser.close();
    this.#proxy.stop(true);
    rmSync(this.#tlsRoot, { recursive: true, force: true });
  }
}
