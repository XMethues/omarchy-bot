import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SurfaceId } from "../../../packages/domain/src/ids.ts";
import { command, percentile, type ScreenOwner } from "./bot-screen-load-observe.ts";
import type { Harness } from "./harness.ts";

export const REAL_SWAY_ENV = "OMARCHY_BOT_REAL_SWAY";
export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const RFB_BANNER = new Uint8Array([
  0x52, 0x46, 0x42, 0x20, 0x30, 0x30, 0x33, 0x2e, 0x30, 0x30, 0x38, 0x0a,
]);
export const RFB_POINTER_EVENT = new Uint8Array([5, 1, 0, 10, 0, 20]);
export const UNICODE_SAMPLE = "你好, world";

export const CITED_FAKE_PROOFS = [
  {
    item: "Takeover, stale generation/epoch/sequence rejection, held-input release",
    files: [
      "tests/integration/screen-projection.test.ts",
      "tests/integration/bot-screen-lifecycle.test.ts",
    ],
    notes: "Fake RFB / scripted Sway. Not re-run as fake-only ticket-09 proof.",
  },
  {
    item: "Bot A→B switch, shared WayVNC refcount, RFB-failed snapshot fallback, sibling isolation",
    files: ["tests/integration/bot-screen-sway-projection.test.ts"],
    notes: "Scripted Sway + echo WayVNC. Ticket 09 re-proves the same seams on real Sway/WayVNC.",
  },
  {
    item: "Daemon restart reattach, invalid-tree reprovision, capacity reject, deletion vs Shared Workspace",
    files: [
      "tests/integration/bot-screen-lifecycle.test.ts",
      "tests/integration/bot-screen-sway-runtime.test.ts",
    ],
    notes: "Scripted Sway binaries and persisted fake pids. Real deletion/reprovision is in this harness.",
  },
  {
    item: "Native window list/focus, observe, input authority, Unicode paste path",
    files: ["tests/integration/bot-screen-sway-control.test.ts"],
    notes: "Fake i3-ipc tree. Live browser/terminal visibility is this harness.",
  },
] as const;

export const HUMAN_ONLY_HOST_CHECKS = [
  "Original Omarchy top bar remains clickable and visually available during Bot desktop start, work, switching, failure, and cleanup",
  "Existing Omarchy keyboard shortcuts continue to fire in the Host Session through the same lifecycle",
  "Ordinary host focus and physical pointer/keyboard input stay independent of Bot-generated input",
  "The user can switch Bots while using the host desktop and confirm selected pixels/input belong to the correct Bot",
  "Sibling Bot screenshots or service existence do not prove host usability",
] as const;


export interface HostIsolationSnapshot {
  observedAt: string;
  compositorPid: number | null;
  compositorCmd: string | null;
  compositorStartTime: string | null;
  waylandDisplay: string | null;
  swaySock: string | null;
  xdgRuntimeDir: string | null;
  hyprlandInstance: string | null;
  hostClientTitles: string[];
  hostClientCount: number;
}

