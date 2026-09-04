import { expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import rtc, { type DataChannel, type PeerConnection, type Track } from "node-datachannel";
import { BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL } from "../../apps/daemon/src/bootstrap/config.ts";
import type { ProjectionLoadMetrics } from "../../apps/daemon/src/modules/computer/screenProjection.ts";
import type { SurfaceId } from "../../packages/domain/src/ids.ts";
import {
  SCREEN_CONTROL_CHANNEL,
  SCREEN_H264_CLOCK_RATE,
  SCREEN_H264_FMTP,
  SCREEN_H264_PROFILE,
  SCREEN_INPUT_CHANNEL,
  SCREEN_PREVIEW_CHANNEL,
  SCREEN_PROJECTION_PROTOCOL_VERSION,
} from "../../packages/protocol/src/api.ts";
import { api, apiStatus, makeBot, startDaemon, type Harness } from "./helpers/harness.ts";
import {
  buildFinalWebClient,
  FinalWebBrowserHarness,
  type BrowserSurfaceSession,
  type BrowserWindowMetric,
} from "./helpers/bot-screen-browser-load.ts";
import {
  requireApprovedDefaultRow,
  requireCompletedOperationalRows,
} from "./helpers/bot-screen-capacity-report.ts";

const loadTest = process.env.OMARCHY_BOT_REAL_SCREEN_LOAD === "1" ? test : test.skip;
const ROLES = ["compositor", "application", "input", "worker"] as const;
const MATRIX = [1, 2, 4, 8] as const;


const PROJECTION_CAPABILITIES = {
  previewImage: { transport: "data-channel", channel: SCREEN_PREVIEW_CHANNEL, mediaType: "image/png" },
  expandedVideo: {
    transport: "webrtc-video-track",
    codec: "video/H264",
    profileLevelId: SCREEN_H264_PROFILE,
    clockRate: SCREEN_H264_CLOCK_RATE,
  },
  control: { transport: "data-channel", channel: SCREEN_CONTROL_CHANNEL },
  input: { transport: "data-channel", channel: SCREEN_INPUT_CHANNEL },
  snapshotFallback: { transport: "http", mediaType: "image/png" },
} as const;

function projectionOffer(sdp: string): object {
  return {
    version: SCREEN_PROJECTION_PROTOCOL_VERSION,
    type: "offer",
    sdp,
    capabilities: PROJECTION_CAPABILITIES,
  };
}

function receiveH264(peer: PeerConnection): Track {
  const video = new rtc.Video("screen", "RecvOnly");
  video.addH264Codec(96, SCREEN_H264_FMTP);
  return peer.addTrack(video);
}
interface Owner {
  botId: string;
  surfaceId: SurfaceId;
}

interface ProjectionAnswer {
  type: "answer";
  sdp: string;
  sessionId: string;
  surfaceId: SurfaceId;
  runtimeGeneration: number;
  geometryGeneration: number;
  logicalWidth: number;
  logicalHeight: number;
  videoWidth: number;
  videoHeight: number;
  scale: number;
  candidates: Array<{ candidate: string; sdpMid: string }>;
}

interface CompletedFrame {
  sequence: number;
  receivedAtMs: number;
  digest: string;
}

interface Authority {
  active: boolean;
  controllerEpoch: number;
}

interface ScreenResources {
  surfaceId: SurfaceId;
  pids: number[];
  pssMiB: number;
  rssMiB: number;
  cpuPercent: number;
  gpu: {
    attributable: false;
    utilizationPercent: null;
    vramMiB: null;
  };
}

interface ResourceWindow {
  durationMs: number;
  screens: ScreenResources[];
  daemonAndHarness: {
    pssMiB: number;
    rssMiB: number;
    cpuPercent: number;
  };
  total: {
    pssMiB: number;
    rssMiB: number;
    cpuPercent: number;
  };
}

function percentile(values: number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
}

async function command(argv: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { status, stdout: stdout.trim(), stderr: stderr.trim() };
}

async function until<T>(probe: () => T | undefined | Promise<T | undefined>, timeoutMs: number, message: string): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (performance.now() >= deadline) throw new Error(message);
    // This opt-in platform harness intentionally follows real compositor and WebRTC time.
    await Bun.sleep(20);
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  const timeout = Promise.withResolvers<never>();
  const timer = setTimeout(() => timeout.reject(new Error(message)), timeoutMs);
  try {
    return await Promise.race([operation, timeout.promise]);
  } finally {
    clearTimeout(timer);
  }
}

function resetNativeRtcAtQuiescence(): void {
  rtc.cleanup();
  rtc.preload();
}

async function waitForProjectionSessionsToClose(
  harness: Harness,
  sessions: readonly BrowserSurfaceSession[],
): Promise<void> {
  await until(
    () => sessions.every((session) =>
      harness.svc.projections.loadMetrics(session.owner, session.projectionSessionId) === undefined
    ) ? true : undefined,
    5_000,
    "Browser projection sessions did not close before native WebRTC cleanup",
  );
}

