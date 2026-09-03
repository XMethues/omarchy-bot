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
import rtc, { type DataChannel, type PeerConnection } from "node-datachannel";
import type { SurfaceId } from "../../packages/domain/src/ids.ts";
import { api, apiStatus, makeBot, startDaemon, type Harness } from "./helpers/harness.ts";

const loadTest = process.env.OMARCHY_BOT_REAL_SCREEN_LOAD === "1" ? test : test.skip;
const ROLES = ["compositor", "application", "input", "worker"] as const;
const MATRIX = [1, 2, 4, 8] as const;

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
  readonly frameChannel: DataChannel;
  readonly controlChannel: DataChannel;
  readonly inputChannel: DataChannel;
  #pendingHeader: { sequence: number; chunkCount: number } | undefined;
  #chunks: Buffer[] = [];
  #authority: Authority | undefined;
  #authorityWaiters: Array<{ active: boolean; resolve: (authority: Authority) => void }> = [];
  #nextSequence = 1;

  private constructor(
    readonly owner: Owner,
    readonly answer: ProjectionAnswer,
    peer: PeerConnection,
    frameChannel: DataChannel,
    controlChannel: DataChannel,
    inputChannel: DataChannel,
  ) {
    this.peer = peer;
    this.frameChannel = frameChannel;
    this.controlChannel = controlChannel;
    this.inputChannel = inputChannel;
    frameChannel.onMessage((raw) => this.#onFrame(raw));
    inputChannel.onMessage((raw) => this.#onAuthority(raw));
  }

  static async connect(harness: Harness, owner: Owner, name: string): Promise<ProjectionClient> {
    const peer = new rtc.PeerConnection(name, { iceServers: [] });
    const described = Promise.withResolvers<void>();
    peer.onLocalDescription(() => described.resolve());
    const frameChannel = peer.createDataChannel("screen.frames.v1", { unordered: false });
    const controlChannel = peer.createDataChannel("screen.control.v1", { unordered: false });
    const inputChannel = peer.createDataChannel("screen.input.v1", { unordered: false });
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
        body: JSON.stringify({ type: "offer", sdp: offer.sdp }),
      },
    ), 15_000, "Screen Projection answer timed out");
    if (response.status !== 201) throw new Error(`projection signaling failed: ${response.status} ${await response.text()}`);
    const answer = await response.json() as ProjectionAnswer;
    peer.setRemoteDescription(answer.sdp, "answer");
    for (const candidate of answer.candidates) peer.addRemoteCandidate(candidate.candidate, candidate.sdpMid);
    await withTimeout(
      Promise.all([openChannel(frameChannel), openChannel(controlChannel), openChannel(inputChannel)]),
      10_000,
      "Screen Projection data channels did not open",
    );
    return new ProjectionClient(owner, answer, peer, frameChannel, controlChannel, inputChannel);
  }

  async mode(mode: "idle" | "preview" | "expanded"): Promise<Authority | undefined> {
    const authority = mode === "expanded" ? this.waitForAuthority(true) : undefined;
    if (!this.controlChannel.sendMessage(JSON.stringify({
      version: 1,
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
    await fetch(`${harness.baseUrl}/api/computer/projection?botId=${this.owner.botId}&surfaceId=${this.owner.surfaceId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: this.answer.sessionId }),
    }).catch(() => undefined);
    this.peer.close();
  }

  #sendInput(type: "pointer-motion" | "pointer-scroll", payload: Record<string, number>): number {
    if (this.#authority?.active !== true) throw new Error("Web Control authority is not active");
    const sequence = this.#nextSequence;
    this.#nextSequence += 1;
    const sent = this.inputChannel.sendMessage(JSON.stringify({
      version: 1,
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
      if (parsed.type !== "frame" || typeof parsed.sequence !== "number" || typeof parsed.chunkCount !== "number") return;
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
  await until(async () => {
    const response = await fetch(`${harness.baseUrl}/api/computer/state?botId=${owner.botId}&surfaceId=${owner.surfaceId}`);
    const view = await response.json() as { state?: string; activity?: string };
    if (view.state === "unavailable") throw new Error(view.activity ?? "Bot Screen unavailable");
    return view.state === "ready" ? true : undefined;
  }, 30_000, `Screen ${owner.surfaceId} did not become ready`);
  return Number((performance.now() - startedAt).toFixed(2));
}

async function archive(harness: Harness, owner: Owner): Promise<number> {
  const startedAt = performance.now();
  await api(harness, "POST", `/api/bots/${owner.botId}/archive`, {});
  return Number((performance.now() - startedAt).toFixed(2));
}

async function restore(harness: Harness, owner: Owner): Promise<number> {
  await api(harness, "POST", `/api/bots/${owner.botId}/restore`);
  return waitReady(harness, owner);
}

async function killUnit(owner: Owner, generation: number, role: "input" | "compositor"): Promise<void> {
  const result = await command(["systemctl", "--user", "kill", "--signal=KILL", unitName(owner.surfaceId, generation, role)]);
  if (result.status !== 0) throw new Error(`could not crash ${role}: ${result.stderr}`);
}

function activeCaptureCount(owners: Owner[]): number {
  const outputs = new Set(owners.map((owner) => `BOT-${owner.surfaceId.slice(-12).toUpperCase()}`));
  let count = 0;
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const commandLine = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
      if (path.basename(commandLine[0] ?? "") === "grim" && commandLine.some((argument) => outputs.has(argument))) {
        count += 1;
      }
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
<div id="status">ready</div><script>let n=0;const s=document.querySelector('#status');for(const event of ['wheel','pointermove','keydown'])addEventListener(event,()=>s.textContent=event+':'+(++n));</script>`);
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
  const startupMs: number[] = [];
  let simultaneousAgentAndWebInputCompleted = false;
  const teardownMs: number[] = [];
  const cycleStartupMs: number[] = [];
  const cycleTeardownMs: number[] = [];
  const inputLatenciesMs: number[] = [];
  let cleanup: Record<string, unknown> = { clean: false };
  let rowError: string | undefined;
  let idle!: ResourceWindow;
  let active!: ResourceWindow;
  let frameMetrics: Array<Record<string, unknown>> = [];
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
      owners.push({ botId, surfaceId: bot.surfaceId });
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
      idleEncodeProcessesObserved += activeCaptureCount(owners);
      await Bun.sleep(50);
    }

    console.log(`Bot Screen load ${profile}/${count}: idle measured`);
    for (const [index, owner] of owners.entries()) {
      const client = await ProjectionClient.connect(harness, owner, `${profile}-${count}-${index}`);
      clients.push(client);
      await client.mode("preview");
      const expected = profile === "1080p" ? [1920, 1080] : [1280, 720];
      if (client.answer.videoWidth !== expected[0] || client.answer.videoHeight !== expected[1]) {
        throw new Error(`projection used ${client.answer.videoWidth}x${client.answer.videoHeight}, expected ${expected.join("x")}`);
      }
    }
    await Promise.all(clients.map((client) => client.waitForFrame(1, 5_000)));
    await Promise.all(clients.map((client) => client.mode("expanded")));

    for (let sample = 0; sample < 5; sample += 1) {
      await Promise.all(clients.map(async (client) => {
        const baseline = client.frames.at(-1);
        if (baseline === undefined) throw new Error("expanded projection has no baseline frame");
        const sentAt = performance.now();
        client.sendScroll(
          Math.floor(client.answer.logicalWidth / 2),
          Math.floor(client.answer.logicalHeight / 2),
          sample % 2 === 0 ? 360 : -360,
        );
        const visible = await until(
          () => client.frames.find((frame) => frame.receivedAtMs >= sentAt && frame.digest !== baseline.digest),
          5_000,
          `Screen ${client.owner.surfaceId} did not show Web input`,
        );
        inputLatenciesMs.push(visible.receivedAtMs - sentAt);
      }));
    }
    console.log(`Bot Screen load ${profile}/${count}: input latency measured`);

    const frameStart = new Map(clients.map((client) => [client.owner.surfaceId, client.frames.at(-1)?.sequence ?? 0]));
    const agentActions = Promise.all(owners.map(async (owner) => {
      const source = await harness.svc.screens.projectionSource(owner);
      if (source === undefined) throw new Error(`Agent input source ${owner.surfaceId} is unavailable`);
      await source.input({ type: "key", keyCode: 57, state: "pressed" });
      await source.input({ type: "key", keyCode: 57, state: "released" });
    }));
    const activeStartedAt = performance.now();
    active = await resourceWindow(owners, generationBySurface, durationMs, async (deadline) => {
      let step = 0;
      while (performance.now() < deadline) {
        for (const client of clients) {
          const x = 100 + (step * 37) % Math.max(1, client.answer.logicalWidth - 200);
          const y = 100 + (step * 19) % Math.max(1, client.answer.logicalHeight - 200);
          client.sendMotion(x, y);
          if (step % 4 === 0) client.sendScroll(x, y, step % 8 === 0 ? 240 : -240);
        }
        step += 1;
        await Bun.sleep(50);
      }
    });
    const activeElapsedMs = performance.now() - activeStartedAt;
    const frameEnd = new Map(clients.map((client) => [client.owner.surfaceId, client.frames.at(-1)?.sequence ?? 0]));
    await withTimeout(agentActions, 15_000, "simultaneous Agent input did not complete");
    simultaneousAgentAndWebInputCompleted = true;
    frameMetrics = clients.map((client) => {
      const first = frameStart.get(client.owner.surfaceId) ?? 0;
      const delivered = client.frames.filter((frame) =>
        frame.sequence > first && frame.sequence <= (frameEnd.get(client.owner.surfaceId) ?? 0)
      );
      const expected = Math.floor(activeElapsedMs * 15 / 1_000);
      let sequenceGaps = 0;
      for (let index = 1; index < delivered.length; index += 1) {
        sequenceGaps += Math.max(0, delivered[index]!.sequence - delivered[index - 1]!.sequence - 1);
      }
      return {
        surfaceId: client.owner.surfaceId,
        deliveredFrames: delivered.length,
        actualFps: Number((delivered.length / (activeElapsedMs / 1_000)).toFixed(2)),
        droppedFrames: { sequenceGaps, targetFrameShortfall: Math.max(0, expected - delivered.length) },
      };
    });
    console.log(`Bot Screen load ${profile}/${count}: active delivery measured`);

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
        const client = await ProjectionClient.connect(harness, owner, `${profile}-${count}-churn-${churn}-${index}`);
        clients.push(client);
        await client.mode("expanded");
        await client.waitForFrame(0);
        churnConnections += 1;
      }
    }
    await Promise.all(clients.splice(0, clients.length).map((client) => client.close(harness)));

    console.log(`Bot Screen load ${profile}/${count}: reconnect churn completed`);
    if (owners.length > 0) {
      for (let cycle = 0; cycle < 2; cycle += 1) {
        cycleTeardownMs.push(await archive(harness, owners[0]!));
        cycleStartupMs.push(await restore(harness, owners[0]!));
      }
    }

    const crashTargets = owners.slice(0, Math.min(2, owners.length));
    for (const [index, owner] of crashTargets.entries()) {
      const generation = await currentGeneration(harness, owner);
      const role = index === 0 && owners.length > 1 ? "input" as const : "compositor" as const;
      await killUnit(owner, generation, role);
      await until(
        () => harness.svc.screens.state(owner).state === "failed" ? true : undefined,
        5_000,
        `${role} crash was not observed`,
      );
      crashes.push({ surfaceId: owner.surfaceId, role, isolated: owners.slice(crashTargets.length).every((active) => harness.svc.screens.state(active).state === "ready") });
    }
  } catch (error) {
    rowError = error instanceof Error ? error.message : String(error);
  } finally {
    await Promise.all(clients.splice(0, clients.length).map((client) => client.close(harness)));
    for (const owner of owners) {
      try {
        if ((await api<{ archived: boolean }>(harness, "GET", `/api/bots/${owner.botId}`)).archived !== true) {
          teardownMs.push(await archive(harness, owner));
        }
        await api(harness, "DELETE", `/api/bots/${owner.botId}`, { confirmName: `${profile} load ${count}-${owners.indexOf(owner)}` });
      } catch {
        // The final daemon stop below retries any incomplete runtime cleanup.
      }
    }
    await harness.stop();
    const unitList = Bun.which("systemctl") === null
      ? ""
      : (await command(["systemctl", "--user", "list-units", "--all", "--plain", "--no-legend", "omarchy-bot-screen-*"])).stdout;
    cleanup = {
      clean: owners.every((owner) =>
        !existsSync(path.join(harness.svc.cfg.botScreenRuntimeDir, owner.surfaceId))
        && !existsSync(path.join(harness.svc.cfg.botScreenProfileDir, owner.surfaceId))
        && !unitList.includes(owner.surfaceId.slice(5))
      ),
      residualRuntimeDirs: owners.filter((owner) => existsSync(path.join(harness.svc.cfg.botScreenRuntimeDir, owner.surfaceId))).map((owner) => owner.surfaceId),
      residualProfileDirs: owners.filter((owner) => existsSync(path.join(harness.svc.cfg.botScreenProfileDir, owner.surfaceId))).map((owner) => owner.surfaceId),
      residualUnits: owners.filter((owner) => unitList.includes(owner.surfaceId.slice(5))).map((owner) => owner.surfaceId),
    };
  }
  const gpuAfter = await gpuSnapshot();
  const p50 = percentile(inputLatenciesMs, 0.5);
  const p95 = percentile(inputLatenciesMs, 0.95);
  const performancePassed = rowError === undefined
    && frameMetrics.length === count
    && frameMetrics.every((metric) => Number(metric.actualFps) >= 15)
    && p50 !== null
    && simultaneousAgentAndWebInputCompleted
    && p50 <= 200;
  return {
    profile,
    screens: count,
    resolution: profile === "1080p" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 },
    targetFps: 15,
    durationMs,
    performancePassed,
    ...(rowError === undefined ? {} : { error: rowError }),
    startupMs: { samples: startupMs, p50: percentile(startupMs, 0.5), p95: percentile(startupMs, 0.95) },
    teardownMs: { samples: teardownMs, p50: percentile(teardownMs, 0.5), p95: percentile(teardownMs, 0.95) },
    repeatedCycles: { startupMs: cycleStartupMs, teardownMs: cycleTeardownMs },
    inputToVisibleMs: { samples: inputLatenciesMs.map((value) => Number(value.toFixed(2))), p50: p50 === null ? null : Number(p50.toFixed(2)), p95: p95 === null ? null : Number(p95.toFixed(2)) },
    frames: frameMetrics,
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
    const rejected = await apiStatus(harness, "GET", `/api/computer/state?botId=${owners[capacity]!.botId}&surfaceId=${owners[capacity]!.surfaceId}`);
    const noPartialRuntime = !existsSync(path.join(harness.svc.cfg.botScreenRuntimeDir, owners[capacity]!.surfaceId));
    const activeUnaffected = owners.slice(0, capacity).every((owner) => harness.svc.screens.state(owner).state === "ready");
    return { capacity, rejected, noPartialRuntime, activeUnaffected };
  } finally {
    for (const owner of owners) await archive(harness, owner).catch(() => undefined);
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
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-screen-load-"));
  const prior = {
    application: process.env.OMARCHY_BOT_SCREEN_APP_BIN,
    profile: process.env.OMARCHY_BOT_SCREEN_PROFILE,
    frameRate: process.env.OMARCHY_BOT_SCREEN_FRAME_RATE,
  };
  process.env.OMARCHY_BOT_SCREEN_APP_BIN = createBrowserFixture(fixtureRoot);
  process.env.OMARCHY_BOT_SCREEN_FRAME_RATE = "16";
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
  const passing1080 = rows
    .filter((row) => row.profile === "1080p" && row.performancePassed === true)
    .map((row) => Number(row.screens));
  const chosenDefault = Math.max(1, ...passing1080.filter((count) => count <= 4));
  const admission = await admissionProof(chosenDefault);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    reproducibleCommand: "OMARCHY_BOT_REAL_SCREEN_LOAD=1 bun test tests/integration/bot-screen-capacity.load.test.ts",
    configuration: { durationMs, matrix, fallback: includeFallback ? { profile: "720p", screens: 8 } : null, targetFps: 15, captureFrameRate: 16, medianLatencyLimitMs: 200 },
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
  expect(rows).toHaveLength(matrix.length + (includeFallback ? 1 : 0));
  expect(rows.every((row) => (row.cleanup as { clean?: boolean }).clean === true)).toBeTrue();
  expect(admission).toMatchObject({ noPartialRuntime: true, activeUnaffected: true });
}, 1_200_000);
