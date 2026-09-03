import type { BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL } from "../../../apps/daemon/src/bootstrap/config.ts";

type CapacityApproval = typeof BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL;

export interface BrowserFrameMetric {
  surfaceId: string;
  lanEndpoint: string;
  finalWebClient: true;
  durationMs: number;
  sequences: number[];
  transportSequenceGaps: number;
  receivedFrames: number;
  decodedFrames: number;
  displayedFrames: number;
  decodeDrops: number;
  paintDrops: number;
  receivedFps: number;
  decodedFps: number;
  displayedFps: number;
  sourceFrames?: number;
  encodedFrames?: number;
  sentFrames?: number;
  sourceFps?: number;
  encodedFps?: number;
  sentFps?: number;
  preCaptureBackpressureSkips?: number;
  encodedBackpressureDrops?: number;
  transportUnavailableSkips?: number;
  invalidFrameDrops?: number;
  sendFailures?: number;
  unexplainedDrops?: number;
  targetFrameShortfall?: {
    source: number;
    encoded: number;
    sent: number;
    received: number;
    decoded: number;
    displayed: number;
  };
}

export interface BrowserLatencyMetric {
  source: "browser-paint";
  samples: number[];
  p50: number | null;
  p95: number | null;
}

export interface CapacityRowForGate {
  profile?: unknown;
  screens?: unknown;
  resolution?: unknown;
  targetFps?: unknown;
  performancePassed?: unknown;
  frames?: unknown;
  inputToVisibleMs?: unknown;
  captureToBrowserMs?: unknown;
  repeatedProvisionDestroy?: unknown;
  operationalPassed?: unknown;
  error?: unknown;
  staticPreview?: unknown;
  simultaneousAgentAndWebInputCompleted?: unknown;
  takeoverCompleted?: unknown;
  reconnects?: unknown;
  crashes?: unknown;
  cleanup?: unknown;
}

export function isNonLoopbackLanEndpoint(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return url.protocol === "https:"
      && hostname !== "localhost"
      && hostname !== "0.0.0.0"
      && hostname !== "::"
      && hostname !== "::1"
      && !hostname.startsWith("127.");
  } catch {
    return false;
  }
}

function validBrowserFrames(value: unknown, expectedCount: number, targetFps: number): value is BrowserFrameMetric[] {
  if (!Array.isArray(value) || value.length !== expectedCount) return false;
  return value.every((entry: unknown) => {
    if (entry === null || typeof entry !== "object") return false;
    const metric = entry as Partial<BrowserFrameMetric>;
    const wholeNumbers = [
      metric.transportSequenceGaps,
      metric.receivedFrames,
      metric.decodedFrames,
      metric.displayedFrames,
      metric.decodeDrops,
      metric.paintDrops,
      metric.sourceFrames,
      metric.encodedFrames,
      metric.sentFrames,
      metric.preCaptureBackpressureSkips,
      metric.encodedBackpressureDrops,
      metric.transportUnavailableSkips,
      metric.invalidFrameDrops,
      metric.sendFailures,
      metric.unexplainedDrops,
    ];
    const shortfall = metric.targetFrameShortfall;
    const targetFrames = typeof metric.durationMs === "number"
      ? Math.floor(targetFps * metric.durationMs / 1_000)
      : Number.NaN;
    const calculatedUnexplainedDrops = Math.max(
      0,
      metric.encodedFrames! - metric.sentFrames! - metric.encodedBackpressureDrops! - metric.sendFailures!,
    ) + Math.max(0, metric.sentFrames! - metric.receivedFrames!);
    return typeof metric.surfaceId === "string"
      && metric.finalWebClient === true
      && isNonLoopbackLanEndpoint(metric.lanEndpoint)
      && typeof metric.durationMs === "number"
      && Number.isFinite(metric.durationMs)
      && metric.durationMs > 0
      && Array.isArray(metric.sequences)
      && metric.sequences.length === metric.receivedFrames
      && metric.sequences.every((sequence, index) =>
        Number.isSafeInteger(sequence) && sequence > 0 && (index === 0 || sequence > metric.sequences![index - 1]!)
      )
      && metric.transportSequenceGaps! >= metric.sequences.slice(1).reduce((gaps, sequence, index) =>
        gaps + Math.max(0, sequence - metric.sequences![index]! - 1), 0)
      && wholeNumbers.every((number) => Number.isSafeInteger(number) && number! >= 0)
      && metric.sourceFrames! >= metric.encodedFrames!
      && metric.encodedFrames! >= metric.sentFrames!
      && metric.sentFrames! >= metric.receivedFrames!
      && metric.receivedFrames! >= metric.decodedFrames!
      && metric.decodedFrames! >= metric.displayedFrames!
      && metric.decodeDrops === metric.receivedFrames! - metric.decodedFrames!
      && metric.paintDrops === metric.decodedFrames! - metric.displayedFrames!
      && typeof metric.sourceFps === "number"
      && Number.isFinite(metric.sourceFps)
      && typeof metric.encodedFps === "number"
      && metric.encodedFps >= targetFps
      && typeof metric.sentFps === "number"
      && Number.isFinite(metric.sentFps)
      && typeof metric.receivedFps === "number"
      && Number.isFinite(metric.receivedFps)
      && typeof metric.decodedFps === "number"
      && Number.isFinite(metric.decodedFps)
      && typeof metric.displayedFps === "number"
      && metric.displayedFps >= targetFps
      && metric.unexplainedDrops === calculatedUnexplainedDrops
      && metric.unexplainedDrops === 0
      && shortfall !== undefined
      && Object.values(shortfall).every((number) => Number.isSafeInteger(number) && number >= 0)
      && shortfall.source === Math.max(0, targetFrames - metric.sourceFrames!)
      && shortfall.encoded === Math.max(0, targetFrames - metric.encodedFrames!)
      && shortfall.sent === Math.max(0, targetFrames - metric.sentFrames!)
      && shortfall.received === Math.max(0, targetFrames - metric.receivedFrames!)
      && shortfall.decoded === Math.max(0, targetFrames - metric.decodedFrames!)
      && shortfall.displayed === Math.max(0, targetFrames - metric.displayedFrames!)
      && shortfall.encoded === 0
      && shortfall.displayed === 0;
  });
}