export interface LatencyDistribution {
  samples: number[];
  min: number | null;
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface CostBucket {
  pssMiB: number;
  swapPssMiB: number;
  rssMiB: number;
  cpuPercent: number;
  processes: number;
}

export interface SwayCostAttribution {
  swayInfrastructure: CostBucket;
  wayvncProjection: CostBucket;
  applicationAgent: CostBucket;
  daemon: CostBucket;
  harnessNote: string;
  unknown: CostBucket;
  wholeScenario: CostBucket;
}

export interface CheckResult {
  id: string;
  passed: boolean;
  evidence: string;
  leftover?: string;
}

export function digest(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

export function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

export function distribution(values: number[]): LatencyDistribution {
  return {
    samples: values,
    min: values.length === 0 ? null : Math.min(...values),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length === 0 ? null : Math.max(...values),
  };
}

export async function until<T>(
  probe: () => T | undefined | Promise<T | undefined>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (performance.now() >= deadline) throw new Error(message);
    await Bun.sleep(40);
  }
}

export function hostProcessEnv(key: string): string | null {
  return process.env[key] ?? null;
}

function compositorStartTime(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

export async function snapshotHostIsolation(): Promise<HostIsolationSnapshot> {
  const compositor = await command(["pgrep", "-a", "-x", "Hyprland"]);
  const line = compositor.stdout.split("\n").find((row) => row.trim() !== "");
  const compositorPid = line === undefined ? null : Number(line.split(/\s+/, 1)[0]);
  const compositorCmd = line?.replace(/^\d+\s+/, "") ?? null;
  let hostClientTitles: string[] = [];
  if (Bun.which("hyprctl") !== null) {
    const clients = await command(["hyprctl", "clients", "-j"]);
    if (clients.status === 0 && clients.stdout !== "") {
      try {
        const parsed = JSON.parse(clients.stdout) as Array<{ title?: string; class?: string }>;
        hostClientTitles = parsed.map((client) => `${client.class ?? "?"}:${client.title ?? ""}`);
      } catch {
        hostClientTitles = [];
      }
    }
  }
  return {
    observedAt: new Date().toISOString(),
    compositorPid: Number.isSafeInteger(compositorPid) ? compositorPid : null,
    compositorCmd,
    compositorStartTime: compositorPid === null ? null : compositorStartTime(compositorPid),
    waylandDisplay: hostProcessEnv("WAYLAND_DISPLAY"),
    swaySock: hostProcessEnv("SWAYSOCK"),
    xdgRuntimeDir: hostProcessEnv("XDG_RUNTIME_DIR"),
    hyprlandInstance: hostProcessEnv("HYPRLAND_INSTANCE_SIGNATURE"),
    hostClientTitles,
    hostClientCount: hostClientTitles.length,
  };
}

export function isolationUnchanged(
  before: HostIsolationSnapshot,
  after: HostIsolationSnapshot,
): { ok: boolean; deltas: string[] } {
  const deltas: string[] = [];
  if (before.compositorPid !== after.compositorPid) {
    deltas.push(`compositor PID ${before.compositorPid} → ${after.compositorPid}`);
  }
  if (before.compositorStartTime !== after.compositorStartTime) {
    deltas.push("compositor starttime changed (process was replaced)");
  }
  if (before.waylandDisplay !== after.waylandDisplay) {
    deltas.push(`WAYLAND_DISPLAY ${before.waylandDisplay} → ${after.waylandDisplay}`);
  }
  if (before.swaySock !== after.swaySock) {
    deltas.push(`SWAYSOCK ${before.swaySock} → ${after.swaySock}`);
  }
  if (before.hyprlandInstance !== after.hyprlandInstance) {
    deltas.push("HYPRLAND_INSTANCE_SIGNATURE changed");
  }
  return { ok: deltas.length === 0, deltas };
}

export function processMemory(pid: number): { pssKiB: number; swapPssKiB: number; rssKiB: number; ticks: number } | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const ticks = Number(fields[11]) + Number(fields[12]);
    const rollup = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
    const pssKiB = Number(/^Pss:\s+(\d+) kB$/m.exec(rollup)?.[1] ?? 0);
    const swapPssKiB = Number(/^SwapPss:\s+(\d+) kB$/m.exec(rollup)?.[1] ?? 0);
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const rssKiB = Number(/^VmRSS:\s+(\d+) kB$/m.exec(status)?.[1] ?? 0);
    return { pssKiB, swapPssKiB, rssKiB, ticks };
  } catch {
    return undefined;
  }
}

export function netDevBytes(): { rxBytes: number; txBytes: number } {
  try {
    let rxBytes = 0;
    let txBytes = 0;
    for (const line of readFileSync("/proc/net/dev", "utf8").split("\n").slice(2)) {
      const parts = line.trim().split(/[:\s]+/).filter((part) => part !== "");
      if (parts.length < 10) continue;
      rxBytes += Number(parts[1] ?? 0);
      txBytes += Number(parts[9] ?? 0);
    }
    return { rxBytes, txBytes };
  } catch {
    return { rxBytes: 0, txBytes: 0 };
  }
}

