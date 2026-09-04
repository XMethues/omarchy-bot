import { expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
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
const ROLES = ["compositor", "application", "input", "worker", "capture", "encoder"] as const;
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
  processes: Array<{
    pid: number;
    role: typeof ROLES[number] | "unknown";
    executable: string;
    pssMiB: number;
    rssMiB: number;
    cpuPercent: number;
  }>;
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



async function closeBrowserProjectionSessions(
  harness: Harness,
  sessions: readonly BrowserSurfaceSession[],
): Promise<void> {
  const closePromises = sessions.map((session) =>
    harness.svc.projections.close(session.owner, session.projectionSessionId)
  );
  await Promise.all(sessions.map((session) => session.close()));
  await Promise.all(closePromises);
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

function unitName(surfaceId: SurfaceId, generation: number, role: string): string {
  return `omarchy-bot-screen-${surfaceId.slice("surf_".length)}-g${generation}-${role}.service`;
}

async function roleUnitNames(
  owner: Owner,
  generation: number,
  role: typeof ROLES[number],
): Promise<string[]> {
  const pattern = unitName(owner.surfaceId, generation, `${role}*`);
  const result = await command([
    "systemctl",
    "--user",
    "list-units",
    "--all",
    "--full",
    "--plain",
    "--no-legend",
    pattern,
  ]);
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.trim().split(/\s+/, 1)[0])
    .filter((unit): unit is string => unit !== undefined && unit.endsWith(".service"));
}

async function screenPidRoles(
  owner: Owner,
  generation: number,
): Promise<Map<number, typeof ROLES[number] | "unknown">> {
  const pids = new Map<number, typeof ROLES[number] | "unknown">();
  if (Bun.which("systemctl") !== null) {
    for (const role of ROLES) {
      for (const unit of await roleUnitNames(owner, generation, role)) {
        const result = await command(["systemctl", "--user", "show", unit, "--property=ControlGroup", "--value"]);
        const file = result.status === 0 && result.stdout !== "" ? path.join("/sys/fs/cgroup", result.stdout, "cgroup.procs") : "";
        if (file !== "" && existsSync(file)) {
          for (const raw of readFileSync(file, "utf8").trim().split(/\s+/)) {
            const pid = Number(raw);
            if (Number.isSafeInteger(pid) && pid > 0) pids.set(pid, role);
          }
        }
      }
    }
  }
  if (pids.size > 0) return pids;
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf8");
      const environment = readFileSync(`/proc/${entry}/environ`, "utf8");
      if (cmdline.includes(owner.surfaceId) || environment.includes(owner.surfaceId)) {
        pids.set(Number(entry), "unknown");
      }
    } catch {
      // Processes may exit while /proc is sampled.
    }
  }
  return pids;
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
  const beforePids = new Map<SurfaceId, Map<number, typeof ROLES[number] | "unknown">>();
  const daemonBefore = processSample(process.pid);
  for (const owner of owners) {
    const pids = await screenPidRoles(owner, generationBySurface.get(owner.surfaceId) ?? 1);
    beforePids.set(owner.surfaceId, pids);
    for (const pid of pids.keys()) {
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
    const pidRoles = new Map(beforePids.get(owner.surfaceId) ?? []);
    for (const [pid, role] of await screenPidRoles(owner, generationBySurface.get(owner.surfaceId) ?? 1)) {
      pidRoles.set(pid, role);
    }
    const processes: ScreenResources["processes"] = [];
    for (const [pid, role] of pidRoles) {
      const sample = processSample(pid);
      if (sample === undefined) continue;
      const firstTicks = before.get(pid);
      const ticks = firstTicks === undefined ? 0 : Math.max(0, sample.ticks - firstTicks);
      let executable = "unknown";
      try {
        executable = path.basename(readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0")[0] ?? "") || "unknown";
      } catch {
        // Process identity is best-effort diagnostic data.
      }
      processes.push({
        pid,
        role,
        executable,
        pssMiB: Number((sample.pssKiB / 1024).toFixed(2)),
        rssMiB: Number((sample.rssKiB / 1024).toFixed(2)),
        cpuPercent: Number(((ticks / hertz) / (elapsedMs / 1000) * 100).toFixed(2)),
      });
    }
    processes.sort((left, right) => left.pid - right.pid);
    screens.push({
      surfaceId: owner.surfaceId,
      pids: processes.map((entry) => entry.pid),
      pssMiB: Number(processes.reduce((sum, entry) => sum + entry.pssMiB, 0).toFixed(2)),
      rssMiB: Number(processes.reduce((sum, entry) => sum + entry.rssMiB, 0).toFixed(2)),
      cpuPercent: Number(processes.reduce((sum, entry) => sum + entry.cpuPercent, 0).toFixed(2)),
      gpu: { attributable: false, utilizationPercent: null, vramMiB: null },
      processes,
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
    if (view.state === "unavailable") {
      const runtime = harness.svc.screens.status(owner);
      if (runtime.state === "failed") throw new Error(runtime.failure);
      return undefined;
    }
    return view.state === "ready" ? true : undefined;
  }, 30_000, `Screen ${owner.surfaceId} did not become ready`);
  return Number((performance.now() - startedAt).toFixed(2));
}

async function destroyBot(harness: Harness, owner: Owner): Promise<number> {
  const startedAt = performance.now();
  const result = await api<{ status: string; failures?: unknown }>(
    harness,
    "DELETE",
    `/api/bots/${owner.botId}`,
    {},
  );
  if (result.status !== "deleted") {
    throw new Error(`Bot ${owner.botId} was not permanently deleted: ${JSON.stringify(result.failures ?? [])}`);
  }
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

function matchingProcessPids(executableName: string): Set<number> {
  const pids = new Set<number>();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const commandLine = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const directDaemonChild = Number(fields[1]) === process.pid;
      const cgroup = readFileSync(`/proc/${entry}/cgroup`, "utf8");
      const surfaceUnitChild = cgroup.includes("omarchy-bot-screen-");
      if (!directDaemonChild && !surfaceUnitChild) continue;
      const matchesEncoder = executableName !== "ffmpeg"
        || commandLine.some((argument) => argument.includes("repeat-headers=1:aud=1"));
      if (path.basename(commandLine[0] ?? "") === executableName && matchesEncoder) {
        pids.add(Number(entry));
      }
    } catch {
      // Processes may exit while /proc is sampled.
    }
  }
  return pids;
}

function activeEncoderCount(): number {
  return matchingProcessPids("ffmpeg").size;
}

async function newProcessPid(executableName: string, before: ReadonlySet<number>): Promise<number> {
  return until(() => {
    const candidates = [...matchingProcessPids(executableName)].filter((pid) => !before.has(pid));
    return candidates.length === 1 ? candidates[0] : undefined;
  }, 5_000, `could not identify the new ${executableName} process`);
}

async function crashProcess(pid: number, label: string): Promise<void> {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    throw new Error(`could not crash ${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
  await until(
    () => existsSync(`/proc/${pid}`) ? undefined : true,
    5_000,
    `${label} process ${pid} did not exit`,
  );
}

function createBrowserFixture(root: string, browserBinary: string): string {
  const html = path.join(root, "load.html");
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><title>Bot Screen load</title>
<style>html{font:28px sans-serif;background:#102033;color:#fff}body{margin:0;min-height:24000px;background:repeating-linear-gradient(#102033 0 120px,#284d70 120px 240px)}#status{position:fixed;inset:20px 20px auto 20px;padding:20px;background:#000c;border:3px solid #7df}</style>
<div id="status">ready</div><script>let n=0;const s=document.querySelector('#status');for(const event of ['wheel','pointermove','keydown'])addEventListener(event,()=>{s.textContent=event+':'+(++n);s.style.background=n%2?'#8b1e3f':'#14532d'});</script>`);
  const launcher = path.join(root, "bot-screen-browser");
  writeFileSync(launcher, `#!/bin/sh
exec ${JSON.stringify(browserBinary)} --user-data-dir="$XDG_STATE_HOME/brave" --no-first-run --no-default-browser-check --disable-background-networking --disable-sync --password-store=basic --ozone-platform=wayland --app="file://${html}"
`);
  chmodSync(launcher, 0o755);
  return launcher;
}

async function runRow(profile: "1080p" | "720p", count: number, durationMs: number): Promise<Record<string, unknown>> {
  const admissionRow = profile === "1080p" && count === BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.defaultCapacity;
  const harness = await startDaemon(undefined, {
    useProductionBotScreen: true,
    botScreenCapacity: admissionRow ? count : 8,
  });
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
  let overflowOwner: Owner | undefined;
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
  let churnAttempts = 0;
  const churnFailures: string[] = [];
  let nativePeerAttempts = 0;
  let nativePeerSuccesses = 0;
  const nativePeerFailures: string[] = [];
  const connectExpandedWithRecovery = async (
    owner: Owner,
    label: string,
    kind: "setup" | "churn" | "failure",
  ): Promise<ProjectionClient> => {
    const failures: Error[] = [];
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let candidate: ProjectionClient | undefined;
      nativePeerAttempts += 1;
      if (kind === "churn") churnAttempts += 1;
      try {
        candidate = await ProjectionClient.connect(harness, owner, `${label}-attempt-${attempt}`);
        await candidate.mode("expanded");
        await candidate.waitForFrame(0);
        nativePeerSuccesses += 1;
        return candidate;
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        failures.push(failure);
        const detail = `${kind} surface=${owner.surfaceId} attempt=${attempt}: ${failure.message}`;
        nativePeerFailures.push(detail);
        if (kind === "churn") churnFailures.push(detail);
        if (candidate !== undefined) await candidate.close(harness).catch(() => undefined);
      }
    }
    throw new AggregateError(
      failures,
      `Screen Projection did not recover ${owner.surfaceId} within three fresh peer attempts`,
    );
  };
  let takeoverCompleted = false;
  let crashes: Array<Record<string, unknown>> = [];
  let admission: Record<string, unknown> | null = null;
  let unopenedNoRuntime = false;
  let idleEncodeProcessesObserved = 0;
  let staticPreviewEncodeProcessesObserved = 0;
  let expandedEncoderProcessesObserved = 0;
  let postExpandedEncoderProcessesObserved = 0;
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
    const workloadApplication = process.env.OMARCHY_BOT_LOAD_APP_BIN;
    if (workloadApplication === undefined) throw new Error("capacity workload application is unavailable");
    await Promise.all(owners.map((owner, index) =>
      harness.svc.screens.act(
        owner,
        { name: "open_app", args: { app: workloadApplication } },
        { ...owner, turnId: `workload-turn-${profile}-${count}-${index}` },
      )
    ));
    await Bun.sleep(500);
    console.log(`Bot Screen load ${profile}/${count}: visual workloads launched`);
    const generationBySurface = new Map<SurfaceId, number>();
    for (const owner of owners) generationBySurface.set(owner.surfaceId, await currentGeneration(harness, owner));
    if (admissionRow) {
      const overflowBotId = await makeBot(harness, `${profile} capacity overflow`);
      const overflowBot = await api<{ surfaceId: SurfaceId }>(harness, "GET", `/api/bots/${overflowBotId}`);
      overflowOwner = { botId: overflowBotId, surfaceId: overflowBot.surfaceId };
      trackedSurfaceIds.add(overflowOwner.surfaceId);
      const openAttempt = harness.svc.screens.open(overflowOwner);
      const rejected = await apiStatus(
        harness,
        "GET",
        `/api/computer/state?botId=${overflowOwner.botId}&surfaceId=${overflowOwner.surfaceId}`,
      );
      admission = {
        capacity: count,
        openAttempt,
        rejected,
        noPartialRuntime: !existsSync(path.join(harness.svc.cfg.botScreenRuntimeDir, overflowOwner.surfaceId)),
        activeUnaffected: owners.every((owner) => harness.svc.screens.status(owner).state === "ready"),
        activeEnvelopeMaintained: false,
      };
    }

    idle = await resourceWindow(owners, generationBySurface, Math.min(durationMs, 2_000));
    for (let sample = 0; sample < 10; sample += 1) {
      idleEncodeProcessesObserved += activeEncoderCount();
      await Bun.sleep(50);
    }
    console.log(`Bot Screen load ${profile}/${count}: idle measured`);

    const finalWebBrowser = await FinalWebBrowserHarness.start(
      harness.baseUrl,
      (owner, sessionId) => ({
        projectionFailure: harness.svc.projections.failureDiagnostic(owner, sessionId),
        inputDiagnostics: harness.svc.db.query(
          `SELECT action_category, outcome, redacted_length, latency_ms
           FROM input_diagnostics WHERE surface_id = ? ORDER BY id`,
        ).all(owner.surfaceId),
      }),
    );
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
    for (let sample = 0; sample < 10; sample += 1) {
      staticPreviewEncodeProcessesObserved += activeEncoderCount();
      await Bun.sleep(50);
    }
    console.log(`Bot Screen load ${profile}/${count}: sustained static preview measured`);

    await Promise.all(browserSessions.map((session) => session.expand()));
    await until(
      () => activeEncoderCount() === count ? true : undefined,
      5_000,
      `expanded mode did not start exactly ${count} encoders`,
    );
    expandedEncoderProcessesObserved = activeEncoderCount();
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
    const browserMetrics = await Promise.all(browserSessions.map((session) =>
      session.finishWindow({ durationMs: active.durationMs })
    ));
    const productionEnds = browserSessions.map((session) => {
      const metrics = harness.svc.projections.loadMetrics(session.owner, session.projectionSessionId);
      if (metrics === undefined) throw new Error(`projection load metrics unavailable for ${session.owner.surfaceId}`);
      return metrics;
    });
    const expectedFrames = Math.floor(BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.targetFps * active.durationMs / 1_000);
    const metricDelta = (
      after: ProjectionLoadMetrics,
      before: ProjectionLoadMetrics,
      key: Exclude<keyof ProjectionLoadMetrics, "sessionId" | "surfaceId">,
    ): number => after[key] - before[key];
    const outstandingAt = (
      metrics: ProjectionLoadMetrics,
      browser: BrowserWindowMetric["pipelineBoundary"]["start"],
    ) => ({
      capture: Math.max(0, metrics.captureAttempts - metrics.sourceFrames),
      encode: Math.max(
        0,
        metrics.encoderInputs - metrics.invalidFrames - metrics.encodedFrames - metrics.encoderDrops,
      ),
      rtp: Math.max(
        0,
        metrics.encodedFrames - metrics.rtpSends - metrics.transportSkips - metrics.sendFailures,
      ),
      receive: Math.max(0, metrics.rtpSends - browser.received),
      decode: Math.max(0, browser.received - browser.decoded - browser.dropped),
      paint: Math.max(0, browser.decoded - browser.displayed),
    });
    const conservationShortfall = (
      input: number,
      output: number,
      categorizedDrops: number,
      outstandingBefore: number,
      outstandingAfter: number,
    ): number => Math.max(0, input + outstandingBefore - output - categorizedDrops - outstandingAfter);
    frameMetrics = browserMetrics.map((browserMetric, index) => {
      const before = productionStarts[index]!;
      const after = productionEnds[index]!;
      const captureAttempts = metricDelta(after, before, "captureAttempts");
      const sourceFrames = metricDelta(after, before, "sourceFrames");
      const encoderInputs = metricDelta(after, before, "encoderInputs");
      const encodedFrames = metricDelta(after, before, "encodedFrames");
      const sentFrames = metricDelta(after, before, "rtpSends");
      const encodedBytes = metricDelta(after, before, "encodedBytes");
      const preCaptureBackpressureSkips = metricDelta(after, before, "captureSkips");
      const encodedBackpressureDrops = metricDelta(after, before, "encoderDrops");
      const invalidFrameDrops = metricDelta(after, before, "invalidFrames");
      const transportUnavailableSkips = metricDelta(after, before, "transportSkips");
      const sendFailures = metricDelta(after, before, "sendFailures");
      const browserFrameDrops = browserMetric.pipelineBoundary.end.dropped
        - browserMetric.pipelineBoundary.start.dropped;
      const boundaryStart = outstandingAt(before, browserMetric.pipelineBoundary.start);
      const boundaryEnd = outstandingAt(after, browserMetric.pipelineBoundary.end);
      const transportDrops = conservationShortfall(
        sentFrames,
        browserMetric.receivedFrames,
        0,
        boundaryStart.receive,
        boundaryEnd.receive,
      );
      const decodeDrops = browserFrameDrops;
      const paintDrops = conservationShortfall(
        browserMetric.decodedFrames,
        browserMetric.displayedFrames,
        0,
        boundaryStart.paint,
        boundaryEnd.paint,
      );
      const unexplainedByStage = {
        capture: conservationShortfall(
          captureAttempts + preCaptureBackpressureSkips,
          sourceFrames,
          preCaptureBackpressureSkips,
          boundaryStart.capture,
          boundaryEnd.capture,
        ),
        encode: conservationShortfall(
          encoderInputs,
          encodedFrames,
          invalidFrameDrops + encodedBackpressureDrops,
          boundaryStart.encode,
          boundaryEnd.encode,
        ),
        rtp: conservationShortfall(
          encodedFrames,
          sentFrames,
          transportUnavailableSkips + sendFailures,
          boundaryStart.rtp,
          boundaryEnd.rtp,
        ),
        receive: conservationShortfall(
          sentFrames,
          browserMetric.receivedFrames,
          transportDrops,
          boundaryStart.receive,
          boundaryEnd.receive,
        ),
        decode: conservationShortfall(
          browserMetric.receivedFrames,
          browserMetric.decodedFrames,
          decodeDrops,
          boundaryStart.decode,
          boundaryEnd.decode,
        ),
        paint: conservationShortfall(
          browserMetric.decodedFrames,
          browserMetric.displayedFrames,
          paintDrops,
          boundaryStart.paint,
          boundaryEnd.paint,
        ),
      };
      const unexplainedDrops = Object.values(unexplainedByStage)
        .reduce((sum, value) => sum + value, 0);
      const captureLatencySamples = metricDelta(after, before, "captureLatencySamples");
      const captureLatencyTotalMs = metricDelta(after, before, "captureLatencyTotalMs");
      const encodeLatencySamples = metricDelta(after, before, "encodeLatencySamples");
      const encodeLatencyTotalMs = metricDelta(after, before, "encodeLatencyTotalMs");
      const seconds = active.durationMs / 1_000;
      return {
        ...browserMetric,
        sourceFrames,
        captureAttempts,
        encoderInputs,
        encodedFrames,
        sentFrames,
        transportDrops,
        decodeDrops,
        paintDrops,
        encodedBytes,
        encodedBitrateBps: Number((encodedBytes * 8 / seconds).toFixed(2)),
        sourceFps: Number((sourceFrames / seconds).toFixed(2)),
        encodedFps: Number((encodedFrames / seconds).toFixed(2)),
        sentFps: Number((sentFrames / seconds).toFixed(2)),
        preCaptureBackpressureSkips,
        encodedBackpressureDrops,
        transportUnavailableSkips,
        invalidFrameDrops,
        sendFailures,
        unexplainedDrops,
        pipelineBoundaryCarry: {
          start: boundaryStart,
          end: boundaryEnd,
          unexplainedByStage,
        },
        captureLatencyMs: {
          samples: captureLatencySamples,
          mean: captureLatencySamples === 0 ? null : Number((captureLatencyTotalMs / captureLatencySamples).toFixed(2)),
          lifetimeMax: Number(after.captureLatencyMaxMs.toFixed(2)),
        },
        encodeLatencyMs: {
          samples: encodeLatencySamples,
          mean: encodeLatencySamples === 0 ? null : Number((encodeLatencyTotalMs / encodeLatencySamples).toFixed(2)),
          lifetimeMax: Number(after.encodeLatencyMaxMs.toFixed(2)),
        },
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
    await until(
      () => activeEncoderCount() === 0 ? true : undefined,
      5_000,
      "expanded browser sessions retained H.264 encoders after disconnect",
    );
    postExpandedEncoderProcessesObserved = activeEncoderCount();

    // Native clients remain only for non-visual Takeover/reconnect fault setup.
    for (const [index, owner] of owners.entries()) {
      const client = await connectExpandedWithRecovery(
        owner,
        `${profile}-${count}-fault-${index}`,
        "setup",
      );
      clients.push(client);
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
      for (const [index, owner] of owners.entries()) {
        const recovered = await connectExpandedWithRecovery(
          owner,
          `${profile}-${count}-churn-${churn}-${index}`,
          "churn",
        );
        clients.push(recovered);
        churnConnections += 1;
      }
    }
    await Promise.all(clients.splice(0, clients.length).map((client) => client.close(harness)));

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

    const faultOwner = owners[0]!;
    const siblingReady = (): boolean =>
      owners.slice(1).every((owner) => harness.svc.screens.status(owner).state === "ready");
    for (const fault of ["capture-helper", "encoder"] as const) {
      const executableName = fault === "capture-helper" ? "omarchy-bot-wayland-capture" : "ffmpeg";
      const before = matchingProcessPids(executableName);
      const client = await connectExpandedWithRecovery(
        faultOwner,
        `${profile}-${count}-${fault}-failure`,
        "failure",
      );
      const pid = await newProcessPid(executableName, before);
      await crashProcess(pid, fault);
      const failureReason = fault === "capture-helper" ? "capture-failed" : "encoder-failed";
      await until(
        () => harness.svc.projections.failureDiagnostic(faultOwner, client.answer.sessionId)?.reason === failureReason
          ? true
          : undefined,
        5_000,
        `${fault} failure was not surfaced by Screen Projection`,
      );
      const query = `botId=${faultOwner.botId}&surfaceId=${faultOwner.surfaceId}`;
      const snapshot = await fetch(`${harness.baseUrl}/api/computer/snapshot?${query}`);
      crashes.push({
        surfaceId: faultOwner.surfaceId,
        role: fault,
        projectionFailure: failureReason,
        snapshotFallback: snapshot.status === 200
          && snapshot.headers.get("content-type") === "image/png"
          && snapshot.headers.get("cache-control") === "no-store",
        isolated: siblingReady(),
      });
      await until(
        () => client.peer.state() === "closed" ? true : undefined,
        5_000,
        `${fault} failure did not close its WebRTC peer`,
      );
    }

    let generation = await currentGeneration(harness, faultOwner);
    await killUnit(faultOwner, generation, "input");
    await until(
      () => harness.svc.screens.status(faultOwner).state === "failed" ? true : undefined,
      5_000,
      "input-helper crash was not observed",
    );
    crashes.push({ surfaceId: faultOwner.surfaceId, role: "input-helper", isolated: siblingReady() });
    startupMs.push(await waitReady(harness, faultOwner));

    generation = await currentGeneration(harness, faultOwner);
    await killUnit(faultOwner, generation, "compositor");
    await until(
      () => harness.svc.screens.status(faultOwner).state === "failed" ? true : undefined,
      5_000,
      "compositor crash was not observed",
    );
    crashes.push({ surfaceId: faultOwner.surfaceId, role: "compositor", isolated: siblingReady() });
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
    if (overflowOwner !== undefined) {
      try {
        teardownMs.push(await destroyBot(harness, overflowOwner));
      } catch {
        // The final daemon stop below retries any incomplete overflow cleanup.
      }
    }
    await harness.stop();
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
  const captureToBrowser = captureToBrowserSamples.length === 0
    ? {
        available: false,
        reason: "WebRTC H.264 did not negotiate an absolute capture timestamp",
      }
    : {
        available: true,
        source: "browser-paint",
        samples: captureToBrowserSamples,
        p50: Number(captureToBrowserP50!.toFixed(2)),
        p95: Number(captureToBrowserP95!.toFixed(2)),
      };
  const stageRatesPassed = frameMetrics.every((metric) =>
    metric.sourceFps !== undefined
    && metric.sourceFps >= BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.targetFps
    && metric.encodedFps !== undefined
    && metric.encodedFps >= BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.targetFps
    && metric.sentFps !== undefined
    && metric.sentFps >= BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.targetFps
    && metric.receivedFps >= BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.targetFps
    && metric.decodedFps >= BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.targetFps
    && metric.displayedFps >= BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.targetFps
    && metric.unexplainedDrops === 0
    && metric.targetFrameShortfall !== undefined
    && Object.values(metric.targetFrameShortfall).every((shortfall) => shortfall === 0)
  );
  const performancePassed = rowError === undefined
    && frameMetrics.length === count
    && staticPreviewFrameMetrics.length === count
    && staticPreviewFrameMetrics.every((metric) =>
      metric.displayedFrames > 0 && metric.displayedFps >= 0.5 && metric.displayedFps <= 1.5
    )
    && stageRatesPassed
    && p50 !== null
    && p95 !== null
    && simultaneousAgentAndWebInputCompleted
    && p50 <= BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.inputToVisibleP50LimitMs
    && (!admissionRow || p95 <= BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.inputToVisibleP95EnvelopeMs);
  if (admission !== null) admission.activeEnvelopeMaintained = performancePassed;
  const operationalPassed = rowError === undefined
    && frameMetrics.length === count
    && staticPreviewFrameMetrics.length === count
    && staticPreviewFrameMetrics.every((metric) => metric.displayedFrames > 0)
    && idleEncodeProcessesObserved === 0
    && staticPreviewEncodeProcessesObserved === 0
    && expandedEncoderProcessesObserved === count
    && postExpandedEncoderProcessesObserved === 0
    && simultaneousAgentAndWebInputCompleted
    && takeoverCompleted
    && churnConnections === count * 2
    && crashes.length === 4
    && crashes.every((crash) =>
      crash.isolated === true
      && (crash.role === "capture-helper" || crash.role === "encoder"
        ? crash.snapshotFallback === true
        : true)
    )
    && repeatedProvisionDestroy.length === 2
    && (cleanup as { clean?: boolean }).clean === true;
  const aggregateCaptureLatencySamples = frameMetrics.reduce(
    (sum, metric) => sum + (metric.captureLatencyMs?.samples ?? 0),
    0,
  );
  const aggregateEncodeLatencySamples = frameMetrics.reduce(
    (sum, metric) => sum + (metric.encodeLatencyMs?.samples ?? 0),
    0,
  );
  const aggregateMetrics = {
    sourceFrames: frameMetrics.reduce((sum, metric) => sum + (metric.sourceFrames ?? 0), 0),
    encodedFrames: frameMetrics.reduce((sum, metric) => sum + (metric.encodedFrames ?? 0), 0),
    sentFrames: frameMetrics.reduce((sum, metric) => sum + (metric.sentFrames ?? 0), 0),
    receivedFrames: frameMetrics.reduce((sum, metric) => sum + metric.receivedFrames, 0),
    decodedFrames: frameMetrics.reduce((sum, metric) => sum + metric.decodedFrames, 0),
    displayedFrames: frameMetrics.reduce((sum, metric) => sum + metric.displayedFrames, 0),
    encodedBytes: frameMetrics.reduce((sum, metric) => sum + (metric.encodedBytes ?? 0), 0),
    encodedBitrateBps: Number(frameMetrics.reduce((sum, metric) => sum + (metric.encodedBitrateBps ?? 0), 0).toFixed(2)),
    unexplainedDrops: frameMetrics.reduce((sum, metric) => sum + (metric.unexplainedDrops ?? 0), 0),
    captureLatencyMs: {
      samples: aggregateCaptureLatencySamples,
      mean: aggregateCaptureLatencySamples === 0
        ? null
        : Number((
            frameMetrics.reduce(
              (sum, metric) => sum + (metric.captureLatencyMs?.mean ?? 0) * (metric.captureLatencyMs?.samples ?? 0),
              0,
            ) / aggregateCaptureLatencySamples
          ).toFixed(2)),
      maximum: frameMetrics.reduce((maximum, metric) =>
        Math.max(maximum, metric.captureLatencyMs?.lifetimeMax ?? 0), 0),
    },
    encodeLatencyMs: {
      samples: aggregateEncodeLatencySamples,
      mean: aggregateEncodeLatencySamples === 0
        ? null
        : Number((
            frameMetrics.reduce(
              (sum, metric) => sum + (metric.encodeLatencyMs?.mean ?? 0) * (metric.encodeLatencyMs?.samples ?? 0),
              0,
            ) / aggregateEncodeLatencySamples
          ).toFixed(2)),
      maximum: frameMetrics.reduce((maximum, metric) =>
        Math.max(maximum, metric.encodeLatencyMs?.lifetimeMax ?? 0), 0),
    },
  };
  return {
    profile,
    runtime: "cage",
    screens: count,
    resolution: profile === "1080p" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 },
    targetFps: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.targetFps,
    durationMs,
    performancePassed,
    operationalPassed,
    supportStatus: performancePassed ? "supported" : "unsupported",
    ...(rowError === undefined ? {} : { error: rowError }),
    startupMs: { samples: startupMs, p50: percentile(startupMs, 0.5), p95: percentile(startupMs, 0.95) },
    teardownMs: { samples: teardownMs, p50: percentile(teardownMs, 0.5), p95: percentile(teardownMs, 0.95) },
    repeatedProvisionDestroy,
    inputToVisibleMs: { source: "browser-paint", samples: inputLatenciesMs.map((value) => Number(value.toFixed(2))), p50: p50 === null ? null : Number(p50.toFixed(2)), p95: p95 === null ? null : Number(p95.toFixed(2)) },
    captureToBrowserMs: captureToBrowser,
    frames: frameMetrics,
    browser: browserMetadata,
    staticPreview: {
      frames: staticPreviewFrameMetrics,
      resources: staticPreview ?? null,
      h264EncoderProcessesObserved: staticPreviewEncodeProcessesObserved,
    },
    idleResources: idle ?? null,
    encodingLifecycle: {
      unopenedNoRuntime,
      idleEncoderProcessesObserved: idleEncodeProcessesObserved,
      staticPreviewEncoderProcessesObserved: staticPreviewEncodeProcessesObserved,
      expandedEncoderProcessesObserved,
      postExpandedEncoderProcessesObserved,
    },
    nativePeerRecovery: {
      maxAttemptsPerConnection: 3,
      attempts: nativePeerAttempts,
      failures: nativePeerFailures.length,
      failureDetails: nativePeerFailures,
      successfulFreshFrames: nativePeerSuccesses,
    },
    activeResources: active ?? null,
    aggregateMetrics,
    admission,
    simultaneousAgentAndWebInputCompleted,
    takeoverCompleted,
    reconnects: churnConnections,
    reconnectRecovery: {
      maxAttemptsPerConnection: 3,
      attempts: churnAttempts,
      failures: churnFailures.length,
      failureDetails: churnFailures,
      successfulFreshFrames: churnConnections,
    },
    crashes,
    gpu: { before: gpuBefore, after: gpuAfter },
    cleanup,
  };
}


async function describeBinary(
  requested: string | undefined,
  fallback: string,
  versionArgs: readonly string[] = ["--version"],
): Promise<Record<string, unknown>> {
  const name = requested ?? fallback;
  const binary = Bun.which(name);
  if (binary === null) return { available: false, requested: name, versionArgs };
  const result = await command([binary, ...versionArgs]);
  return {
    available: result.status === 0,
    requested: name,
    path: binary,
    versionArgs,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} was not an object`);
  }
  return value as Record<string, unknown>;
}

function measuredNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`measured ${key} was unavailable`);
  }
  return value;
}

function measuredRange(frames: readonly Record<string, unknown>[], key: string): { minimum: number; maximum: number } {
  const values = frames.map((frame) => measuredNumber(frame, key));
  return { minimum: Math.min(...values), maximum: Math.max(...values) };
}

function candidateApproval(
  row: Record<string, unknown>,
  rows: readonly Record<string, unknown>[],
  machine: Record<string, unknown>,
  reportPath: string,
  reproducibleCommand: string,
): Record<string, unknown> {
  if (!Array.isArray(row.frames) || row.frames.length === 0) throw new Error("approved row lacked per-Screen frames");
  const frames = row.frames.map((frame, index) => objectRecord(frame, `frame ${index}`));
  const browser = objectRecord(row.browser, "browser provenance");
  const input = objectRecord(row.inputToVisibleMs, "input-to-visible metrics");
  const captureToBrowser = objectRecord(row.captureToBrowserMs, "capture-to-browser metrics");
  const staticPreview = objectRecord(row.staticPreview, "static preview");
  if (!Array.isArray(staticPreview.frames) || staticPreview.frames.length === 0) {
    throw new Error("approved row lacked static-preview frames");
  }
  const staticFrames = staticPreview.frames.map((frame, index) => objectRecord(frame, `static frame ${index}`));
  const total = objectRecord(objectRecord(row.activeResources, "active resources").total, "active resource totals");
  const aggregate = objectRecord(row.aggregateMetrics, "aggregate metrics");
  const drops = {
    preCaptureBackpressureSkips: frames.reduce((sum, frame) => sum + measuredNumber(frame, "preCaptureBackpressureSkips"), 0),
    invalidFrameDrops: frames.reduce((sum, frame) => sum + measuredNumber(frame, "invalidFrameDrops"), 0),
    encodedBackpressureDrops: frames.reduce((sum, frame) => sum + measuredNumber(frame, "encodedBackpressureDrops"), 0),
    transportUnavailableSkips: frames.reduce((sum, frame) => sum + measuredNumber(frame, "transportUnavailableSkips"), 0),
    transportDrops: frames.reduce((sum, frame) => sum + measuredNumber(frame, "transportDrops"), 0),
    decodeDrops: frames.reduce((sum, frame) => sum + measuredNumber(frame, "decodeDrops"), 0),
    paintDrops: frames.reduce((sum, frame) => sum + measuredNumber(frame, "paintDrops"), 0),
    unexplainedDrops: frames.reduce((sum, frame) => sum + measuredNumber(frame, "unexplainedDrops"), 0),
  };
  return {
    schemaVersion: 3,
    sourceReport: {
      schemaVersion: 3,
      path: reportPath,
    },
    measuredAt: new Date().toISOString(),
    machine,
    runtime: "cage",
    profile: row.profile,
    resolution: row.resolution,
    defaultCapacity: row.screens,
    capacityRows: rows.map((candidate) => ({
      profile: candidate.profile,
      screens: candidate.screens,
      supportStatus: candidate.supportStatus,
      ...(candidate.supportStatus === "unsupported"
        ? {
            reason: typeof candidate.error === "string"
              ? candidate.error
              : "the measured performance row did not pass the release threshold",
          }
        : {}),
    })),
    captureFrameRate: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.captureFrameRate,
    targetFps: row.targetFps,
    durationMs: row.durationMs,
    lifecycleProof: {
      strategy: "permanent-delete-and-fresh-provision",
      cyclesPerRow: Array.isArray(row.repeatedProvisionDestroy) ? row.repeatedProvisionDestroy.length : 0,
    },
    finalClient: {
      built: true,
      browser: machine.browser,
      mode: browser.mode,
      transport: "WebRTC H.264 video track",
      lanInterface: browser.lanInterface,
      lanEndpoint: browser.lanEndpoint,
      measurement: "daemon source/encode/send counters, browser WebRTC decode, video paint, and canvas readback",
    },
    observedSourceFps: measuredRange(frames, "sourceFps"),
    observedEncodedFps: measuredRange(frames, "encodedFps"),
    observedSentFps: measuredRange(frames, "sentFps"),
    observedReceivedFps: measuredRange(frames, "receivedFps"),
    observedDecodedFps: measuredRange(frames, "decodedFps"),
    observedDisplayedFps: measuredRange(frames, "displayedFps"),
    observedEncodedBytes: measuredNumber(aggregate, "encodedBytes"),
    observedEncodedBitrateBps: measuredNumber(aggregate, "encodedBitrateBps"),
    observedDrops: drops,
    observedInputToVisibleP50Ms: measuredNumber(input, "p50"),
    observedInputToVisibleP95Ms: measuredNumber(input, "p95"),
    observedCaptureToBrowserMs: captureToBrowser,
    staticPreviewDisplayedFps: measuredRange(staticFrames, "displayedFps"),
    activeResources: {
      pssMiB: measuredNumber(total, "pssMiB"),
      rssMiB: measuredNumber(total, "rssMiB"),
      cpuPercent: measuredNumber(total, "cpuPercent"),
    },
    compositorMemory: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.compositorMemory,
    admission: row.admission,
    inputToVisibleP50LimitMs: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.inputToVisibleP50LimitMs,
    inputToVisibleP95EnvelopeMs: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.inputToVisibleP95EnvelopeMs,
    reproducibleCommand,
  };
}


loadTest("measures sustained final-stack Bot Screen capacity and admission", async () => {
  const durationMs = Number(process.env.OMARCHY_BOT_LOAD_DURATION_MS ?? 15_000);
  if (!Number.isSafeInteger(durationMs) || durationMs < 1_000) {
    throw new Error("OMARCHY_BOT_LOAD_DURATION_MS must be an integer of at least 1000");
  }
  const matrix = process.env.OMARCHY_BOT_LOAD_MATRIX === undefined
    ? [...MATRIX]
    : process.env.OMARCHY_BOT_LOAD_MATRIX.split(",").map(Number);
  if (matrix.length === 0 || matrix.some((count) => !MATRIX.includes(count as typeof MATRIX[number]))) {
    throw new Error("OMARCHY_BOT_LOAD_MATRIX may contain only 1,2,4,8");
  }
  const includeFallback = process.env.OMARCHY_BOT_LOAD_FALLBACK !== "0";
  const reportPath = process.env.OMARCHY_BOT_LOAD_REPORT
    ?? path.join(os.tmpdir(), "omarchy-bot-screen-load-report.json");
  const approvalPath = process.env.OMARCHY_BOT_LOAD_APPROVAL
    ?? path.join(path.dirname(reportPath), "omarchy-bot-screen-capacity-approval.json");
  const reproducibleCommand = [
    "OMARCHY_BOT_REAL_SCREEN_LOAD=1",
    "OMARCHY_BOT_LOAD_MATRIX=1,2,4,8",
    "OMARCHY_BOT_LOAD_FALLBACK=1",
    "OMARCHY_BOT_LOAD_LAN_INTERFACE=<lan-interface>",
    "OMARCHY_BOT_LOAD_REPORT=<report.json>",
    "OMARCHY_BOT_LOAD_APPROVAL=<approval.json>",
    "bun test tests/integration/bot-screen-capacity.load.test.ts",
  ].join(" ");
  const [cage, ffmpeg, browser, gpu] = await Promise.all([
    describeBinary(process.env.OMARCHY_BOT_CAGE_BIN, "cage", ["-v"]),
    describeBinary(process.env.OMARCHY_BOT_FFMPEG_BIN, "ffmpeg", ["-version"]),
    describeBinary(process.env.OMARCHY_BOT_LOAD_BROWSER_BIN, "brave"),
    gpuSnapshot(),
  ]);
  const machine: Record<string, unknown> = {
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    logicalCpus: os.cpus().length,
    memoryMiB: Math.round(os.totalmem() / 1024 / 1024),
    cage,
    ffmpeg,
    browser,
    gpu,
  };
  const rows: Array<Record<string, unknown>> = [];
  const report: Record<string, unknown> = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "running",
    reproducibleCommand,
    configuration: {
      runtime: "cage",
      durationMs,
      matrix,
      fallback: includeFallback ? { profile: "720p", screens: 8 } : null,
      targetFps: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.targetFps,
      captureFrameRate: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.captureFrameRate,
      medianLatencyLimitMs: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.inputToVisibleP50LimitMs,
      p95LatencyEnvelopeMs: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.observedInputToVisibleP95Ms,
    },
    previousApprovedEnvelope: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL,
    machine,
    releaseGate: { passed: false, pending: true },
    operationalGate: { passed: false, pending: true },
    rows,
    chosenDefault: BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.defaultCapacity,
    candidateApproval: null,
  };
  const persistReport = (): void => {
    report.updatedAt = new Date().toISOString();
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  };
  persistReport();

  const prior = {
    application: process.env.OMARCHY_BOT_LOAD_APP_BIN,
    profile: process.env.OMARCHY_BOT_SCREEN_PROFILE,
    frameRate: process.env.OMARCHY_BOT_SCREEN_FRAME_RATE,
  };
  let fixtureRoot: string | undefined;
  let executionError: Error | undefined;
  try {
    const browserBinary = process.env.OMARCHY_BOT_LOAD_BROWSER_BIN
      ?? Bun.which("brave")
      ?? Bun.which("chromium")
      ?? Bun.which("chromium-browser");
    if (browserBinary === null || browserBinary === undefined) {
      throw new Error("the real load harness requires Brave or Chromium");
    }
    await buildFinalWebClient(path.resolve(import.meta.dir, "../.."));
    fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-screen-load-"));
    process.env.OMARCHY_BOT_LOAD_APP_BIN = createBrowserFixture(fixtureRoot, browserBinary);
    process.env.OMARCHY_BOT_SCREEN_FRAME_RATE = String(BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.captureFrameRate);
    process.env.OMARCHY_BOT_SCREEN_PROFILE = "1080p";
    for (const count of matrix) {
      try {
        rows.push(await runRow("1080p", count, durationMs));
      } catch (error) {
        rows.push({
          profile: "1080p",
          screens: count,
          resolution: { width: 1920, height: 1080 },
          performancePassed: false,
          operationalPassed: false,
          supportStatus: "unsupported",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      persistReport();
    }
    if (includeFallback) {
      process.env.OMARCHY_BOT_SCREEN_PROFILE = "720p";
      try {
        rows.push(await runRow("720p", 8, durationMs));
      } catch (error) {
        rows.push({
          profile: "720p",
          screens: 8,
          resolution: { width: 1280, height: 720 },
          performancePassed: false,
          operationalPassed: false,
          supportStatus: "unsupported",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      persistReport();
    }
  } catch (error) {
    executionError = error instanceof Error ? error : new Error(String(error));
  } finally {
    if (fixtureRoot !== undefined) rmSync(fixtureRoot, { recursive: true, force: true });
    for (const [name, value] of [
      ["OMARCHY_BOT_LOAD_APP_BIN", prior.application],
      ["OMARCHY_BOT_SCREEN_PROFILE", prior.profile],
      ["OMARCHY_BOT_SCREEN_FRAME_RATE", prior.frameRate],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  const chosenDefault = BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.defaultCapacity;
  let releaseGateError = executionError;
  let operationalGateError = executionError;
  if (executionError === undefined) {
    try {
      requireApprovedDefaultRow(rows, chosenDefault, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL);
    } catch (error) {
      releaseGateError = error instanceof Error ? error : new Error(String(error));
    }
    try {
      requireCompletedOperationalRows(rows);
    } catch (error) {
      operationalGateError = error instanceof Error ? error : new Error(String(error));
    }
  }
  report.releaseGate = releaseGateError === undefined
    ? { passed: true }
    : { passed: false, error: releaseGateError.message };
  report.operationalGate = operationalGateError === undefined
    ? { passed: true }
    : { passed: false, error: operationalGateError.message };
  const defaultRow = rows.find((row) => row.profile === "1080p" && row.screens === chosenDefault);
  report.admission = defaultRow?.admission ?? null;
  if (releaseGateError === undefined && operationalGateError === undefined && defaultRow !== undefined) {
    const approval = candidateApproval(
      defaultRow,
      rows,
      machine,
      reportPath,
      reproducibleCommand,
    );
    report.candidateApproval = approval;
    mkdirSync(path.dirname(approvalPath), { recursive: true });
    writeFileSync(approvalPath, `${JSON.stringify(approval, null, 2)}\n`);
    report.approvalPath = approvalPath;
  }
  report.status = "complete";
  persistReport();
  console.log(`BOT_SCREEN_LOAD_REPORT=${reportPath}`);
  if (report.candidateApproval !== null) console.log(`BOT_SCREEN_CAPACITY_APPROVAL=${approvalPath}`);

  if (operationalGateError !== undefined) throw operationalGateError;
  if (releaseGateError !== undefined) throw releaseGateError;
  expect(rows).toHaveLength(matrix.length + (includeFallback ? 1 : 0));
  expect(rows.every((row) => objectRecord(row.cleanup, "row cleanup").clean === true)).toBeTrue();
  expect(report.admission).toMatchObject({
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
    activeEnvelopeMaintained: true,
  });
}, 1_200_000);
