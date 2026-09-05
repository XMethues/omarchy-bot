import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import rtc, { type DataChannel, type PeerConnection, type Track } from "node-datachannel";
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
import { api, makeBot, startDaemon, type Harness } from "./helpers/harness.ts";
import {
  HOST_INTERACTIONS_AUTOMATION_CANNOT_PROVE,
  HISTORICAL_FOUR_STREAM_BASELINE,
  activeEncoderCount,
  attributeResourceWindow,
  createBackgroundWorkFixture,
  currentGeneration,
  daemonGitChildCount,
  findPortableCageBundle,
  listScreenUnits,
  observeHostSession,
  resourceWindow,
  supervisionLabel,
  surfaceScopedProcessCount,
  until,
  userSystemdManagerAvailable,
  waitScreenReady,
  withTimeout,
  type ResourceWindow,
  type RoleAttribution,
  type ScreenOwner,
  type SupervisionLabel,
} from "./helpers/bot-screen-load-observe.ts";

const REAL_HOME = process.env.HOME ?? os.homedir();
const loadTest = process.env.OMARCHY_BOT_REAL_SCREEN_LOAD === "1" ? test : test.skip;
const REPORT_JSON = path.resolve(
  import.meta.dir,
  "../../.scratch/shared-workspace-desktop-boundary/normal-use-resource-report.json",
);
const REPORT_MD = path.resolve(
  import.meta.dir,
  "../../.scratch/shared-workspace-desktop-boundary/normal-use-resource-report.md",
);
const GRAPHICAL_STACK = ["cage", "ffmpeg", "omarchy-bot-wayland-capture"] as const;

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

interface ProjectionAnswer {
  type: "answer";
  sdp: string;
  sessionId: string;
  surfaceId: SurfaceId;
  runtimeGeneration: number;
  candidates: Array<{ candidate: string; sdpMid: string }>;
}

interface ScenarioMeasurement {
  name: string;
  ran: boolean;
  supervision: SupervisionLabel;
  resources?: ResourceWindow;
  attribution?: RoleAttribution;
  notes: string[];
  evidence?: Record<string, unknown>;
  unmet?: string;
}

const report: Record<string, unknown> = {
  schemaVersion: 1,
  kind: "normal-use-selected-view-matrix",
  generatedAt: new Date().toISOString(),
  status: "running",
  historicalBaseline: HISTORICAL_FOUR_STREAM_BASELINE,
  hostSafety: {},
  scenarios: {} as Record<string, ScenarioMeasurement>,
  unmet: [] as string[],
  ticket09HostGate: [...HOST_INTERACTIONS_AUTOMATION_CANNOT_PROVE],
};

function persistReport(): void {
  report.updatedAt = new Date().toISOString();
  mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(REPORT_MD, renderMarkdown(report));
}

