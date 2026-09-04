import type { BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL } from "../../../apps/daemon/src/bootstrap/config.ts";

type CapacityApproval = typeof BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL;

export interface BrowserFrameMetric {
  surfaceId: string;
  lanEndpoint: string;
  finalWebClient: true;
  durationMs: number;
  renderingSequences: number[];
  transportDrops: number;
  receivedFrames: number;
  decodedFrames: number;
  displayedFrames: number;
  decodeDrops: number;
  paintDrops: number;
  receivedFps: number;
  decodedFps: number;
  displayedFps: number;
  captureAttempts?: number;
  sourceFrames?: number;
  encoderInputs?: number;
  encodedFrames?: number;
  sentFrames?: number;
  sourceFps?: number;
  encodedFps?: number;
  sentFps?: number;
  encodedBytes?: number;
  encodedBitrateBps?: number;
  preCaptureBackpressureSkips?: number;
  encodedBackpressureDrops?: number;
  transportUnavailableSkips?: number;
  invalidFrameDrops?: number;
  sendFailures?: number;
  unexplainedDrops?: number;
  pipelineBoundaryCarry?: {
    start: Record<"capture" | "encode" | "rtp" | "receive" | "decode" | "paint", number>;
    end: Record<"capture" | "encode" | "rtp" | "receive" | "decode" | "paint", number>;
    unexplainedByStage: Record<"capture" | "encode" | "rtp" | "receive" | "decode" | "paint", number>;
  };
  captureLatencyMs?: {
    samples: number;
    mean: number | null;
    lifetimeMax: number;
  };
  encodeLatencyMs?: {
    samples: number;
    mean: number | null;
    lifetimeMax: number;
  };
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
  p50: number;
  p95: number;
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
  reconnectRecovery?: unknown;
  nativePeerRecovery?: unknown;
  crashes?: unknown;
  cleanup?: unknown;
  activeResources?: unknown;
  aggregateMetrics?: unknown;
  encodingLifecycle?: unknown;
  admission?: unknown;
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

function validStageLatency(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  if (!("samples" in value) || !("mean" in value) || !("lifetimeMax" in value)) return false;
  return typeof value.samples === "number"
    && Number.isSafeInteger(value.samples)
    && value.samples > 0
    && typeof value.mean === "number"
    && Number.isFinite(value.mean)
    && value.mean >= 0
    && typeof value.lifetimeMax === "number"
    && Number.isFinite(value.lifetimeMax)
    && value.lifetimeMax >= value.mean;
}

function validBrowserFrames(value: unknown, expectedCount: number, targetFps: number): value is BrowserFrameMetric[] {
  if (!Array.isArray(value) || value.length !== expectedCount) return false;
  return value.every((entry: unknown) => {
    if (entry === null || typeof entry !== "object") return false;
    const metric = entry as Partial<BrowserFrameMetric>;
    const wholeNumbers = [
      metric.receivedFrames,
      metric.transportDrops,
      metric.decodedFrames,
      metric.displayedFrames,
      metric.decodeDrops,
      metric.paintDrops,
      metric.captureAttempts,
      metric.sourceFrames,
      metric.encoderInputs,
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
    const boundary = metric.pipelineBoundaryCarry;
    const stages = ["capture", "encode", "rtp", "receive", "decode", "paint"] as const;
    const validBoundary = boundary !== undefined
      && stages.every((stage) =>
        Number.isSafeInteger(boundary.start[stage])
        && boundary.start[stage] >= 0
        && Number.isSafeInteger(boundary.end[stage])
        && boundary.end[stage] >= 0
        && Number.isSafeInteger(boundary.unexplainedByStage[stage])
        && boundary.unexplainedByStage[stage] >= 0
      );
    const {
      receivedFrames,
      transportDrops,
      decodedFrames,
      decodeDrops,
      displayedFrames,
      paintDrops,
    } = metric;
    const balanced = validBoundary
      && boundary !== undefined
      && typeof receivedFrames === "number"
      && typeof transportDrops === "number"
      && typeof decodedFrames === "number"
      && typeof decodeDrops === "number"
      && typeof displayedFrames === "number"
      && typeof paintDrops === "number"
      && metric.captureAttempts! + metric.preCaptureBackpressureSkips! + boundary.start.capture
        === metric.sourceFrames! + metric.preCaptureBackpressureSkips! + boundary.end.capture
          + boundary.unexplainedByStage.capture
      && metric.encoderInputs! + boundary.start.encode
        === metric.encodedFrames! + metric.invalidFrameDrops! + metric.encodedBackpressureDrops!
          + boundary.end.encode + boundary.unexplainedByStage.encode
      && metric.encodedFrames! + boundary.start.rtp
        === metric.sentFrames! + metric.transportUnavailableSkips! + metric.sendFailures!
          + boundary.end.rtp + boundary.unexplainedByStage.rtp
      && metric.sentFrames! + boundary.start.receive
        === receivedFrames + transportDrops + boundary.end.receive
          + boundary.unexplainedByStage.receive
      && receivedFrames + boundary.start.decode
        === decodedFrames + decodeDrops + boundary.end.decode
          + boundary.unexplainedByStage.decode
      && decodedFrames + boundary.start.paint
        === displayedFrames + paintDrops + boundary.end.paint
          + boundary.unexplainedByStage.paint
      && metric.unexplainedDrops === stages.reduce(
        (sum, stage) => sum + boundary.unexplainedByStage[stage],
        0,
      );
    return typeof metric.surfaceId === "string"
      && metric.finalWebClient === true
      && isNonLoopbackLanEndpoint(metric.lanEndpoint)
      && typeof metric.durationMs === "number"
      && Number.isFinite(metric.durationMs)
      && metric.durationMs > 0
      && Array.isArray(metric.renderingSequences)
      && metric.renderingSequences.length === metric.displayedFrames
      && metric.renderingSequences.every((sequence, index) =>
        Number.isSafeInteger(sequence)
        && sequence > 0
        && (index === 0 || sequence > metric.renderingSequences![index - 1]!)
      )
      && wholeNumbers.every((number) => Number.isSafeInteger(number) && number! >= 0)
      && balanced
      && typeof metric.sourceFps === "number"
      && metric.sourceFps >= targetFps
      && typeof metric.encodedFps === "number"
      && metric.encodedFps >= targetFps
      && typeof metric.sentFps === "number"
      && metric.sentFps >= targetFps
      && typeof metric.receivedFps === "number"
      && metric.receivedFps >= targetFps
      && typeof metric.decodedFps === "number"
      && metric.decodedFps >= targetFps
      && typeof metric.displayedFps === "number"
      && metric.displayedFps >= targetFps
      && Number.isSafeInteger(metric.encodedBytes)
      && metric.encodedBytes! > 0
      && typeof metric.encodedBitrateBps === "number"
      && Number.isFinite(metric.encodedBitrateBps)
      && metric.encodedBitrateBps > 0
      && validStageLatency(metric.captureLatencyMs)
      && validStageLatency(metric.encodeLatencyMs)
      && metric.unexplainedDrops === 0
      && shortfall !== undefined
      && Object.values(shortfall).every((number) => number === 0)
      && shortfall.source === Math.max(0, targetFrames - metric.sourceFrames!)
      && shortfall.encoded === Math.max(0, targetFrames - metric.encodedFrames!)
      && shortfall.sent === Math.max(0, targetFrames - metric.sentFrames!)
      && shortfall.received === Math.max(0, targetFrames - metric.receivedFrames!)
      && shortfall.decoded === Math.max(0, targetFrames - metric.decodedFrames!)
      && shortfall.displayed === Math.max(0, targetFrames - metric.displayedFrames!);
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
function validPeerRecovery(value: unknown, expectedSuccesses: number): boolean {
  if (value === null || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.maxAttemptsPerConnection === 3
    && Number.isSafeInteger(record.attempts)
    && (record.attempts as number) >= expectedSuccesses
    && (record.attempts as number) <= expectedSuccesses * 3
    && Number.isSafeInteger(record.failures)
    && record.failures === (record.attempts as number) - expectedSuccesses
    && record.successfulFreshFrames === expectedSuccesses
    && Array.isArray(record.failureDetails)
    && record.failureDetails.length === record.failures
    && record.failureDetails.every((detail: unknown) => typeof detail === "string" && detail.length > 0);
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
    const encoding = row.encodingLifecycle;
    const resources = row.activeResources;
    const aggregate = row.aggregateMetrics;
    const reconnectRecovery = row.reconnectRecovery;
    const nativePeerRecovery = row.nativePeerRecovery;
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
      && reconnectRecovery !== null
      && typeof reconnectRecovery === "object"
      && "maxAttemptsPerConnection" in reconnectRecovery
      && reconnectRecovery.maxAttemptsPerConnection === 3
      && "attempts" in reconnectRecovery
      && Number.isSafeInteger(reconnectRecovery.attempts)
      && (reconnectRecovery.attempts as number) >= (count as number) * 2
      && (reconnectRecovery.attempts as number) <= (count as number) * 2 * 3
      && "failures" in reconnectRecovery
      && Number.isSafeInteger(reconnectRecovery.failures)
      && reconnectRecovery.failures === (reconnectRecovery.attempts as number) - (count as number) * 2
      && "successfulFreshFrames" in reconnectRecovery
      && reconnectRecovery.successfulFreshFrames === (count as number) * 2
      && "failureDetails" in reconnectRecovery
      && Array.isArray(reconnectRecovery.failureDetails)
      && reconnectRecovery.failureDetails.length === reconnectRecovery.failures
      && validPeerRecovery(nativePeerRecovery, (count as number) * 3 + 2)
      && crashes.length === 4
      && new Set(crashes.flatMap((crash: unknown) =>
        crash !== null && typeof crash === "object" && "role" in crash && typeof crash.role === "string"
          ? [crash.role]
          : []
      )).size === 4
      && crashes.every((crash: unknown) =>
        crash !== null
        && typeof crash === "object"
        && "isolated" in crash
        && crash.isolated === true
        && (!("role" in crash) || (crash.role !== "capture-helper" && crash.role !== "encoder")
          || ("snapshotFallback" in crash && crash.snapshotFallback === true))
      )
      && encoding !== null
      && typeof encoding === "object"
      && "unopenedNoRuntime" in encoding
      && encoding.unopenedNoRuntime === true
      && "idleEncoderProcessesObserved" in encoding
      && encoding.idleEncoderProcessesObserved === 0
      && "staticPreviewEncoderProcessesObserved" in encoding
      && encoding.staticPreviewEncoderProcessesObserved === 0
      && "expandedEncoderProcessesObserved" in encoding
      && encoding.expandedEncoderProcessesObserved === count
      && "postExpandedEncoderProcessesObserved" in encoding
      && encoding.postExpandedEncoderProcessesObserved === 0
      && resources !== null
      && typeof resources === "object"
      && "screens" in resources
      && Array.isArray(resources.screens)
      && resources.screens.length === count
      && "total" in resources
      && resources.total !== null
      && typeof resources.total === "object"
      && aggregate !== null
      && typeof aggregate === "object"
      && "encodedBytes" in aggregate
      && typeof aggregate.encodedBytes === "number"
      && aggregate.encodedBytes > 0
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
  if (approval.schemaVersion !== 3) {
    throw new Error("configured Bot Screen default requires a schema-v3 approval artifact");
  }
  if (
    approval.sourceReport.schemaVersion !== 3
    || approval.sourceReport.path.trim() === ""
  ) {
    throw new Error("configured Bot Screen default approval does not reference its schema-v3 final-stack report");
  }
  const supportedDefault = approval.capacityRows.some((candidate) =>
    candidate.profile === approval.profile
    && candidate.screens === approval.defaultCapacity
    && candidate.supportStatus === "supported"
  );
  const unsupportedEight1080 = approval.capacityRows.some((candidate) =>
    candidate.profile === "1080p"
    && candidate.screens === 8
    && candidate.supportStatus === "unsupported"
  );
  const supportedEight720 = approval.capacityRows.some((candidate) =>
    candidate.profile === "720p"
    && candidate.screens === 8
    && candidate.supportStatus === "supported"
  );
  if (!supportedDefault || !unsupportedEight1080 || !supportedEight720) {
    throw new Error("configured Bot Screen default approval lacks the explicit supported capacity matrix");
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
    throw new Error("release gate requires production all-stage FPS, browser paint/readback, drop accounting, and no unexplained drops");
  }
  if (!validProvisionDestroy(row.repeatedProvisionDestroy, approval.lifecycleProof.cyclesPerRow)) {
    throw new Error("release gate requires repeated permanent deletion and fresh Bot/Surface provisioning");
  }
  if (!validPaintLatency(row.inputToVisibleMs, approval.inputToVisibleP50LimitMs)) {
    throw new Error("release gate requires browser-painted input-to-visible latency samples");
  }
  if (row.inputToVisibleMs.p95 > approval.observedInputToVisibleP95Ms) {
    throw new Error("release gate input-to-visible p95 regressed beyond the approved envelope");
  }
  const admission = row.admission;
  if (
    admission === null
    || typeof admission !== "object"
    || !("capacity" in admission)
    || admission.capacity !== configuredDefault
    || !("noPartialRuntime" in admission)
    || admission.noPartialRuntime !== true
    || !("activeUnaffected" in admission)
    || admission.activeUnaffected !== true
    || !("activeEnvelopeMaintained" in admission)
    || admission.activeEnvelopeMaintained !== true
  ) {
    throw new Error("release gate requires deterministic pre-provision capacity rejection with admitted Screens in envelope");
  }
  return row;
}
