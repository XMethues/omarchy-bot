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

interface InstrumentState {
  received: InstrumentFrame[];
  decoded: InstrumentFrame[];
  displayed: InstrumentFrame[];
  pendingInput?: {
    baselineSequence: number;
    baselineSignature: number;
    sentAtMs?: number;
    visibleAtMs?: number;
  };
  armInput(): void;
}

declare global {
  interface Window {
    __botScreenLoad: InstrumentState;
  }
}

export interface BrowserWindowMetric extends BrowserFrameMetric {
  durationMs: number;
  sequences: number[];
  transportSequenceGaps: number;
  decodeDrops: number;
  paintDrops: number;
  captureToBrowserMs: number[];
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
  let pendingHeader: { sequence: number; chunkCount: number; capturedAt?: string } | undefined;
  let chunks = 0;

  const instrument: InstrumentState = {
    received,
    decoded,
    displayed,
    armInput() {
      const baseline = displayed.at(-1);
      if (baseline === undefined) throw new Error("cannot arm input before a browser-painted frame");
      instrument.pendingInput = {
        baselineSequence: baseline.sequence,
        baselineSignature: baseline.signature,
      };
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
    const channel = nativeCreateDataChannel.call(this, label, options);
    if (label === "screen.frames.v1") {
      channel.addEventListener("message", (event: MessageEvent<unknown>) => {
        if (typeof event.data === "string") {
          try {
            const header = JSON.parse(event.data) as { type?: string; sequence?: number; chunkCount?: number; capturedAt?: string };
            pendingHeader = header.type === "frame"
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
    if (label === "screen.input.v1") {
      const nativeSend = channel.send.bind(channel);
      channel.send = (data: string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>): void => {
        const pendingInput = instrument.pendingInput;
        if (typeof data === "string" && pendingInput?.sentAtMs === undefined) {
          try {
            const event = JSON.parse(data) as { type?: string; state?: string };
            if (event.type === "key" && event.state === "pressed" && pendingInput !== undefined) {
              pendingInput.sentAtMs = performance.now();
            }
          } catch {
            // Production client owns validation; instrumentation only timestamps accepted sends.
          }
        }
        if (typeof data === "string") nativeSend(data);
        else if (data instanceof Blob) nativeSend(data);
        else if (data instanceof ArrayBuffer) nativeSend(data);
        else nativeSend(data);
      };
    }
    return channel;
  };

  const observeImage = async (image: HTMLImageElement): Promise<void> => {
    const url = image.src;
    const frame = frameByUrl.get(url);
    if (frame === undefined || processedUrls.has(url)) return;
    processedUrls.add(url);
    try {
      await image.decode();
      if (image.src !== url) return;
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

  const scan = (): void => {
    const expanded = document.querySelector<HTMLImageElement>('[data-testid="expanded-web-control"] img');
    const preview = document.querySelector<HTMLImageElement>('img[data-testid="computer-preview"]');
    const image = expanded ?? preview;
    if (image !== null) void observeImage(image);
  };
  addEventListener("DOMContentLoaded", () => {
    new MutationObserver(scan).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["src"],
      childList: true,
      subtree: true,
    });
    scan();
  }, { once: true });
}

export class BrowserSurfaceSession {
  #windowStartedAtMs?: number;

  private constructor(
    readonly owner: BrowserOwner,
    readonly lanEndpoint: string,
    readonly projectionSessionId: string,
    private readonly page: Page,
    private readonly context: BrowserContext,
  ) {}

  static async open(browser: Browser, lanEndpoint: string, owner: BrowserOwner): Promise<BrowserSurfaceSession> {
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
    const answer = await (await projectionResponse).json() as { sessionId?: unknown };
    if (typeof answer.sessionId !== "string") throw new Error("final web client projection answer lacked a session id");
    await page.getByTestId("computer-preview").waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForFunction(() => window.__botScreenLoad.displayed.length > 0);
    return new BrowserSurfaceSession(owner, lanEndpoint, answer.sessionId, page, context);
  }

  async expand(): Promise<void> {
    await this.page.getByTestId("computer-preview-expand").click();
    await this.page.getByTestId("expanded-web-control").waitFor({ state: "visible", timeout: 10_000 });
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
    if (!sent) throw new Error("Web Control did not send browser input");
    await afterWebInputSent?.();
    try {
      await this.page.waitForFunction(() => {
        const input = window.__botScreenLoad.pendingInput;
        return input?.sentAtMs !== undefined && input.visibleAtMs !== undefined;
      }, undefined, { timeout: 5_000 });
    } catch {
      const diagnostics = await this.page.evaluate(() => ({
        input: window.__botScreenLoad.pendingInput,
        received: window.__botScreenLoad.received.slice(-5),
        decoded: window.__botScreenLoad.decoded.slice(-5),
        displayed: window.__botScreenLoad.displayed.slice(-5),
      }));
      throw new Error(`browser input did not produce painted feedback: ${JSON.stringify(diagnostics)}`);
    }
    return this.page.evaluate(() => {
      const input = window.__botScreenLoad.pendingInput;
      if (input?.sentAtMs === undefined || input.visibleAtMs === undefined) throw new Error("input was not browser-visible");
      return input.visibleAtMs - input.sentAtMs;
    });
  }

  async startWindow(): Promise<void> {
    this.#windowStartedAtMs = await this.page.evaluate(() => performance.now());
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

  async finishWindow(sequenceWindow?: {
    afterSequence: number;
    throughSequence: number;
    durationMs: number;
  }): Promise<BrowserWindowMetric> {
    const startedAtMs = this.#windowStartedAtMs;
    if (startedAtMs === undefined) throw new Error("browser measurement window was not started");
    if (
      sequenceWindow !== undefined
      && sequenceWindow.throughSequence > sequenceWindow.afterSequence
    ) {
      await this.page.waitForFunction(
        (throughSequence) => window.__botScreenLoad.received.some((frame) => frame.sequence >= throughSequence),
        sequenceWindow.throughSequence,
        { timeout: 2_000 },
      ).catch(() => undefined);
      await this.page.evaluate(() => new Promise<void>((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve, 0))
      ));
    }
    const surfaceId: string = this.owner.surfaceId;
    const lanEndpoint = this.lanEndpoint;
    return this.page.evaluate(({ start, surfaceId, lanEndpoint, sequenceWindow }) => {
      const state = window.__botScreenLoad;
      const endedAtMs = performance.now();
      const durationMs = sequenceWindow?.durationMs ?? endedAtMs - start;
      const received = sequenceWindow === undefined
        ? state.received.filter((frame) => frame.receivedAtMs >= start && frame.receivedAtMs <= endedAtMs)
        : state.received.filter((frame) =>
          frame.sequence > sequenceWindow.afterSequence && frame.sequence <= sequenceWindow.throughSequence
        );
      const decoded = sequenceWindow === undefined
        ? received.filter((frame) => (frame.decodedAtMs ?? -1) >= start && (frame.decodedAtMs ?? Infinity) <= endedAtMs)
        : received.filter((frame) => frame.decodedAtMs !== undefined);
      const displayed = sequenceWindow === undefined
        ? received.filter((frame) => (frame.displayedAtMs ?? -1) >= start && (frame.displayedAtMs ?? Infinity) <= endedAtMs)
        : received.filter((frame) => frame.displayedAtMs !== undefined);
      const sequences = [...new Set(received.map((frame) => frame.sequence))].sort((left, right) => left - right);
      const transportSequenceGaps = sequenceWindow === undefined
        ? sequences.slice(1).reduce((gaps, sequence, index) =>
          gaps + Math.max(0, sequence - sequences[index]! - 1), 0)
        : Math.max(0, sequenceWindow.throughSequence - sequenceWindow.afterSequence - sequences.length);
      const seconds = durationMs / 1_000;
      return {
        surfaceId,
        lanEndpoint,
        finalWebClient: true as const,
        durationMs: Number(durationMs.toFixed(2)),
        sequences,
        transportSequenceGaps,
        receivedFrames: received.length,
        decodedFrames: decoded.length,
        displayedFrames: displayed.length,
        decodeDrops: received.length - decoded.length,
        paintDrops: decoded.length - displayed.length,
        receivedFps: Number((received.length / seconds).toFixed(2)),
        decodedFps: Number((decoded.length / seconds).toFixed(2)),
        displayedFps: Number((displayed.length / seconds).toFixed(2)),
        captureToBrowserMs: displayed.flatMap((frame) =>
          frame.captureToBrowserMs === undefined ? [] : [Number(frame.captureToBrowserMs.toFixed(2))]
        ),
      };
    }, { start: startedAtMs, surfaceId, lanEndpoint, sequenceWindow });
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
  ) {
    this.#browser = browser;
    this.#proxy = proxy;
    this.lanEndpoint = lanEndpoint;
    this.lanInterface = lanInterface;
    this.browserName = browserName;
    this.#tlsRoot = tlsRoot;
  }

  static async start(upstreamBaseUrl: string): Promise<FinalWebBrowserHarness> {
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
      );
    } catch (error) {
      proxy.stop(true);
      rmSync(tlsRoot, { recursive: true, force: true });
      throw error;
    }
  }

  open(owner: BrowserOwner): Promise<BrowserSurfaceSession> {
    return BrowserSurfaceSession.open(this.#browser, this.lanEndpoint, owner);
  }

  async close(): Promise<void> {
    await this.#browser.close();
    this.#proxy.stop(true);
    rmSync(this.#tlsRoot, { recursive: true, force: true });
  }
}