async function closeBrowserProjectionSessions(
  harness: Harness,
  sessions: readonly BrowserSurfaceSession[],
): Promise<void> {
  await Promise.all(sessions.map(async (session) => {
    const response = await fetch(
      `${harness.baseUrl}/api/computer/projection?botId=${session.owner.botId}&surfaceId=${session.owner.surfaceId}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: session.projectionSessionId }),
      },
    );
    if (response.status !== 204 && response.status !== 404) {
      throw new Error(`browser projection teardown failed: ${response.status} ${await response.text()}`);
    }
    await session.close();
  }));
  await waitForProjectionSessionsToClose(harness, sessions);
}

function openChannel(channel: DataChannel): Promise<void> {
  if (channel.isOpen()) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  channel.onOpen(resolve);
  channel.onError((error) => reject(new Error(error)));
  return promise;
}

class ProjectionClient {
  readonly frames: CompletedFrame[] = [];
  readonly peer: PeerConnection;
  readonly videoTrack: Track;
  readonly frameChannel: DataChannel;
  readonly controlChannel: DataChannel;
  readonly inputChannel: DataChannel;
  #videoSequence = 0;
  #pendingHeader: { sequence: number; chunkCount: number } | undefined;
  #chunks: Buffer[] = [];
  #authority: Authority | undefined;
  #authorityWaiters: Array<{ active: boolean; resolve: (authority: Authority) => void }> = [];
  #nextSequence = 1;

  private constructor(
    readonly owner: Owner,
    readonly answer: ProjectionAnswer,
    peer: PeerConnection,
    videoTrack: Track,
    frameChannel: DataChannel,
    controlChannel: DataChannel,
    inputChannel: DataChannel,
  ) {
    this.peer = peer;
    this.videoTrack = videoTrack;
    this.frameChannel = frameChannel;
    this.controlChannel = controlChannel;
    this.inputChannel = inputChannel;
    videoTrack.onMessage((raw) => this.#onVideo(raw));
    frameChannel.onMessage((raw) => this.#onFrame(raw));
    inputChannel.onMessage((raw) => this.#onAuthority(raw));
  }

  static async connect(harness: Harness, owner: Owner, name: string): Promise<ProjectionClient> {
    const peer = new rtc.PeerConnection(name, { iceServers: [] });
    const described = Promise.withResolvers<void>();
    peer.onLocalDescription(() => described.resolve());
    const videoTrack = receiveH264(peer);
    const frameChannel = peer.createDataChannel(SCREEN_PREVIEW_CHANNEL, { unordered: false });
    const controlChannel = peer.createDataChannel(SCREEN_CONTROL_CHANNEL, { unordered: false });
    const inputChannel = peer.createDataChannel(SCREEN_INPUT_CHANNEL, { unordered: false });
    peer.setLocalDescription("offer");
    await withTimeout(described.promise, 5_000, "WebRTC offer description timed out");
    await until(
      () => peer.localDescription()?.sdp.includes("a=candidate:") ? true : undefined,
      5_000,
      "WebRTC offer candidate gathering timed out",
    );
    const offer = peer.localDescription();
    if (offer === null) throw new Error("WebRTC offer was not created");
    const response = await withTimeout(fetch(
      `${harness.baseUrl}/api/computer/projection?botId=${owner.botId}&surfaceId=${owner.surfaceId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(projectionOffer(offer.sdp)),
      },
    ), 15_000, "Screen Projection answer timed out");
    if (response.status !== 201) throw new Error(`projection signaling failed: ${response.status} ${await response.text()}`);
    const answer = await response.json() as ProjectionAnswer;
    peer.setRemoteDescription(answer.sdp, "answer");
    for (const candidate of answer.candidates) peer.addRemoteCandidate(candidate.candidate, candidate.sdpMid);
    try {
      await withTimeout(
        Promise.all([openChannel(frameChannel), openChannel(controlChannel), openChannel(inputChannel)]),
        10_000,
        "Screen Projection data channels did not open",
      );
    } catch (error) {
      const connectionState = `peer=${peer.state()}, ice=${peer.iceState()}, gathering=${peer.gatheringState()}`;
      await fetch(
        `${harness.baseUrl}/api/computer/projection?botId=${owner.botId}&surfaceId=${owner.surfaceId}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: answer.sessionId }),
        },
      ).catch(() => undefined);
      peer.close();
      await until(
        () => peer.state() === "closed" ? true : undefined,
        5_000,
        `Failed Screen Projection peer ${answer.sessionId} did not close`,
      );
      throw new Error(`${error instanceof Error ? error.message : String(error)} (${connectionState})`);
    }
    return new ProjectionClient(owner, answer, peer, videoTrack, frameChannel, controlChannel, inputChannel);
  }

  async mode(mode: "idle" | "preview" | "expanded"): Promise<Authority | undefined> {
    const authority = mode === "expanded" ? this.waitForAuthority(true) : undefined;
    if (!this.controlChannel.sendMessage(JSON.stringify({
      version: SCREEN_PROJECTION_PROTOCOL_VERSION,
      type: "view",
      surfaceId: this.owner.surfaceId,
      runtimeGeneration: this.answer.runtimeGeneration,
      mode,
    }))) throw new Error("projection control channel rejected view mode");
    return authority === undefined ? undefined : withTimeout(authority, 5_000, "Web Control authority was not granted");
  }

  waitForAuthority(active: boolean): Promise<Authority> {
    if (this.#authority?.active === active) return Promise.resolve(this.#authority);
    const { promise, resolve } = Promise.withResolvers<Authority>();
    this.#authorityWaiters.push({ active, resolve });
    return promise;
  }

  sendMotion(x: number, y: number): number {
    return this.#sendInput("pointer-motion", { x, y });
  }

  sendScroll(x: number, y: number, deltaY: number): number {
    return this.#sendInput("pointer-scroll", { x, y, deltaX: 0, deltaY });
  }

  async waitForFrame(afterSequence: number, timeoutMs = 5_000): Promise<CompletedFrame> {
    return until(
      () => this.frames.find((frame) => frame.sequence > afterSequence),
      timeoutMs,
      `Screen ${this.owner.surfaceId} did not deliver another frame`,
    );
  }

  async close(harness: Harness): Promise<void> {
    const peerClosed = until(
      () => this.peer.state() === "closed" ? true : undefined,
      5_000,
      `Screen Projection peer ${this.answer.sessionId} did not close`,
    );
    let response: Response;
    try {
      response = await fetch(
        `${harness.baseUrl}/api/computer/projection?botId=${this.owner.botId}&surfaceId=${this.owner.surfaceId}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId: this.answer.sessionId }),
        },
      );
    } finally {
      this.peer.close();
      await peerClosed;
    }
    if (!response.ok) throw new Error(`projection teardown failed: ${response.status} ${await response.text()}`);
  }

  #sendInput(type: "pointer-motion" | "pointer-scroll", payload: Record<string, number>): number {
    if (this.#authority?.active !== true) throw new Error("Web Control authority is not active");
    const sequence = this.#nextSequence;
    this.#nextSequence += 1;
    const sent = this.inputChannel.sendMessage(JSON.stringify({
      version: SCREEN_PROJECTION_PROTOCOL_VERSION,
      type,
      surfaceId: this.owner.surfaceId,
      runtimeGeneration: this.answer.runtimeGeneration,
      geometryGeneration: this.answer.geometryGeneration,
      controllerEpoch: this.#authority.controllerEpoch,
      sequence,
      ...payload,
    }));
    if (!sent) throw new Error("projection input channel rejected input");
    return sequence;
  }

  #onAuthority(raw: string | Buffer | ArrayBuffer): void {
    if (typeof raw !== "string") return;
    const parsed = JSON.parse(raw) as { type?: string; active?: boolean; controllerEpoch?: number };
    if (parsed.type !== "input-authority" || typeof parsed.active !== "boolean" || typeof parsed.controllerEpoch !== "number") return;
    this.#authority = { active: parsed.active, controllerEpoch: parsed.controllerEpoch };
    const waiting = this.#authorityWaiters;
    this.#authorityWaiters = [];
    for (const waiter of waiting) {
      if (waiter.active === parsed.active) waiter.resolve(this.#authority);
      else this.#authorityWaiters.push(waiter);
    }
  }

  #onFrame(raw: string | Buffer | ArrayBuffer): void {
    if (typeof raw === "string") {
      const parsed = JSON.parse(raw) as { type?: string; sequence?: number; chunkCount?: number };
      if (parsed.type !== "preview-frame" || typeof parsed.sequence !== "number" || typeof parsed.chunkCount !== "number") return;
      this.#pendingHeader = { sequence: parsed.sequence, chunkCount: parsed.chunkCount };
      this.#chunks = [];
      return;
    }
    if (this.#pendingHeader === undefined) return;
    this.#chunks.push(Buffer.isBuffer(raw) ? raw : Buffer.from(raw));
    if (this.#chunks.length !== this.#pendingHeader.chunkCount) return;
    const bytes = Buffer.concat(this.#chunks);
    this.frames.push({
      sequence: this.#pendingHeader.sequence,
      receivedAtMs: performance.now(),
      digest: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    });
    this.#pendingHeader = undefined;
    this.#chunks = [];
  }

  #onVideo(raw: Buffer): void {
    this.frames.push({
      sequence: ++this.#videoSequence,
      receivedAtMs: performance.now(),
      digest: new Bun.CryptoHasher("sha256").update(raw).digest("hex"),
    });
  }
}