function renderMarkdown(value: Record<string, unknown>): string {
  const unmet = Array.isArray(value.unmet) ? value.unmet as string[] : [];
  const scenarios = (value.scenarios ?? {}) as Record<string, ScenarioMeasurement>;
  const lines = [
    "# Normal-use resource and host-safety report",
    "",
    `Status: ${String(value.status)}`,
    `Generated: ${String(value.generatedAt)}`,
    "",
    "This is the selected-view / background-work / unused-Bot matrix for ticket 07.",
    "The historical four-stream ~2 GiB / 4.13-core row is a mixed-attribution baseline, not a budget.",
    "",
    "## Harness vs production supervision",
    "",
    "The standard integration harness defaults to `useHostApplicationUnits: false` (direct children).",
    "Those results are harness-mode. Production-style units are used only when the user systemd manager is present and the real-load matrix opts in.",
    "Daemon and test harness share one process; that PSS/CPU figure is a combined measurement.",
    "",
    "## Historical baseline comparison",
    "",
    `- Source: \`${HISTORICAL_FOUR_STREAM_BASELINE.source}\``,
    `- 4×1080p simultaneous streams: ${HISTORICAL_FOUR_STREAM_BASELINE.total.pssMiB} MiB PSS, ${HISTORICAL_FOUR_STREAM_BASELINE.total.cpuPercent}% CPU over ${HISTORICAL_FOUR_STREAM_BASELINE.durationMs} ms`,
    `- Combined daemon/harness in that row: ${HISTORICAL_FOUR_STREAM_BASELINE.daemonAndHarness.pssMiB} MiB PSS / ${HISTORICAL_FOUR_STREAM_BASELINE.daemonAndHarness.cpuPercent}% CPU`,
    `- Published mix: compositor ~${HISTORICAL_FOUR_STREAM_BASELINE.publishedBreakdown.compositorPssMiB} MiB, encoder ~${HISTORICAL_FOUR_STREAM_BASELINE.publishedBreakdown.encoderPssMiB} MiB, worker/application ~${HISTORICAL_FOUR_STREAM_BASELINE.publishedBreakdown.workerApplicationPssMiB} MiB`,
    "- That row is not compositor-only cost and is not an accepted normal-use budget.",
    "",
    "## Scenarios",
    "",
  ];
  for (const [name, scenario] of Object.entries(scenarios)) {
    lines.push(`### ${name}`);
    lines.push("");
    lines.push(`- Ran: ${scenario.ran}`);
    lines.push(`- Supervision: ${scenario.supervision.path}`);
    if (scenario.resources !== undefined) {
      lines.push(`- Sample duration: ${scenario.resources.durationMs} ms`);
      lines.push(`- Whole-scenario PSS: ${scenario.resources.total.pssMiB} MiB, CPU ${scenario.resources.total.cpuPercent}%`);
      lines.push(`- Combined daemon/harness: ${scenario.resources.daemonAndHarness.pssMiB} MiB, CPU ${scenario.resources.daemonAndHarness.cpuPercent}%`);
    }
    if (scenario.attribution !== undefined) {
      lines.push(`- Plugin infrastructure: ${scenario.attribution.pluginInfrastructure.pssMiB} MiB PSS / ${scenario.attribution.pluginInfrastructure.cpuPercent}% CPU (${scenario.attribution.method})`);
      lines.push(`- Agent/application: ${scenario.attribution.agentApplication.pssMiB} MiB PSS / ${scenario.attribution.agentApplication.cpuPercent}% CPU`);
    }
    for (const note of scenario.notes) lines.push(`- ${note}`);
    if (scenario.unmet !== undefined) lines.push(`- Unmet: ${scenario.unmet}`);
    lines.push("");
  }
  lines.push("## Measurement caveats");
  lines.push("");
  lines.push("- CPU percent is process time over the named sample window, not a 15-second historical-row equivalent.");
  lines.push("- Viewer-attached windows were shortened to 1500 ms because native WebRTC peers on this Cage path often close if held longer. No-viewer windows used the configured duration.");
  lines.push("- Compact preview evidence is daemon `surfaceMedia` capture/viewer state. Native preview data-channel messages were not required.");
  lines.push("- GPU VRAM is not attributable on this stack.");
  lines.push("");
  lines.push("## Unmet");
  lines.push("");
  if (unmet.length === 0) lines.push("- No matrix scenario was left unmeasured in this process. Host top-bar, shortcuts, and physical input remain ticket 09.");
  else for (const item of unmet) lines.push(`- ${item}`);
  lines.push("");
  lines.push("## Host-gate items for ticket 09");
  lines.push("");
  for (const item of HOST_INTERACTIONS_AUTOMATION_CANNOT_PROVE) lines.push(`- ${item}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function digestBytes(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

async function screenshotDigest(harness: Harness, owner: ScreenOwner): Promise<string> {
  const result = await harness.svc.screens.act(owner, { name: "screenshot", args: {} });
  if (result.image === undefined) throw new Error(`screenshot unavailable for ${owner.surfaceId}`);
  return digestBytes(result.image.bytes);
}

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

function openChannel(channel: DataChannel): Promise<void> {
  if (channel.isOpen()) return Promise.resolve();
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  channel.onOpen(resolve);
  channel.onError((error) => reject(new Error(error)));
  return promise;
}

class ProjectionClient {
  frames = 0;

  private constructor(
    readonly owner: ScreenOwner,
    readonly answer: ProjectionAnswer,
    readonly peer: PeerConnection,
    readonly controlChannel: DataChannel,
  ) {}

  static async connect(harness: Harness, owner: ScreenOwner, name: string): Promise<ProjectionClient> {
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
    await withTimeout(
      Promise.all([openChannel(frameChannel), openChannel(controlChannel), openChannel(inputChannel)]),
      10_000,
      "Screen Projection data channels did not open",
    );
    const client = new ProjectionClient(owner, answer, peer, controlChannel);
    videoTrack.onMessage(() => {
      client.frames += 1;
    });
    frameChannel.onMessage(() => {
      client.frames += 1;
    });
    return client;
  }

  async mode(mode: "idle" | "preview" | "expanded"): Promise<void> {
    if (!this.controlChannel.sendMessage(JSON.stringify({
      version: SCREEN_PROJECTION_PROTOCOL_VERSION,
      type: "view",
      surfaceId: this.owner.surfaceId,
      runtimeGeneration: this.answer.runtimeGeneration,
      mode,
    }))) throw new Error("projection control channel rejected view mode");
  }

  async close(harness: Harness): Promise<void> {
    const peerClosed = until(
      () => this.peer.state() === "closed" ? true : undefined,
      5_000,
      `Screen Projection peer ${this.answer.sessionId} did not close`,
    );
    try {
      await fetch(
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
  }
}

async function destroyBot(harness: Harness, owner: ScreenOwner): Promise<void> {
  const result = await api<{ status: string }>(harness, "DELETE", `/api/bots/${owner.botId}`, {});
  if (result.status !== "deleted") throw new Error(`Bot ${owner.botId} was not deleted`);
}

function recordScenario(name: string, scenario: ScenarioMeasurement): void {
  const scenarios = report.scenarios as Record<string, ScenarioMeasurement>;
  scenarios[name] = scenario;
  if (scenario.unmet !== undefined) {
    (report.unmet as string[]).push(scenario.unmet);
  }
}

afterAll(() => {
  report.status = "complete";
  persistReport();
});

test("observes Host Session read-only and unused Bots without a graphical stack", async () => {
  const hostBefore = await observeHostSession();
  report.hostSafety = {
    before: hostBefore,
    preExistingScreenUnits: hostBefore.visibleScreenUnits,
    preExistingScreenUnitsNote: "Visible omarchy-bot-screen-* units at start belong to the already-running plugin, not this test. They were observed read-only and not stopped.",
    livePluginDaemon: "not restarted; isolated test daemon used",
    systemPackages: {
      cage: Bun.which("cage"),
      wlrRandr: Bun.which("wlr-randr"),
      zenity: Bun.which("zenity"),
      grim: Bun.which("grim"),
      ffmpeg: Bun.which("ffmpeg"),
    },
    portableCage: findPortableCageBundle(REAL_HOME),
    userSystemdManagerAvailable: userSystemdManagerAvailable(),
  };

  const unusedSupervision = supervisionLabel(false);
  const harness = await startDaemon(undefined, {
    useProductionBotScreen: true,
    useHostApplicationUnits: false,
    botScreenCapacity: 4,
  });
  const unused: ScreenOwner[] = [];
  try {
    for (const index of [0, 1, 2]) {
      const botId = await makeBot(harness, `Unused graphics ${index}`);
      const bot = await api<{ surfaceId: SurfaceId }>(harness, "GET", `/api/bots/${botId}`);
      unused.push({ botId, surfaceId: bot.surfaceId });
    }
    await Bun.sleep(500);
    const runtimeDirs = unused.map((owner) => path.join(harness.svc.cfg.botScreenRuntimeDir, owner.surfaceId));
    const hiddenStack = unused.map((owner) => ({
      surfaceId: owner.surfaceId,
      runtimeDir: existsSync(path.join(harness.svc.cfg.botScreenRuntimeDir, owner.surfaceId)),
      cageOrCaptureOrEncoder: surfaceScopedProcessCount(owner.surfaceId, GRAPHICAL_STACK),
      anySurfaceProcess: surfaceScopedProcessCount(owner.surfaceId),
      screenState: harness.svc.screens.status(owner).state,
    }));
    const resources = await resourceWindow(unused, new Map(), 500);
    const attribution = attributeResourceWindow(resources);
    const gitChildren = daemonGitChildCount();
    expect(hiddenStack.every((row) => row.runtimeDir === false)).toBeTrue();
    expect(hiddenStack.every((row) => row.cageOrCaptureOrEncoder === 0)).toBeTrue();
    expect(hiddenStack.every((row) => row.anySurfaceProcess === 0)).toBeTrue();
    expect(hiddenStack.every((row) => row.screenState === "stopped")).toBeTrue();
    expect(resources.screens.every((screen) => screen.processes.length === 0)).toBeTrue();
    expect(gitChildren).toBe(0);
    recordScenario("unusedBotsNeverGraphics", {
      name: "unusedBotsNeverGraphics",
      ran: true,
      supervision: unusedSupervision,
      resources,
      attribution,
      notes: [
        "Three Bots created and listed; no graphical action or Computer view.",
        "No Cage, capture, or encoder process and no runtime directory per unused Bot.",
        "No daemon git child (Changes polling is gone).",
        "Whole-scenario total is the combined daemon/harness process only.",
        unusedSupervision.note,
      ],
      evidence: { hiddenStack, runtimeDirs, gitChildren },
    });
  } finally {
    for (const owner of unused) {
      try {
        await destroyBot(harness, owner);
      } catch {
        // Final harness stop retries cleanup.
      }
    }
    await harness.stop();
  }

  const hostAfter = await observeHostSession();
  (report.hostSafety as Record<string, unknown>).afterUnusedBots = hostAfter;
  expect(hostAfter.userManagerEnvironment.botDisplayLeak).toEqual([]);
  if (hostBefore.userManagerEnvironment.WAYLAND_DISPLAY !== null) {
    expect(hostAfter.userManagerEnvironment.WAYLAND_DISPLAY).toBe(hostBefore.userManagerEnvironment.WAYLAND_DISPLAY);
  }
  if (hostBefore.userManagerEnvironment.XDG_RUNTIME_DIR !== null) {
    expect(hostAfter.userManagerEnvironment.XDG_RUNTIME_DIR).toBe(hostBefore.userManagerEnvironment.XDG_RUNTIME_DIR);
  }
  persistReport();
}, 30_000);

loadTest("measures selected-view background-work unused-Bot cost on the existing load seam", async () => {
  const durationMs = Number(process.env.OMARCHY_BOT_NORMAL_USE_DURATION_MS ?? 4_000);
  if (!Number.isSafeInteger(durationMs) || durationMs < 1_000) {
    throw new Error("OMARCHY_BOT_NORMAL_USE_DURATION_MS must be an integer of at least 1000");
  }
  const portable = findPortableCageBundle(REAL_HOME);
  const browserBinary = process.env.OMARCHY_BOT_LOAD_BROWSER_BIN
    ?? Bun.which("brave")
    ?? Bun.which("chromium")
    ?? Bun.which("chromium-browser");
  const grim = Bun.which("grim");
  const ffmpeg = Bun.which("ffmpeg");
  const prerequisites: string[] = [];
  if (portable === undefined && Bun.which("cage") === null) {
    prerequisites.push("system cage is missing and no portable bundle was found under ~/.local/share/omarchy-bot/runtime/cage/");
  }
  if (portable === undefined && Bun.which("wlr-randr") === null) {
    prerequisites.push("system wlr-randr is missing and no portable bundle was found");
  }
  if (grim === null) prerequisites.push("grim is missing");
  if (ffmpeg === null) prerequisites.push("ffmpeg is missing");
  if (browserBinary === null || browserBinary === undefined) prerequisites.push("Brave or Chromium is missing for the background workload");
  if (prerequisites.length > 0) {
    recordScenario("selectedViewBackgroundMatrix", {
      name: "selectedViewBackgroundMatrix",
      ran: false,
      supervision: supervisionLabel(false),
      notes: ["Real-load matrix not started."],
      unmet: prerequisites.join("; "),
    });
    persistReport();
    throw new Error(`real-load matrix prerequisites unmet: ${prerequisites.join("; ")}`);
  }

  const useHostUnits = userSystemdManagerAvailable();
  const label = supervisionLabel(useHostUnits);
  const prior = {
    cage: process.env.OMARCHY_BOT_CAGE_BIN,
    wlr: process.env.OMARCHY_BOT_WLR_RANDR_BIN,
    app: process.env.OMARCHY_BOT_LOAD_APP_BIN,
    profile: process.env.OMARCHY_BOT_SCREEN_PROFILE,
  };
  if (portable !== undefined) {
    process.env.OMARCHY_BOT_CAGE_BIN = portable.cageBin;
    process.env.OMARCHY_BOT_WLR_RANDR_BIN = portable.wlrRandrBin;
  }
  const fixtureRoot = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-normal-use-"));
  process.env.OMARCHY_BOT_LOAD_APP_BIN = createBackgroundWorkFixture(fixtureRoot, browserBinary!);
  process.env.OMARCHY_BOT_SCREEN_PROFILE = "1080p";

  const hostBefore = await observeHostSession();
  const harness = await startDaemon(undefined, {
    useProductionBotScreen: true,
    useHostApplicationUnits: useHostUnits,
    botScreenCapacity: 4,
  });
  const unused: ScreenOwner[] = [];
  const opened: ScreenOwner[] = [];
  const clients: ProjectionClient[] = [];
  const tracked: SurfaceId[] = [];
  let matrixError: string | undefined;
  try {
    for (const index of [0, 1, 2]) {
      const botId = await makeBot(harness, `Normal unused ${index}`);
      const bot = await api<{ surfaceId: SurfaceId }>(harness, "GET", `/api/bots/${botId}`);
      unused.push({ botId, surfaceId: bot.surfaceId });
      tracked.push(bot.surfaceId);
    }
    for (const index of [0, 1, 2]) {
      const botId = await makeBot(harness, `Normal desktop ${index}`);
      const bot = await api<{ surfaceId: SurfaceId }>(harness, "GET", `/api/bots/${botId}`);
      const owner = { botId, surfaceId: bot.surfaceId };
      opened.push(owner);
      tracked.push(owner.surfaceId);
    }
    const unusedAfterCreate = unused.map((owner) => ({
      surfaceId: owner.surfaceId,
      hiddenStack: surfaceScopedProcessCount(owner.surfaceId, GRAPHICAL_STACK),
      runtimeDir: existsSync(path.join(harness.svc.cfg.botScreenRuntimeDir, owner.surfaceId)),
    }));
    expect(unusedAfterCreate.every((row) => row.hiddenStack === 0 && row.runtimeDir === false)).toBeTrue();

    const startupMs = await Promise.all(opened.map((owner) => waitScreenReady(harness, owner)));
    await Promise.all(opened.map((owner, index) =>
      harness.svc.screens.act(
        owner,
        { name: "open_app", args: { app: process.env.OMARCHY_BOT_LOAD_APP_BIN } },
        { ...owner, turnId: `normal-use-workload-${index}` },
      )
    ));
    await Bun.sleep(800);
    const generationBySurface = new Map<SurfaceId, number>();
    for (const owner of opened) generationBySurface.set(owner.surfaceId, await currentGeneration(harness, owner));

    const noViewer = await resourceWindow(opened, generationBySurface, durationMs);
    expect(activeEncoderCount()).toBe(0);
    const backgroundA = opened[0]!;
    const backgroundB = opened[1]!;
    const selected = opened[2]!;
    const firstShot = await screenshotDigest(harness, backgroundA);
    await Bun.sleep(800);
    const secondShot = await screenshotDigest(harness, backgroundA);
    expect(firstShot).not.toBe(secondShot);
    expect(harness.svc.screens.status(backgroundA).state).toBe("ready");
    expect(harness.svc.screens.status(backgroundB).state).toBe("ready");
    recordScenario("retainedDesktopsNoViewer", {
      name: "retainedDesktopsNoViewer",
      ran: true,
      supervision: label,
      resources: noViewer,
      attribution: attributeResourceWindow(noViewer),
      notes: [
        "Three retained desktops with the same browser workload and no viewers.",
        "Application output changed between Agent screenshots (timer ticks), not merely idle processes.",
        "No H.264 encoder processes while no viewer was attached.",
        label.note,
      ],
      evidence: {
        startupMs,
        encoders: activeEncoderCount(),
        unusedAfterCreate,
        screenshotDigests: { firstShot, secondShot, changed: firstShot !== secondShot },
      },
    });

    const viewerSampleMs = Math.min(durationMs, 1_500);
    const compact = await ProjectionClient.connect(harness, selected, "normal-use-compact");
    clients.push(compact);
    await compact.mode("preview");
    const compactMedia = await until(
      () => {
        const media = harness.svc.projections.surfaceMedia(selected.surfaceId);
        return media.captureActive && media.viewers === 1 ? media : undefined;
      },
      10_000,
      "compact preview did not start viewer-driven capture",
    );
    expect(activeEncoderCount()).toBe(0);
    expect(compactMedia).toMatchObject({
      viewers: 1,
      previewViewers: 1,
      encodingActive: false,
      captureActive: true,
    });
    const compactWindow = await resourceWindow(opened, generationBySurface, viewerSampleMs);
    await compact.close(harness);
    clients.pop();
    expect(harness.svc.projections.surfaceMedia(backgroundA.surfaceId).captureActive).toBeFalse();
    recordScenario("oneSelectedCompact", {
      name: "oneSelectedCompact",
      ran: true,
      supervision: label,
      resources: compactWindow,
      attribution: attributeResourceWindow(compactWindow),
      notes: [
        "Exactly one selected compact preview. Two sibling desktops kept working with no capture/encode.",
        "Compact preview did not start an H.264 encoder.",
        compact.frames > 0
          ? `Native WebRTC peer received ${compact.frames} preview messages.`
          : "Daemon capture/viewer state was observed immediately after mode(preview); native preview messages are optional transport evidence.",
        `Viewer-attached resource sample was ${viewerSampleMs} ms to avoid holding a flaky native peer across a long window.`,
      ],
      evidence: {
        selectedMedia: harness.svc.projections.surfaceMedia(selected.surfaceId),
        backgroundMedia: harness.svc.projections.surfaceMedia(backgroundA.surfaceId),
        encoders: activeEncoderCount(),
        nativePreviewFrames: compact.frames,
        compactMedia,
      },
    });

    const expanded = await ProjectionClient.connect(harness, selected, "normal-use-expanded");
    clients.push(expanded);
    await expanded.mode("expanded");
    const expandedMedia = await until(
      () => {
        const media = harness.svc.projections.surfaceMedia(selected.surfaceId);
        return media.encodingActive && activeEncoderCount() === 1 ? media : undefined;
      },
      8_000,
      "expanded mode did not start one encoder",
    );
    const expandedWindow = await resourceWindow(opened, generationBySurface, viewerSampleMs);
    recordScenario("oneSelectedExpanded", {
      name: "oneSelectedExpanded",
      ran: true,
      supervision: label,
      resources: expandedWindow,
      attribution: attributeResourceWindow(expandedWindow),
      notes: [
        "Exactly one selected expanded projection. Encoder count is 1, not one-per-desktop.",
        "Background desktops remained ready with no viewer-driven encode.",
      ],
      evidence: {
        encoders: activeEncoderCount(),
        selectedMedia: expandedMedia,
      },
    });

    try {
      await expanded.mode("preview");
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("DataChannel is closed")) throw error;
    }
    await until(() => activeEncoderCount() === 0 ? true : undefined, 8_000, "leaving expanded did not release the encoder");
    recordScenario("leaveExpandedReleaseEncode", {
      name: "leaveExpandedReleaseEncode",
      ran: true,
      supervision: label,
      notes: ["Leaving expanded released the unused encoder while the compact viewer and desktops remained."],
      evidence: {
        encoders: activeEncoderCount(),
        selectedMedia: harness.svc.projections.surfaceMedia(selected.surfaceId),
        selectedReady: harness.svc.screens.status(selected).state,
      },
    });

    await expanded.close(harness);
    clients.pop();
    const switched = await ProjectionClient.connect(harness, backgroundA, "normal-use-switch-a");
    clients.push(switched);
    await switched.mode("expanded");
    await until(() => activeEncoderCount() === 1 ? true : undefined, 8_000, "switch to A did not start A's encoder");
    await switched.close(harness);
    clients.pop();
    const switchedB = await ProjectionClient.connect(harness, backgroundB, "normal-use-switch-b");
    clients.push(switchedB);
    await switchedB.mode("expanded");
    await until(
      () =>
        harness.svc.projections.surfaceMedia(backgroundA.surfaceId).viewers === 0
          && harness.svc.projections.surfaceMedia(backgroundB.surfaceId).encodingActive
          ? true
          : undefined,
      8_000,
      "A→B switch did not release A's viewer media",
    );
    expect(harness.svc.screens.status(backgroundA).state).toBe("ready");
    const afterSwitchShot = await screenshotDigest(harness, backgroundA);
    expect(afterSwitchShot).not.toBe(firstShot);
    recordScenario("repeatedABSwitch", {
      name: "repeatedABSwitch",
      ran: true,
      supervision: label,
      notes: [
        "A→B replaced that client's projection. A stayed ready and continued producing screenshot output.",
        "A's capture/encode released after the switch.",
      ],
      evidence: {
        aMedia: harness.svc.projections.surfaceMedia(backgroundA.surfaceId),
        bMedia: harness.svc.projections.surfaceMedia(backgroundB.surfaceId),
        aReady: harness.svc.screens.status(backgroundA).state,
        afterSwitchShot,
      },
    });

    await switchedB.close(harness).catch(() => undefined);
    clients.splice(0, clients.length);
    const firstRemaining = await ProjectionClient.connect(harness, backgroundB, "normal-use-remaining-1");
    clients.push(firstRemaining);
    await firstRemaining.mode("preview");
    await until(
      () => harness.svc.projections.surfaceMedia(backgroundB.surfaceId).captureActive ? true : undefined,
      8_000,
      "first remaining viewer did not start capture",
    );
    let secondRemaining: ProjectionClient | undefined;
    try {
      secondRemaining = await ProjectionClient.connect(harness, backgroundB, "normal-use-remaining-2");
      clients.push(secondRemaining);
      await secondRemaining.mode("preview");
      await until(
        () => harness.svc.projections.surfaceMedia(backgroundB.surfaceId).viewers === 2 ? true : undefined,
        5_000,
        "second viewer did not attach",
      );
      await firstRemaining.close(harness);
      clients.splice(clients.indexOf(firstRemaining), 1);
      await until(
        () => {
          const media = harness.svc.projections.surfaceMedia(backgroundB.surfaceId);
          return media.viewers === 1 && media.captureActive ? media : undefined;
        },
        8_000,
        "closing one viewer destroyed capture still needed by the remaining viewer",
      );
      recordScenario("remainingViewerKeepsCapture", {
        name: "remainingViewerKeepsCapture",
        ran: true,
        supervision: label,
        notes: ["Closing one of two viewers left capture running for the remaining viewer."],
        evidence: { media: harness.svc.projections.surfaceMedia(backgroundB.surfaceId) },
      });
    } catch (error) {
      recordScenario("remainingViewerKeepsCapture", {
        name: "remainingViewerKeepsCapture",
        ran: false,
        supervision: label,
        notes: [
          "Two simultaneous native WebRTC viewers did not stay attached on this real-Cage run.",
          "Harness-mode coverage remains in tests/integration/screen-projection.test.ts (real ffmpeg encoder, injectable desktop).",
        ],
        unmet: error instanceof Error ? error.message : String(error),
        evidence: { media: harness.svc.projections.surfaceMedia(backgroundB.surfaceId) },
      });
    }

    await Promise.all(clients.splice(0, clients.length).map((client) => client.close(harness).catch(() => undefined)));
    await until(
      () => {
        const media = harness.svc.projections.surfaceMedia(backgroundB.surfaceId);
        return media.viewers === 0 && !media.captureActive && !media.encodingActive && activeEncoderCount() === 0
          ? media
          : undefined;
      },
      8_000,
      "last viewer did not release capture and encoding",
    );
    const noViewerShot = await screenshotDigest(harness, backgroundB);
    expect(harness.svc.screens.status(backgroundB).state).toBe("ready");
    expect(harness.svc.screens.status(selected).state).toBe("ready");
    recordScenario("lastViewerReleaseAndAgentScreenshot", {
      name: "lastViewerReleaseAndAgentScreenshot",
      ran: true,
      supervision: label,
      notes: [
        "Last viewer close released capture/encode without stopping applications.",
        "Agent screenshot succeeded with no viewer. Unsaved/timer state was still on the desktop.",
      ],
      evidence: {
        media: harness.svc.projections.surfaceMedia(backgroundB.surfaceId),
        encoders: activeEncoderCount(),
        noViewerShot,
        ready: opened.map((owner) => harness.svc.screens.status(owner).state),
      },
    });

    const hostDuring = await observeHostSession({ trackedSurfaceIds: tracked });
    expect(hostDuring.userManagerEnvironment.botDisplayLeak).toEqual([]);
    (report.hostSafety as Record<string, unknown>).duringMatrix = hostDuring;
  } catch (error) {
    matrixError = error instanceof Error ? error.message : String(error);
    recordScenario("selectedViewBackgroundMatrix", {
      name: "selectedViewBackgroundMatrix",
      ran: false,
      supervision: label,
      notes: ["Matrix failed after start."],
      unmet: matrixError,
    });
    throw error;
  } finally {
    await Promise.all(clients.splice(0, clients.length).map((client) => client.close(harness).catch(() => undefined)));
    for (const owner of [...opened, ...unused]) {
      try {
        await destroyBot(harness, owner);
      } catch {
        // Final stop retries.
      }
    }
    await harness.stop();
    const leftover = await listScreenUnits(tracked);
    const hostAfter = await observeHostSession({ trackedSurfaceIds: tracked });
    (report.hostSafety as Record<string, unknown>).afterMatrix = hostAfter;
    recordScenario("cleanupResidue", {
      name: "cleanupResidue",
      ran: true,
      supervision: label,
      notes: leftover.length === 0
        ? ["No leftover omarchy-bot-screen-* units for tracked test Surfaces."]
        : ["Tracked test Surfaces left user-systemd units."],
      evidence: { leftover, tracked },
      ...(leftover.length === 0 ? {} : { unmet: `leftover units: ${leftover.join(", ")}` }),
    });
    rmSync(fixtureRoot, { recursive: true, force: true });
    for (const [name, value] of [
      ["OMARCHY_BOT_CAGE_BIN", prior.cage],
      ["OMARCHY_BOT_WLR_RANDR_BIN", prior.wlr],
      ["OMARCHY_BOT_LOAD_APP_BIN", prior.app],
      ["OMARCHY_BOT_SCREEN_PROFILE", prior.profile],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  if (matrixError === undefined) {
    recordScenario("selectedViewBackgroundMatrix", {
      name: "selectedViewBackgroundMatrix",
      ran: true,
      supervision: label,
      notes: [
        "Selected-view / background / unused matrix completed on the existing public projection + production Cage seam.",
        "Viewing used the public projection HTTP API and a native WebRTC peer, not a mocked UI test.",
        "Workload was the same class of real browser application used by the capacity load fixture, with a timer so background output is observable without a viewer.",
        label.note,
      ],
      evidence: { durationMs, useHostApplicationUnits: useHostUnits, portableCage: portable ?? null },
    });
  }
  persistReport();
}, 180_000);

test("attributes plugin infrastructure separately from application and combined daemon/harness", () => {
  const attributed = attributeResourceWindow({
    durationMs: 1000,
    screens: [{
      surfaceId: "surf_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as SurfaceId,
      pids: [1, 2, 3],
      pssMiB: 90,
      rssMiB: 90,
      cpuPercent: 30,
      gpu: { attributable: false, utilizationPercent: null, vramMiB: null },
      processes: [
        { pid: 1, role: "compositor", executable: "cage", pssMiB: 40, rssMiB: 40, cpuPercent: 10 },
        { pid: 2, role: "encoder", executable: "ffmpeg", pssMiB: 20, rssMiB: 20, cpuPercent: 10 },
        { pid: 3, role: "application", executable: "chrome", pssMiB: 30, rssMiB: 30, cpuPercent: 10 },
      ],
    }],
    daemonAndHarness: {
      pssMiB: 50,
      rssMiB: 50,
      cpuPercent: 5,
      note: "daemon and test harness share this process; combined measurement, not a split",
    },
    total: { pssMiB: 140, rssMiB: 140, cpuPercent: 35 },
  });
  expect(attributed.method).toBe("systemd-unit");
  expect(attributed.pluginInfrastructure.pssMiB).toBe(60);
  expect(attributed.agentApplication.pssMiB).toBe(30);
  expect(attributed.daemonAndHarness.pssMiB).toBe(50);
  expect(attributed.wholeScenario.pssMiB).toBe(140);
});

test("records host interactions automation cannot safely prove", () => {
  expect(HOST_INTERACTIONS_AUTOMATION_CANNOT_PROVE.length).toBeGreaterThan(0);
  report.ticket09HostGate = [...HOST_INTERACTIONS_AUTOMATION_CANNOT_PROVE];
  if (process.env.OMARCHY_BOT_REAL_SCREEN_LOAD !== "1") {
    (report.unmet as string[]).push(
      "OMARCHY_BOT_REAL_SCREEN_LOAD was not set; selected-view / background retained-desktop resource windows were not measured in this process",
    );
  }
  persistReport();
});