export interface SampledProcess {
  pid: number;
  executable: string;
  bucket: "swayInfrastructure" | "wayvncProjection" | "applicationAgent" | "unknown";
  pssMiB: number;
  swapPssMiB: number;
  rssMiB: number;
  cpuPercent: number;
}

function classifySwayExecutable(executable: string): SampledProcess["bucket"] {
  const name = executable.toLowerCase();
  if (name === "wayvnc") return "wayvncProjection";
  if (
    name === "sway"
    || name === "swaymsg"
    || name === "wlr-randr"
    || name.includes("bot-desktop")
    || name.includes("wayland-input")
    || name.includes("wayland-capture")
    || name === "grim"
  ) {
    return "swayInfrastructure";
  }
  if (
    name.includes("brave")
    || name.includes("chrom")
    || name.includes("firefox")
    || name.includes("alacritty")
    || name.includes("ghostty")
    || name.includes("foot")
    || name === "bun"
    || name.includes("worker")
  ) {
    return "applicationAgent";
  }
  return "unknown";
}

export function surfaceProcesses(surfaceId: SurfaceId): SampledProcess[] {
  const processes: SampledProcess[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf8");
      const environment = readFileSync(`/proc/${entry}/environ`, "utf8");
      if (!cmdline.includes(surfaceId) && !environment.includes(surfaceId)) continue;
      const pid = Number(entry);
      const memory = processMemory(pid);
      if (memory === undefined) continue;
      const executable = path.basename(cmdline.split("\0")[0] ?? "") || "unknown";
      processes.push({
        pid,
        executable,
        bucket: classifySwayExecutable(executable),
        pssMiB: Number((memory.pssKiB / 1024).toFixed(2)),
        swapPssMiB: Number((memory.swapPssKiB / 1024).toFixed(2)),
        rssMiB: Number((memory.rssKiB / 1024).toFixed(2)),
        cpuPercent: 0,
      });
    } catch {
      // Processes may exit while /proc is sampled.
    }
  }
  return processes.sort((left, right) => left.pid - right.pid);
}