function unitName(surfaceId: SurfaceId, generation: number, role: typeof ROLES[number]): string {
  return `omarchy-bot-screen-${surfaceId.slice("surf_".length)}-g${generation}-${role}.service`;
}

async function screenPids(owner: Owner, generation: number): Promise<number[]> {
  const pids = new Set<number>();
  if (Bun.which("systemctl") !== null) {
    for (const role of ROLES) {
      const result = await command(["systemctl", "--user", "show", unitName(owner.surfaceId, generation, role), "--property=ControlGroup", "--value"]);
      const file = result.status === 0 && result.stdout !== "" ? path.join("/sys/fs/cgroup", result.stdout, "cgroup.procs") : "";
      if (file !== "" && existsSync(file)) {
        for (const raw of readFileSync(file, "utf8").trim().split(/\s+/)) {
          const pid = Number(raw);
          if (Number.isSafeInteger(pid) && pid > 0) pids.add(pid);
        }
      }
    }
  }
  if (pids.size > 0) return [...pids].sort((a, b) => a - b);
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf8");
      const environment = readFileSync(`/proc/${entry}/environ`, "utf8");
      if (cmdline.includes(owner.surfaceId) || environment.includes(owner.surfaceId)) pids.add(Number(entry));
    } catch {
      // Processes may exit while /proc is sampled.
    }
  }
  return [...pids].sort((a, b) => a - b);
}

function processSample(pid: number): { ticks: number; pssKiB: number; rssKiB: number } | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = Number(fields[11]) + Number(fields[12]);
    const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
    const pssKiB = Number(/^Pss:\s+(\d+) kB$/m.exec(rollup)?.[1] ?? 0);
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const rssKiB = Number(/^VmRSS:\s+(\d+) kB$/m.exec(status)?.[1] ?? 0);
    return { ticks, pssKiB, rssKiB };
  } catch {
    return undefined;
  }
}

async function resourceWindow(
  owners: Owner[],
  generationBySurface: Map<SurfaceId, number>,
  durationMs: number,
  activity?: (deadlineMs: number) => Promise<void>,
): Promise<ResourceWindow> {
  const hertzResult = await command(["getconf", "CLK_TCK"]);
  const hertz = Number(hertzResult.stdout) || 100;
  const before = new Map<number, number>();
  const beforePids = new Map<SurfaceId, number[]>();
  const daemonBefore = processSample(process.pid);
  for (const owner of owners) {
    const pids = await screenPids(owner, generationBySurface.get(owner.surfaceId) ?? 1);
    beforePids.set(owner.surfaceId, pids);
    for (const pid of pids) {
      const sample = processSample(pid);
      if (sample !== undefined) before.set(pid, sample.ticks);
    }
  }
  const startedAt = performance.now();
  const deadline = startedAt + durationMs;
  if (activity === undefined) await Bun.sleep(durationMs);
  else await activity(deadline);
  const elapsedMs = performance.now() - startedAt;
  const daemonAfter = processSample(process.pid);
  const daemonAndHarness = {
    pssMiB: Number(((daemonAfter?.pssKiB ?? 0) / 1024).toFixed(2)),
    rssMiB: Number(((daemonAfter?.rssKiB ?? 0) / 1024).toFixed(2)),
    cpuPercent: Number((
      ((daemonAfter?.ticks ?? 0) - (daemonBefore?.ticks ?? 0))
      / hertz
      / (elapsedMs / 1_000)
      * 100
    ).toFixed(2)),
  };
  const screens: ScreenResources[] = [];
  for (const owner of owners) {
    const pids = new Set([
      ...(beforePids.get(owner.surfaceId) ?? []),
      ...await screenPids(owner, generationBySurface.get(owner.surfaceId) ?? 1),
    ]);
    let ticks = 0;
    let pssKiB = 0;
    let rssKiB = 0;
    for (const pid of pids) {
      const sample = processSample(pid);
      if (sample === undefined) continue;
      const firstTicks = before.get(pid);
      if (firstTicks !== undefined) ticks += Math.max(0, sample.ticks - firstTicks);
      pssKiB += sample.pssKiB;
      rssKiB += sample.rssKiB;
    }
    screens.push({
      surfaceId: owner.surfaceId,
      pids: [...pids].sort((a, b) => a - b),
      pssMiB: Number((pssKiB / 1024).toFixed(2)),
      rssMiB: Number((rssKiB / 1024).toFixed(2)),
      cpuPercent: Number(((ticks / hertz) / (elapsedMs / 1000) * 100).toFixed(2)),
      gpu: { attributable: false, utilizationPercent: null, vramMiB: null },
    });
  }
  return {
    durationMs: Number(elapsedMs.toFixed(2)),
    screens,
    daemonAndHarness,
    total: {
      pssMiB: Number((screens.reduce((sum, screen) => sum + screen.pssMiB, 0) + daemonAndHarness.pssMiB).toFixed(2)),
      rssMiB: Number((screens.reduce((sum, screen) => sum + screen.rssMiB, 0) + daemonAndHarness.rssMiB).toFixed(2)),
      cpuPercent: Number((screens.reduce((sum, screen) => sum + screen.cpuPercent, 0) + daemonAndHarness.cpuPercent).toFixed(2)),
    },
  };
}