function validPaintLatency(value: unknown, limitMs: number): value is BrowserLatencyMetric {
  if (
    value === null
    || typeof value !== "object"
    || !("source" in value)
    || !("samples" in value)
    || !("p50" in value)
    || !("p95" in value)
  ) return false;
  return value.source === "browser-paint"
    && Array.isArray(value.samples)
    && value.samples.length > 0
    && value.samples.every((sample: unknown) => typeof sample === "number" && Number.isFinite(sample) && sample >= 0)
    && typeof value.p50 === "number"
    && Number.isFinite(value.p50)
    && value.p50 <= limitMs
    && typeof value.p95 === "number"
    && Number.isFinite(value.p95);
}

function validProvisionDestroy(value: unknown, minimumCycles: number): boolean {
  if (!Array.isArray(value) || value.length < minimumCycles) return false;
  const destroyed = new Set<string>();
  const provisioned = new Set<string>();
  return value.every((cycle: unknown, index) => {
    if (cycle === null || typeof cycle !== "object") return false;
    const record = cycle as Record<string, unknown>;
    if (
      record.cycle !== index
      || typeof record.destroyedSurfaceId !== "string"
      || typeof record.provisionedSurfaceId !== "string"
      || record.destroyedSurfaceId === record.provisionedSurfaceId
      || destroyed.has(record.destroyedSurfaceId)
      || provisioned.has(record.provisionedSurfaceId)
      || typeof record.teardownMs !== "number"
      || !Number.isFinite(record.teardownMs)
      || record.teardownMs < 0
      || typeof record.startupMs !== "number"
      || !Number.isFinite(record.startupMs)
      || record.startupMs < 0
    ) return false;
    destroyed.add(record.destroyedSurfaceId);
    provisioned.add(record.provisionedSurfaceId);
    return true;
  });
}

/**
 * Rejects any requested load row that did not finish the non-performance
 * scenarios. Unsupported capacity may miss FPS while still completing them.
 */