export async function measureSwayCosts(
  owners: ScreenOwner[],
  durationMs: number,
  activity?: () => Promise<void>,
): Promise<{ durationMs: number; processes: SampledProcess[]; attribution: SwayCostAttribution; network: { rxBytes: number; txBytes: number } }> {
  const hertzResult = await command(["getconf", "CLK_TCK"]);
  const hertz = Number(hertzResult.stdout) || 100;
  const beforeTicks = new Map<number, number>();
  const daemonBefore = processMemory(process.pid);
  const netBefore = netDevBytes();
  for (const owner of owners) {
    for (const sample of surfaceProcesses(owner.surfaceId)) {
      const memory = processMemory(sample.pid);
      if (memory !== undefined) beforeTicks.set(sample.pid, memory.ticks);
    }
  }
  const startedAt = performance.now();
  if (activity === undefined) await Bun.sleep(durationMs);
  else await activity();
  const elapsedMs = performance.now() - startedAt;
  const netAfter = netDevBytes();
  const processes: SampledProcess[] = [];
  for (const owner of owners) {
    for (const sample of surfaceProcesses(owner.surfaceId)) {
      const memory = processMemory(sample.pid);
      if (memory === undefined) continue;
      const firstTicks = beforeTicks.get(sample.pid);
      const ticks = firstTicks === undefined ? 0 : Math.max(0, memory.ticks - firstTicks);
      processes.push({
        ...sample,
        pssMiB: Number((memory.pssKiB / 1024).toFixed(2)),
        swapPssMiB: Number((memory.swapPssKiB / 1024).toFixed(2)),
        rssMiB: Number((memory.rssKiB / 1024).toFixed(2)),
        cpuPercent: Number(((ticks / hertz) / (elapsedMs / 1000) * 100).toFixed(2)),
      });
    }
  }
  const daemonAfter = processMemory(process.pid);
  const empty = (): CostBucket => ({ pssMiB: 0, swapPssMiB: 0, rssMiB: 0, cpuPercent: 0, processes: 0 });
  const add = (bucket: CostBucket, sample: { pssMiB: number; swapPssMiB: number; rssMiB: number; cpuPercent: number }): void => {
    bucket.pssMiB = Number((bucket.pssMiB + sample.pssMiB).toFixed(2));
    bucket.swapPssMiB = Number((bucket.swapPssMiB + sample.swapPssMiB).toFixed(2));
    bucket.rssMiB = Number((bucket.rssMiB + sample.rssMiB).toFixed(2));
    bucket.cpuPercent = Number((bucket.cpuPercent + sample.cpuPercent).toFixed(2));
    bucket.processes += 1;
  };
  const swayInfrastructure = empty();
  const wayvncProjection = empty();
  const applicationAgent = empty();
  const unknown = empty();
  for (const sample of processes) {
    if (sample.bucket === "swayInfrastructure") add(swayInfrastructure, sample);
    else if (sample.bucket === "wayvncProjection") add(wayvncProjection, sample);
    else if (sample.bucket === "applicationAgent") add(applicationAgent, sample);
    else add(unknown, sample);
  }
  const daemon: CostBucket = {
    pssMiB: Number(((daemonAfter?.pssKiB ?? 0) / 1024).toFixed(2)),
    swapPssMiB: Number(((daemonAfter?.swapPssKiB ?? 0) / 1024).toFixed(2)),
    rssMiB: Number(((daemonAfter?.rssKiB ?? 0) / 1024).toFixed(2)),
    cpuPercent: Number((
      ((daemonAfter?.ticks ?? 0) - (daemonBefore?.ticks ?? 0))
      / hertz
      / (elapsedMs / 1_000)
      * 100
    ).toFixed(2)),
    processes: 1,
  };
  const wholeScenario: CostBucket = {
    pssMiB: Number((swayInfrastructure.pssMiB + wayvncProjection.pssMiB + applicationAgent.pssMiB + unknown.pssMiB + daemon.pssMiB).toFixed(2)),
    swapPssMiB: Number((swayInfrastructure.swapPssMiB + wayvncProjection.swapPssMiB + applicationAgent.swapPssMiB + unknown.swapPssMiB + daemon.swapPssMiB).toFixed(2)),
    rssMiB: Number((swayInfrastructure.rssMiB + wayvncProjection.rssMiB + applicationAgent.rssMiB + unknown.rssMiB + daemon.rssMiB).toFixed(2)),
    cpuPercent: Number((swayInfrastructure.cpuPercent + wayvncProjection.cpuPercent + applicationAgent.cpuPercent + unknown.cpuPercent + daemon.cpuPercent).toFixed(2)),
    processes: swayInfrastructure.processes + wayvncProjection.processes + applicationAgent.processes + unknown.processes + daemon.processes,
  };
  return {
    durationMs: Number(elapsedMs.toFixed(2)),
    processes,
    attribution: {
      swayInfrastructure,
      wayvncProjection,
      applicationAgent,
      daemon,
      harnessNote: "daemon and test harness share this process; daemon bucket is the combined measurement",
      unknown,
      wholeScenario,
    },
    network: {
      rxBytes: Math.max(0, netAfter.rxBytes - netBefore.rxBytes),
      txBytes: Math.max(0, netAfter.txBytes - netBefore.txBytes),
    },
  };
}