async function gpuSnapshot(): Promise<Record<string, unknown>> {
  const binary = Bun.which("nvidia-smi");
  if (binary === null) return { available: false, attributionAvailable: false, reason: "nvidia-smi is unavailable" };
  const result = await command([
    binary,
    "--query-gpu=name,utilization.gpu,memory.used,memory.total",
    "--format=csv,noheader,nounits",
  ]);
  if (result.status !== 0) {
    return { available: false, attributionAvailable: false, reason: result.stderr || "nvidia-smi failed" };
  }
  return {
    available: true,
    attributionAvailable: false,
    reason: "nvidia-smi does not expose attributable graphics-process VRAM on this stack",
    systemTotals: result.stdout.split("\n").map((line) => {
      const [name, utilizationPercent, usedMiB, totalMiB] = line.split(",").map((value) => value.trim());
      return { name, utilizationPercent: Number(utilizationPercent), usedMiB: Number(usedMiB), totalMiB: Number(totalMiB) };
    }),
  };
}

async function currentGeneration(harness: Harness, owner: Owner): Promise<number> {
  const row = harness.svc.db.query("SELECT runtime_generation FROM bot_surfaces WHERE surface_id = ?")
    .get(owner.surfaceId) as { runtime_generation: number };
  return row.runtime_generation;
}

async function waitReady(harness: Harness, owner: Owner): Promise<number> {
  const startedAt = performance.now();
  harness.svc.screens.open(owner);
  await until(async () => {
    const response = await fetch(`${harness.baseUrl}/api/computer/state?botId=${owner.botId}&surfaceId=${owner.surfaceId}`);
    const view = await response.json() as { state?: string; activity?: string };
    if (view.state === "unavailable") throw new Error(view.activity ?? "Bot Screen unavailable");
    return view.state === "ready" ? true : undefined;
  }, 30_000, `Screen ${owner.surfaceId} did not become ready`);
  return Number((performance.now() - startedAt).toFixed(2));
}

async function destroyBot(harness: Harness, owner: Owner): Promise<number> {
  const startedAt = performance.now();
  const result = await api<{ status: string }>(harness, "DELETE", `/api/bots/${owner.botId}`, {});
  if (result.status !== "deleted") throw new Error(`Bot ${owner.botId} was not permanently deleted`);
  if (
    existsSync(path.join(harness.svc.cfg.botScreenRuntimeDir, owner.surfaceId))
    || existsSync(path.join(harness.svc.cfg.botScreenProfileDir, owner.surfaceId))
  ) throw new Error(`Screen ${owner.surfaceId} retained runtime state after Bot deletion`);
  return Number((performance.now() - startedAt).toFixed(2));
}

async function killUnit(owner: Owner, generation: number, role: "input" | "compositor"): Promise<void> {
  const result = await command(["systemctl", "--user", "kill", "--signal=KILL", unitName(owner.surfaceId, generation, role)]);
  if (result.status !== 0) throw new Error(`could not crash ${role}: ${result.stderr}`);
}

function activeEncoderCount(): number {
  let count = 0;
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const commandLine = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
      if (
        path.basename(commandLine[0] ?? "") === "ffmpeg"
        && commandLine.some((argument) => argument.includes("repeat-headers=1:aud=1"))
      ) count += 1;
    } catch {
      // Processes may exit while /proc is sampled.
    }
  }
  return count;
}