export function requireCompletedOperationalRows(rows: readonly CapacityRowForGate[]): void {
  for (const row of rows) {
    const count = row.screens;
    const label = `${String(row.screens)}x${String(row.profile)}`;
    const staticPreview = row.staticPreview;
    const staticFrames = staticPreview !== null
      && typeof staticPreview === "object"
      && "frames" in staticPreview
      && Array.isArray(staticPreview.frames)
      ? staticPreview.frames
      : [];
    const crashes = Array.isArray(row.crashes) ? row.crashes : [];
    const cleanup = row.cleanup;
    const complete = Number.isSafeInteger(count)
      && (count as number) > 0
      && row.error === undefined
      && row.operationalPassed === true
      && Array.isArray(row.frames)
      && row.frames.length === count
      && staticFrames.length === count
      && staticFrames.every((frame: unknown) =>
        frame !== null
        && typeof frame === "object"
        && "displayedFrames" in frame
        && typeof frame.displayedFrames === "number"
        && frame.displayedFrames > 0
      )
      && row.simultaneousAgentAndWebInputCompleted === true
      && row.takeoverCompleted === true
      && row.reconnects === (count as number) * 2
      && crashes.length === Math.min(2, count as number)
      && crashes.every((crash: unknown) =>
        crash !== null && typeof crash === "object" && "isolated" in crash && crash.isolated === true
      )
      && validProvisionDestroy(row.repeatedProvisionDestroy, 2)
      && cleanup !== null
      && typeof cleanup === "object"
      && "clean" in cleanup
      && cleanup.clean === true;
    if (!complete) throw new Error(`capacity row ${label} did not complete every operational scenario`);
  }
}

/**
 * Selects the single measured row that is allowed to justify the shipped
 * capacity. A smaller passing row is never silently substituted.
 */
export function requireApprovedDefaultRow(
  rows: readonly CapacityRowForGate[],
  configuredDefault: number,
  approval: CapacityApproval,
): CapacityRowForGate {
  if (approval.schemaVersion !== 2) {
    throw new Error("configured Bot Screen default requires a schema-v2 approval artifact");
  }
  if (
    approval.finalClient.built !== true
    || approval.finalClient.measurement.trim() === ""
    || !isNonLoopbackLanEndpoint(approval.finalClient.lanEndpoint)
  ) {
    throw new Error("configured Bot Screen default approval lacks final-client LAN browser provenance");
  }
  if (
    approval.lifecycleProof.strategy !== "permanent-delete-and-fresh-provision"
    || approval.lifecycleProof.cyclesPerRow < 2
  ) {
    throw new Error("configured Bot Screen default approval lacks permanent delete/fresh provision evidence");
  }
  if (configuredDefault !== approval.defaultCapacity) {
    throw new Error(`configured Bot Screen default ${configuredDefault} has no approval record`);
  }
  if (
    approval.observedSourceFps.minimum < approval.targetFps
    || approval.observedSourceFps.maximum < approval.observedSourceFps.minimum
    || approval.observedEncodedFps.minimum < approval.targetFps
    || approval.observedEncodedFps.maximum < approval.observedEncodedFps.minimum
    || approval.observedDisplayedFps.minimum < approval.targetFps
    || approval.observedDisplayedFps.maximum < approval.observedDisplayedFps.minimum
    || approval.observedInputToVisibleP50Ms > approval.inputToVisibleP50LimitMs
    || approval.observedDrops.unexplainedDrops !== 0
  ) {
    throw new Error("configured Bot Screen default approval did not pass its recorded thresholds");
  }
  const row = rows.find((candidate) =>
    candidate.profile === approval.profile && candidate.screens === configuredDefault
  );
  if (row === undefined) {
    throw new Error(`release gate is missing the ${configuredDefault}x${approval.profile} default-capacity row`);
  }
  if (row.performancePassed !== true) {
    throw new Error(`release gate default-capacity row ${configuredDefault}x${approval.profile} did not pass`);
  }
  const resolution = row.resolution;
  if (
    resolution === null
    || typeof resolution !== "object"
    || !("width" in resolution)
    || !("height" in resolution)
    || resolution.width !== approval.resolution.width
    || resolution.height !== approval.resolution.height
    || row.targetFps !== approval.targetFps
  ) {
    throw new Error("release gate default-capacity row does not match the approved measurement profile");
  }
  if (!validBrowserFrames(row.frames, configuredDefault, approval.targetFps)) {
    throw new Error("release gate requires production encoded and browser-displayed FPS, sequence/drop accounting, and no unexplained drops");
  }
  if (!validProvisionDestroy(row.repeatedProvisionDestroy, approval.lifecycleProof.cyclesPerRow)) {
    throw new Error("release gate requires repeated permanent deletion and fresh Bot/Surface provisioning");
  }
  if (!validPaintLatency(row.inputToVisibleMs, approval.inputToVisibleP50LimitMs)) {
    throw new Error("release gate requires browser-painted input-to-visible latency samples");
  }
  if (!validPaintLatency(row.captureToBrowserMs, Number.POSITIVE_INFINITY)) {
    throw new Error("release gate requires capture-to-browser paint latency samples");
  }
  return row;
}