export function waitFor<T>(
  description: string,
  subscribe: (resolve: (value: T) => void, reject: (error: Error) => void) => void,
  timeoutMs = 8_000,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${description} timed out`)), timeoutMs);
    subscribe(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}


export function createIsolationPage(root: string, label: string, color: string): string {
  const html = path.join(root, `${label}.html`);
  writeFileSync(html, `<!doctype html><meta charset="utf-8"><title>${label}</title>
<style>html,body{margin:0;height:100%;background:${color};color:#fff;font:48px sans-serif}
#status{padding:40px}#box{width:240px;height:240px;background:#111;margin:40px}
#editor{position:absolute;left:40px;top:140px;width:260px;height:60px;font:24px sans-serif}</style>
<div id="status">${label} tick:0</div><textarea id="editor" autofocus></textarea><div id="box"></div>
<script>
const label=${JSON.stringify(label)};
let ticks=0, clicks=0, revision=0, observeState=false;
const status=document.querySelector('#status');
const editor=document.querySelector('#editor');
const box=document.querySelector('#box');
function publish(){document.title=label+' state:'+JSON.stringify({value:editor.value,counter:ticks,revision:++revision});}
setInterval(()=>{ticks+=1;status.textContent=label+' tick:'+ticks;if(observeState)publish();},400);
addEventListener('pointerdown',()=>{clicks+=1;box.style.background=clicks%2?'rgb(255,128,0)':'rgb(0,200,255)';document.title=label+' click:'+clicks;status.textContent=document.title;if(observeState)publish();});
addEventListener('wheel',()=>{status.textContent=label+' wheel';});
editor.addEventListener('input',()=>{observeState=true;publish();});
addEventListener('keydown',(event)=>{
  if(event.key==='Tab'){event.preventDefault();observeState=true;editor.focus();publish();}
  else status.textContent=label+' key:'+event.key;
});
</script>`);
  return html;
}

export function createAppLauncher(root: string, name: string, commandLine: string): string {
  const target = path.join(root, name);
  writeFileSync(target, `#!/bin/sh\n${commandLine}\n`);
  chmodSync(target, 0o755);
  return target;
}

export function kernelAndGpu(): { kernel: string; gpu: string[] } {
  let gpu: string[] = [];
  try {
    const pci = Bun.spawnSync(["lspci", "-nn"], { stdout: "pipe", stderr: "pipe" });
    gpu = pci.stdout.toString().split("\n").filter((line) => /vga|3d|display/i.test(line));
  } catch {
    gpu = [];
  }
  return { kernel: `${os.type()} ${os.release()} ${os.arch()}`, gpu };
}

export function leftoverSurfaceProcesses(surfaceIds: readonly SurfaceId[]): string[] {
  const leftovers: string[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cmdline = readFileSync(`/proc/${entry}/cmdline`, "utf8");
      const environment = readFileSync(`/proc/${entry}/environ`, "utf8");
      for (const surfaceId of surfaceIds) {
        if (cmdline.includes(surfaceId) || environment.includes(surfaceId)) {
          leftovers.push(`${entry}:${path.basename(cmdline.split("\0")[0] ?? "unknown")}:${surfaceId}`);
        }
      }
    } catch {
      // Processes may exit while /proc is sampled.
    }
  }
  return leftovers;
}