function createBrowserFixture(root: string): string {
  const html = path.join(root, "load.html");
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><title>Bot Screen load</title>
<style>html{font:28px sans-serif;background:#102033;color:#fff}body{margin:0;min-height:24000px;background:repeating-linear-gradient(#102033 0 120px,#284d70 120px 240px)}#status{position:fixed;inset:20px 20px auto 20px;padding:20px;background:#000c;border:3px solid #7df}</style>
<div id="status">ready</div><script>let n=0;const s=document.querySelector('#status');for(const event of ['wheel','pointermove','keydown'])addEventListener(event,()=>{s.textContent=event+':'+(++n);s.style.background=n%2?'#8b1e3f':'#14532d'});</script>`);
  const launcher = path.join(root, "bot-screen-browser");
  writeFileSync(launcher, `#!/bin/sh
exec /usr/bin/brave --user-data-dir="$XDG_STATE_HOME/brave" --no-first-run --no-default-browser-check --disable-background-networking --disable-sync --password-store=basic --ozone-platform=wayland --app="file://${html}"
`);
  chmodSync(launcher, 0o755);
  return launcher;
}

async function runRow(profile: "1080p" | "720p", count: number, durationMs: number): Promise<Record<string, unknown>> {
  const harness = await startDaemon(undefined, { useProductionBotScreen: true, botScreenCapacity: 8 });
  const owners: Owner[] = [];
  const clients: ProjectionClient[] = [];
  const browserSessions: BrowserSurfaceSession[] = [];
  const startupMs: number[] = [];
  const teardownMs: number[] = [];
  const repeatedProvisionDestroy: Array<{
    cycle: number;
    destroyedSurfaceId: SurfaceId;
    provisionedSurfaceId: SurfaceId;
    teardownMs: number;
    startupMs: number;
  }> = [];
  const trackedSurfaceIds = new Set<SurfaceId>();
  let browserHarness: FinalWebBrowserHarness | undefined;
  let browserMetadata: Record<string, unknown> | null = null;
  let simultaneousAgentAndWebInputCompleted = false;
  const inputLatenciesMs: number[] = [];
  let cleanup: Record<string, unknown> = { clean: false };
  let rowError: string | undefined;
  let idle!: ResourceWindow;
  let active!: ResourceWindow;
  let staticPreview!: ResourceWindow;
  let frameMetrics: BrowserWindowMetric[] = [];
  let staticPreviewFrameMetrics: BrowserWindowMetric[] = [];
  let churnConnections = 0;
  let takeoverCompleted = false;
  let crashes: Array<Record<string, unknown>> = [];
  let unopenedNoRuntime = false;
  let idleEncodeProcessesObserved = 0;
  const gpuBefore = await gpuSnapshot();
  try {
    const botIds = await Promise.all(Array.from({ length: count }, (_, index) => makeBot(harness, `${profile} load ${count}-${index}`)));
    for (const botId of botIds) {
      const bot = await api<{ surfaceId: SurfaceId }>(harness, "GET", `/api/bots/${botId}`);
      const owner = { botId, surfaceId: bot.surfaceId };
      owners.push(owner);
      trackedSurfaceIds.add(owner.surfaceId);
    }
    unopenedNoRuntime = owners.every((owner) =>
      !existsSync(path.join(harness.svc.cfg.botScreenRuntimeDir, owner.surfaceId))
    );
    startupMs.push(...await Promise.all(owners.map((owner) => waitReady(harness, owner))));
    console.log(`Bot Screen load ${profile}/${count}: runtimes ready`);
    const generationBySurface = new Map<SurfaceId, number>();
    for (const owner of owners) generationBySurface.set(owner.surfaceId, await currentGeneration(harness, owner));

    idle = await resourceWindow(owners, generationBySurface, Math.min(durationMs, 2_000));
    for (let sample = 0; sample < 10; sample += 1) {
      idleEncodeProcessesObserved += activeEncoderCount();
      await Bun.sleep(50);
    }
    console.log(`Bot Screen load ${profile}/${count}: idle measured`);

    const finalWebBrowser = await FinalWebBrowserHarness.start(harness.baseUrl);
    browserHarness = finalWebBrowser;
    browserMetadata = {
      finalWebClient: true,
      mode: "headless",
      secureContext: true,
      lanEndpoint: finalWebBrowser.lanEndpoint,
      lanInterface: finalWebBrowser.lanInterface,
      browser: finalWebBrowser.browserName,
    };
    browserSessions.push(...await Promise.all(owners.map((owner) => finalWebBrowser.open(owner))));

    await Promise.all(browserSessions.map((session) => session.startWindow()));
    staticPreview = await resourceWindow(owners, generationBySurface, durationMs);
    staticPreviewFrameMetrics = await Promise.all(browserSessions.map((session) => session.finishWindow()));
    console.log(`Bot Screen load ${profile}/${count}: sustained static preview measured`);

    await Promise.all(browserSessions.map((session) => session.expand()));
    for (let sample = 0; sample < 4; sample += 1) {
      inputLatenciesMs.push(...await Promise.all(browserSessions.map((session) =>
        session.measureInputToVisible()
      )));
    }
    console.log(`Bot Screen load ${profile}/${count}: browser-painted input latency measured`);

    const productionStarts = browserSessions.map((session) => {
      const metrics = harness.svc.projections.loadMetrics(session.owner, session.projectionSessionId);
      if (metrics === undefined) throw new Error(`projection load metrics unavailable for ${session.owner.surfaceId}`);
      return metrics;
    });
    await Promise.all(browserSessions.map((session) => session.startWindow()));
    active = await resourceWindow(owners, generationBySurface, durationMs, async (deadline) => {
      let step = 0;
      while (performance.now() < deadline) {
        await Promise.all(browserSessions.map((session) => session.movePointer(step)));
        step += 1;
        await Bun.sleep(50);
      }
    });
    const productionEnds = browserSessions.map((session) => {
      const metrics = harness.svc.projections.loadMetrics(session.owner, session.projectionSessionId);
      if (metrics === undefined) throw new Error(`projection load metrics unavailable for ${session.owner.surfaceId}`);
      return metrics;
    });
    const browserMetrics = await Promise.all(browserSessions.map((session, index) =>
      session.finishWindow({
        afterSequence: productionStarts[index]!.sequence,
        throughSequence: productionEnds[index]!.sequence,
        durationMs: active.durationMs,
      })
    ));
    const expectedFrames = Math.floor(BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.targetFps * active.durationMs / 1_000);
    const metricDelta = (
      after: ProjectionLoadMetrics,
      before: ProjectionLoadMetrics,
      key: Exclude<keyof ProjectionLoadMetrics, "sessionId" | "surfaceId">,
    ): number => after[key] - before[key];
    frameMetrics = browserMetrics.map((browserMetric, index) => {
      const before = productionStarts[index]!;
      const after = productionEnds[index]!;
      const sourceFrames = metricDelta(after, before, "sourceFrames");
      const encodedFrames = metricDelta(after, before, "encodedFrames");
      const sentFrames = metricDelta(after, before, "framesSent");
      const preCaptureBackpressureSkips = metricDelta(after, before, "preCaptureBackpressureSkips");
      const encodedBackpressureDrops = metricDelta(after, before, "encodedBackpressureDrops");
      const transportUnavailableSkips = metricDelta(after, before, "transportUnavailableSkips");
      const invalidFrameDrops = metricDelta(after, before, "invalidFrameDrops");
      const sendFailures = metricDelta(after, before, "sendFailures");
      const seconds = active.durationMs / 1_000;
      const unexplainedProductionDrops = Math.max(
        0,
        encodedFrames - sentFrames - encodedBackpressureDrops - sendFailures,
      );
      const unexplainedTransportDrops = Math.max(0, sentFrames - browserMetric.receivedFrames);
      return {
        ...browserMetric,
        sourceFrames,
        encodedFrames,
        sentFrames,
        sourceFps: Number((sourceFrames / seconds).toFixed(2)),
        encodedFps: Number((encodedFrames / seconds).toFixed(2)),
        sentFps: Number((sentFrames / seconds).toFixed(2)),
        preCaptureBackpressureSkips,
        encodedBackpressureDrops,
        transportUnavailableSkips,
        invalidFrameDrops,
        sendFailures,
        unexplainedDrops: unexplainedProductionDrops + unexplainedTransportDrops,
        targetFrameShortfall: {
          source: Math.max(0, expectedFrames - sourceFrames),
          encoded: Math.max(0, expectedFrames - encodedFrames),
          sent: Math.max(0, expectedFrames - sentFrames),
          received: Math.max(0, expectedFrames - browserMetric.receivedFrames),
          decoded: Math.max(0, expectedFrames - browserMetric.decodedFrames),
          displayed: Math.max(0, expectedFrames - browserMetric.displayedFrames),
        },
      };
    });
    console.log(`Bot Screen load ${profile}/${count}: final-client browser delivery measured`);

    inputLatenciesMs.push(...await Promise.all(browserSessions.map((session, index) =>
      session.measureInputToVisible(async () => {
        await harness.svc.computer.agentToolAct(
          owners[index]!,
          `simultaneous-turn-${profile}-${count}-${index}`,
          `simultaneous-tool-${profile}-${count}-${index}`,
          { name: "type", args: { text: `AGENT-${index}` } },
          new AbortController().signal,
        );
      })
    )));
    simultaneousAgentAndWebInputCompleted = true;
    console.log(`Bot Screen load ${profile}/${count}: simultaneous Broker Agent and Web input measured`);

    const closedBrowserSessions = browserSessions.splice(0, browserSessions.length);
    await closeBrowserProjectionSessions(harness, closedBrowserSessions);
    await browserHarness.close();
    browserHarness = undefined;
    resetNativeRtcAtQuiescence();

    // Native clients remain only for non-visual Takeover/reconnect fault setup.
    for (const [index, owner] of owners.entries()) {
      const client = await ProjectionClient.connect(harness, owner, `${profile}-${count}-fault-${index}`);
      clients.push(client);
      await client.mode("expanded");
      await client.waitForFrame(0);
    }

    if (owners.length > 0) {
      const owner = owners[0]!;
      const controller = new AbortController();
      const source = await harness.svc.screens.projectionSource(owner);
      if (source === undefined) throw new Error("Takeover Screen is unavailable");
      const queuedCaptures = Promise.all(Array.from({ length: 3 }, () => source.capture().catch(() => undefined)));
      const pending = harness.svc.computer.agentToolAct(
        owner,
        `takeover-turn-${profile}-${count}`,
        `takeover-tool-${profile}-${count}`,
        { name: "observe", args: {} },
        controller.signal,
      );
      const pendingOutcome = pending.then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
      await until(
        () => harness.svc.computer.state(owner).takeover === "available" ? true : undefined,
        5_000,
        "Takeover did not become available",
      );
      const query = `botId=${owner.botId}&surfaceId=${owner.surfaceId}`;
      const taken = await withTimeout(
        fetch(`${harness.baseUrl}/api/computer/take-control?${query}`, { method: "POST" }),
        10_000,
        "Takeover did not quiesce",
      );
      if (taken.status !== 200) throw new Error(`Takeover failed with ${taken.status}`);
      takeoverCompleted = true;
      controller.abort("load harness completed Takeover");
      await queuedCaptures;
      await withTimeout(pendingOutcome, 10_000, "cancelled Takeover tool did not settle");
    }
    console.log(`Bot Screen load ${profile}/${count}: Takeover completed`);

    for (let churn = 0; churn < 2; churn += 1) {
      const previous = clients.splice(0, clients.length);
      await Promise.all(previous.map((client) => client.close(harness)));
      resetNativeRtcAtQuiescence();
      for (const [index, owner] of owners.entries()) {
        const client = await ProjectionClient.connect(harness, owner, `${profile}-${count}-churn-${churn}-${index}`);
        clients.push(client);
        await client.mode("expanded");
        await client.waitForFrame(0);
        churnConnections += 1;
      }
    }
    await Promise.all(clients.splice(0, clients.length).map((client) => client.close(harness)));
    resetNativeRtcAtQuiescence();

    console.log(`Bot Screen load ${profile}/${count}: reconnect churn completed`);
    if (owners.length > 0) {
      for (let cycle = 0; cycle < 2; cycle += 1) {
        const destroyed = owners[0]!;
        const cycleTeardownMs = await destroyBot(harness, destroyed);
        const botId = await makeBot(harness, `${profile} reprovision ${count}-${cycle}`);
        const bot = await api<{ surfaceId: SurfaceId }>(harness, "GET", `/api/bots/${botId}`);
        const provisioned: Owner = { botId, surfaceId: bot.surfaceId };
        if (trackedSurfaceIds.has(provisioned.surfaceId)) throw new Error("Bot reprovision reused a destroyed Surface");
        trackedSurfaceIds.add(provisioned.surfaceId);
        const cycleStartupMs = await waitReady(harness, provisioned);
        owners[0] = provisioned;
        repeatedProvisionDestroy.push({
          cycle,
          destroyedSurfaceId: destroyed.surfaceId,
          provisionedSurfaceId: provisioned.surfaceId,
          teardownMs: cycleTeardownMs,
          startupMs: cycleStartupMs,
        });
      }
    }

    const crashTargets = owners.slice(0, Math.min(2, owners.length));
    for (const [index, owner] of crashTargets.entries()) {
      const generation = await currentGeneration(harness, owner);
      const role = index === 0 && owners.length > 1 ? "input" as const : "compositor" as const;
      await killUnit(owner, generation, role);
      await until(
        () => harness.svc.screens.status(owner).state === "failed" ? true : undefined,
        5_000,
        `${role} crash was not observed`,
      );
      crashes.push({ surfaceId: owner.surfaceId, role, isolated: owners.slice(crashTargets.length).every((active) => harness.svc.screens.status(active).state === "ready") });
    }
  } catch (error) {
    rowError = error instanceof Error ? error.message : String(error);
  } finally {
    await Promise.all(clients.splice(0, clients.length).map((client) => client.close(harness)));
    const unclosedBrowserSessions = browserSessions.splice(0, browserSessions.length);
    await closeBrowserProjectionSessions(harness, unclosedBrowserSessions);
    await browserHarness?.close();
    for (const owner of owners) {
      try {
        teardownMs.push(await destroyBot(harness, owner));
      } catch {
        // The final daemon stop below retries any incomplete runtime cleanup.
      }
    }
    await harness.stop();
    resetNativeRtcAtQuiescence();
    const unitList = Bun.which("systemctl") === null
      ? ""
      : (await command(["systemctl", "--user", "list-units", "--all", "--plain", "--no-legend", "omarchy-bot-screen-*"])).stdout;
    const trackedSurfaces = [...trackedSurfaceIds];
    cleanup = {
      clean: trackedSurfaces.every((surfaceId) =>
        !existsSync(path.join(harness.svc.cfg.botScreenRuntimeDir, surfaceId))
        && !existsSync(path.join(harness.svc.cfg.botScreenProfileDir, surfaceId))
        && !unitList.includes(surfaceId.slice(5))
      ),
      residualRuntimeDirs: trackedSurfaces.filter((surfaceId) => existsSync(path.join(harness.svc.cfg.botScreenRuntimeDir, surfaceId))),
      residualProfileDirs: trackedSurfaces.filter((surfaceId) => existsSync(path.join(harness.svc.cfg.botScreenProfileDir, surfaceId))),
      residualUnits: trackedSurfaces.filter((surfaceId) => unitList.includes(surfaceId.slice(5))),
    };
  }
  const gpuAfter = await gpuSnapshot();
  const p50 = percentile(inputLatenciesMs, 0.5);
  const p95 = percentile(inputLatenciesMs, 0.95);
  const captureToBrowserSamples = frameMetrics.flatMap((metric) => metric.captureToBrowserMs);
  const captureToBrowserP50 = percentile(captureToBrowserSamples, 0.5);
  const captureToBrowserP95 = percentile(captureToBrowserSamples, 0.95);
  const performancePassed = rowError === undefined
    && frameMetrics.length === count
    && staticPreviewFrameMetrics.length === count
    && staticPreviewFrameMetrics.every((metric) => metric.displayedFrames > 0)
    && frameMetrics.every((metric) =>
      metric.encodedFps !== undefined
      && metric.encodedFps >= BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.targetFps
      && metric.displayedFps >= BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.targetFps
      && metric.unexplainedDrops === 0
      && metric.targetFrameShortfall?.encoded === 0
      && metric.targetFrameShortfall.displayed === 0
    )
    && p50 !== null
    && simultaneousAgentAndWebInputCompleted
    && p50 <= BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.inputToVisibleP50LimitMs;
  const operationalPassed = rowError === undefined
    && frameMetrics.length === count
    && staticPreviewFrameMetrics.length === count
    && staticPreviewFrameMetrics.every((metric) => metric.displayedFrames > 0)
    && simultaneousAgentAndWebInputCompleted
    && takeoverCompleted
    && churnConnections === count * 2
    && crashes.length === Math.min(2, count)
    && crashes.every((crash) => crash.isolated === true)
    && repeatedProvisionDestroy.length === 2
    && (cleanup as { clean?: boolean }).clean === true;
  return {
    profile,
    screens: count,
    resolution: profile === "1080p" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 },
    targetFps: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.targetFps,
    durationMs,
    performancePassed,
    operationalPassed,
    ...(rowError === undefined ? {} : { error: rowError }),
    startupMs: { samples: startupMs, p50: percentile(startupMs, 0.5), p95: percentile(startupMs, 0.95) },
    teardownMs: { samples: teardownMs, p50: percentile(teardownMs, 0.5), p95: percentile(teardownMs, 0.95) },
    repeatedProvisionDestroy,
    inputToVisibleMs: { source: "browser-paint", samples: inputLatenciesMs.map((value) => Number(value.toFixed(2))), p50: p50 === null ? null : Number(p50.toFixed(2)), p95: p95 === null ? null : Number(p95.toFixed(2)) },
    captureToBrowserMs: { source: "browser-paint", samples: captureToBrowserSamples, p50: captureToBrowserP50 === null ? null : Number(captureToBrowserP50.toFixed(2)), p95: captureToBrowserP95 === null ? null : Number(captureToBrowserP95.toFixed(2)) },
    frames: frameMetrics,
    browser: browserMetadata,
    staticPreview: { frames: staticPreviewFrameMetrics, resources: staticPreview ?? null },
    idleResources: idle ?? null,
    idleEncoding: { unopenedNoRuntime, attributableCaptureProcessesObserved: idleEncodeProcessesObserved },
    activeResources: active ?? null,
    simultaneousAgentAndWebInputCompleted,
    takeoverCompleted,
    reconnects: churnConnections,
    crashes,
    gpu: { before: gpuBefore, after: gpuAfter },
    cleanup,
  };
}

async function admissionProof(capacity: number): Promise<Record<string, unknown>> {
  const harness = await startDaemon(undefined, { useProductionBotScreen: true, botScreenCapacity: capacity });
  const owners: Owner[] = [];
  try {
    for (let index = 0; index < capacity + 1; index += 1) {
      const botId = await makeBot(harness, `Admission ${index}`);
      const bot = await api<{ surfaceId: SurfaceId }>(harness, "GET", `/api/bots/${botId}`);
      owners.push({ botId, surfaceId: bot.surfaceId });
    }
    await Promise.all(owners.slice(0, capacity).map((owner) => waitReady(harness, owner)));
    const overflow = owners[capacity]!;
    const openAttempt = harness.svc.screens.open(overflow);
    const rejected = await apiStatus(harness, "GET", `/api/computer/state?botId=${overflow.botId}&surfaceId=${overflow.surfaceId}`);
    const noPartialRuntime = !existsSync(path.join(harness.svc.cfg.botScreenRuntimeDir, overflow.surfaceId));
    const activeUnaffected = owners.slice(0, capacity).every((owner) => harness.svc.screens.status(owner).state === "ready");
    return { capacity, openAttempt, rejected, noPartialRuntime, activeUnaffected };
  } finally {
    for (const owner of owners) await destroyBot(harness, owner).catch(() => undefined);
    await harness.stop();
  }
}

loadTest("measures sustained final-stack Bot Screen capacity and admission", async () => {
  const durationMs = Number(process.env.OMARCHY_BOT_LOAD_DURATION_MS ?? 15_000);
  if (!Number.isSafeInteger(durationMs) || durationMs < 1_000) throw new Error("OMARCHY_BOT_LOAD_DURATION_MS must be an integer of at least 1000");
  const matrix = process.env.OMARCHY_BOT_LOAD_MATRIX === undefined
    ? [...MATRIX]
    : process.env.OMARCHY_BOT_LOAD_MATRIX.split(",").map(Number);
  if (
    matrix.length === 0
    || matrix.some((count) => !MATRIX.includes(count as typeof MATRIX[number]))
  ) throw new Error("OMARCHY_BOT_LOAD_MATRIX may contain only 1,2,4,8");
  const includeFallback = process.env.OMARCHY_BOT_LOAD_FALLBACK !== "0";
  if (Bun.which("brave") === null) throw new Error("the real load harness requires Brave");
  await buildFinalWebClient(path.resolve(import.meta.dir, "../.."));
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-screen-load-"));
  const prior = {
    application: process.env.OMARCHY_BOT_SCREEN_APP_BIN,
    profile: process.env.OMARCHY_BOT_SCREEN_PROFILE,
    frameRate: process.env.OMARCHY_BOT_SCREEN_FRAME_RATE,
  };
  process.env.OMARCHY_BOT_SCREEN_APP_BIN = createBrowserFixture(fixtureRoot);
  process.env.OMARCHY_BOT_SCREEN_FRAME_RATE = String(BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.captureFrameRate);
  const rows: Array<Record<string, unknown>> = [];
  try {
    process.env.OMARCHY_BOT_SCREEN_PROFILE = "1080p";
    for (const count of matrix) rows.push(await runRow("1080p", count, durationMs));
    if (includeFallback) {
      process.env.OMARCHY_BOT_SCREEN_PROFILE = "720p";
      rows.push(await runRow("720p", 8, durationMs));
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
    for (const [name, value] of [
      ["OMARCHY_BOT_SCREEN_APP_BIN", prior.application],
      ["OMARCHY_BOT_SCREEN_PROFILE", prior.profile],
      ["OMARCHY_BOT_SCREEN_FRAME_RATE", prior.frameRate],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  const chosenDefault = BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.defaultCapacity;
  let releaseGateError: Error | undefined;
  try {
    requireApprovedDefaultRow(rows, chosenDefault, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL);
  } catch (error) {
    releaseGateError = error instanceof Error ? error : new Error(String(error));
  }
  let operationalGateError: Error | undefined;
  try {
    requireCompletedOperationalRows(rows);
  } catch (error) {
    operationalGateError = error instanceof Error ? error : new Error(String(error));
  }
  const admission = releaseGateError === undefined ? await admissionProof(chosenDefault) : null;
  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    reproducibleCommand: "OMARCHY_BOT_REAL_SCREEN_LOAD=1 bun test tests/integration/bot-screen-capacity.load.test.ts",
    configuration: {
      durationMs,
      matrix,
      fallback: includeFallback ? { profile: "720p", screens: 8 } : null,
      targetFps: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.targetFps,
      captureFrameRate: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.captureFrameRate,
      medianLatencyLimitMs: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.inputToVisibleP50LimitMs,
    },
    defaultCapacityApproval: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL,
    releaseGate: releaseGateError === undefined
      ? { passed: true }
      : { passed: false, error: releaseGateError.message },
    operationalGate: operationalGateError === undefined
      ? { passed: true }
      : { passed: false, error: operationalGateError.message },
    machine: {
      hostname: os.hostname(),
      platform: `${os.platform()} ${os.release()} ${os.arch()}`,
      cpu: os.cpus()[0]?.model ?? "unknown",
      logicalCpus: os.cpus().length,
      memoryMiB: Math.round(os.totalmem() / 1024 / 1024),
      waylandDisplay: process.env.WAYLAND_DISPLAY ?? null,
      hyprland: (await command(["Hyprland", "--version"])).stdout,
      browser: (await command(["brave", "--version"])).stdout,
    },
    rows,
    chosenDefault,
    admission,
  };
  const reportPath = process.env.OMARCHY_BOT_LOAD_REPORT ?? path.join(os.tmpdir(), "omarchy-bot-screen-load-report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`BOT_SCREEN_LOAD_REPORT=${reportPath}`);
  if (operationalGateError !== undefined) throw operationalGateError;
  if (releaseGateError !== undefined) throw releaseGateError;
  expect(rows).toHaveLength(matrix.length + (includeFallback ? 1 : 0));
  expect(rows.every((row) => (row.cleanup as { clean?: boolean }).clean === true)).toBeTrue();
  expect(admission).toMatchObject({
    openAttempt: { state: "stopped", admission: { reason: "capacity", active: chosenDefault, limit: chosenDefault } },
    rejected: {
      body: {
        state: "unavailable",
        activity: `Bot Screen capacity is full (${chosenDefault}/${chosenDefault}).`,
        unavailableReason: "capacity",
        capacity: { active: chosenDefault, limit: chosenDefault },
      },
    },
    noPartialRuntime: true,
    activeUnaffected: true,
  });
}, 1_200_000);