export function renderConformanceMarkdown(report: Record<string, unknown>): string {
  const lines: string[] = [
    "# Sway two-Bot conformance and cost report",
    "",
    `Status: ${String(report.status)}`,
    `Cutover: ${String(report.cutover)}`,
    `Generated: ${String(report.generatedAt)}`,
    "",
    "This is ticket 09 evidence. Historical Cage, Sway, and Xvnc rows are **not** used for numeric comparison: workload and accounting are not matched to those artifacts.",
    "",
    "## Command",
    "",
    "```",
    String(report.command ?? ""),
    "```",
    "",
    "## Environment",
    "",
  ];
  const environment = (report.environment ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(environment)) {
    lines.push(`- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  lines.push("", "## Artifact versions", "");
  const artifacts = (report.artifacts ?? {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(artifacts)) {
    lines.push(`- ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  lines.push("", "## Host isolation", "");
  const isolation = (report.hostIsolation ?? {}) as Record<string, unknown>;
  lines.push(`- Unchanged: ${String(isolation.unchanged)}`);
  if (Array.isArray(isolation.deltas)) {
    for (const delta of isolation.deltas) lines.push(`- Delta: ${delta}`);
  }
  lines.push("", "## Correctness", "");
  const checks = Array.isArray(report.checks) ? report.checks as CheckResult[] : [];
  for (const check of checks) {
    lines.push(`- [${check.passed ? "x" : " "}] ${check.id}: ${check.evidence}`);
    if (check.leftover !== undefined) lines.push(`  - Leftover: ${check.leftover}`);
  }
  lines.push("", "## Resource scenarios", "");
  const scenarios = (report.resourceScenarios ?? {}) as Record<string, Record<string, unknown>>;
  for (const [name, scenario] of Object.entries(scenarios)) {
    lines.push(`### ${name}`, "");
    lines.push(`- Ran: ${String(scenario.ran)}`);
    if (scenario.latency !== undefined) lines.push(`- Latency: ${JSON.stringify(scenario.latency)}`);
    if (scenario.attribution !== undefined) {
      const attribution = scenario.attribution as SwayCostAttribution;
      lines.push(`- Sway infra PSS: ${attribution.swayInfrastructure.pssMiB} MiB / SwapPSS ${attribution.swayInfrastructure.swapPssMiB} MiB / CPU ${attribution.swayInfrastructure.cpuPercent}%`);
      lines.push(`- WayVNC/projection PSS: ${attribution.wayvncProjection.pssMiB} MiB / CPU ${attribution.wayvncProjection.cpuPercent}%`);
      lines.push(`- Apps+Agent PSS: ${attribution.applicationAgent.pssMiB} MiB / CPU ${attribution.applicationAgent.cpuPercent}%`);
      lines.push(`- Daemon+harness PSS: ${attribution.daemon.pssMiB} MiB / CPU ${attribution.daemon.cpuPercent}% (${attribution.harnessNote})`);
      lines.push(`- Whole-scenario PSS: ${attribution.wholeScenario.pssMiB} MiB / SwapPSS ${attribution.wholeScenario.swapPssMiB} MiB / CPU ${attribution.wholeScenario.cpuPercent}%`);
    }
    if (scenario.network !== undefined) lines.push(`- Host /proc/net/dev delta: ${JSON.stringify(scenario.network)}`);
    if (Array.isArray(scenario.notes)) {
      for (const note of scenario.notes) lines.push(`- ${note}`);
    }
    lines.push("");
  }
  lines.push("## Cited Fake / scripted proofs (not re-run here)", "");
  for (const cited of CITED_FAKE_PROOFS) {
    lines.push(`- ${cited.item}`);
    lines.push(`  - ${cited.files.join(", ")}`);
    lines.push(`  - ${cited.notes}`);
  }
  lines.push("", "## Limitations", "");
  const limitations = Array.isArray(report.limitations) ? report.limitations as string[] : [];
  if (limitations.length === 0) lines.push("- None recorded.");
  else for (const item of limitations) lines.push(`- ${item}`);
  lines.push("", "## Remaining human-only Host Session checks", "");
  for (const item of HUMAN_ONLY_HOST_CHECKS) lines.push(`- ${item}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function persistConformanceReport(
  jsonPath: string,
  markdownPath: string,
  report: Record<string, unknown>,
): void {
  mkdirSync(path.dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderConformanceMarkdown(report));
}

export function compositorSocketLeaks(owners: ScreenOwner[], runtimeRoot: string, hostWayland: string | null): string[] {
  const leaks: string[] = [];
  for (const owner of owners) {
    const surfaceDir = path.join(runtimeRoot, owner.surfaceId);
    if (!existsSync(surfaceDir)) continue;
    for (const generation of readdirSync(surfaceDir)) {
      const envFile = path.join(surfaceDir, generation, "sway-env");
      if (!existsSync(envFile)) continue;
      const text = readFileSync(envFile, "utf8");
      const runtimeDir = path.join(surfaceDir, generation);
      if (hostWayland !== null && text.includes(`${hostWayland}`) && !text.includes(runtimeDir)) {
        leaks.push(`${owner.surfaceId} env mentions host WAYLAND_DISPLAY`);
      }
    }
  }
  return leaks;
}
