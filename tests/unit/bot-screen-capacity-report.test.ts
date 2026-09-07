import { describe, expect, test } from "bun:test";
import type { NetworkInterfaceInfo } from "node:os";
import { BOT_SCREEN_CAPACITY_POLICY } from "../../apps/daemon/src/bootstrap/config.ts";
import {
  selectNonLoopbackLanAddress,
  type BrowserWindowMetric,
} from "../integration/helpers/bot-screen-browser-load.ts";
import {
  requireDefaultProjectionEvidence,
  requireCompletedOperationalRows,
  type CapacityRowForGate,
} from "../integration/helpers/bot-screen-capacity-report.ts";

interface TestCapacityRow extends CapacityRowForGate {
  frames: BrowserWindowMetric[];
}

function passingDefaultRow(): TestCapacityRow {
  const frames = Array.from({ length: 4 }, (_, index) => ({
    surfaceId: `surf_${index}`,
    lanEndpoint: "https://192.168.50.12:7321",
    finalWebClient: true as const,
    renderingSequences: Array.from({ length: 158 }, (_, sequence) => sequence + 1),
    captureAttempts: 160,
    sourceFrames: 160,
    browserReceives: 160,
    browserDecodes: 159,
    browserPaints: 158,
    previewFrames: 0,
    previewBytes: 0,
    rfbBytesSent: 100_000,
    rfbBytesReceived: 1_000,
    receivedFrames: 160,
    decodedFrames: 159,
    displayedFrames: 158,
    decodeDrops: 1,
    paintDrops: 1,
    receivedFps: 16,
    decodedFps: 15.9,
    displayedFps: 15.8,
    captureSkips: 0,
    invalidFrames: 0,
    transportSkips: 0,
    sendFailures: 0,
    unexplainedShortfalls: 0,
    captureLatencyMs: { samples: 160, mean: 12, lifetimeMax: 20 },
    captureToPaintLatencyMs: { samples: 158, mean: 35, lifetimeMax: 55 },
    targetFrameShortfall: { received: 0, decoded: 0, displayed: 0 },
    durationMs: 10_000,
    captureToBrowserMs: [],
  }));
  return {
    runtime: "sway",
    profile: "1080p",
    screens: 4,
    resolution: { width: 1920, height: 1080 },
    targetFps: 15,
    measurementsComplete: true,
    frames,
    inputToVisibleMs: { source: "browser-paint", samples: [42, 49, 55], p50: 49, p95: 55 },
    repeatedProvisionDestroy: [
      { cycle: 0, destroyedSurfaceId: "surf_0", provisionedSurfaceId: "surf_cycle_0", teardownMs: 45, startupMs: 800 },
      { cycle: 1, destroyedSurfaceId: "surf_cycle_0", provisionedSurfaceId: "surf_cycle_1", teardownMs: 48, startupMs: 820 },
    ],
    captureToBrowserMs: {
      available: false,
      reason: "RFB view paints do not carry an absolute capture timestamp",
    },
    operationalPassed: true,
    directWebSocketRecovery: {
      maxAttemptsPerConnection: 3,
      attempts: 14,
      failures: 0,
      failureDetails: [],
      successfulFreshFrames: 14,
    },
    staticPreview: { frames: Array.from({ length: 4 }, () => ({ displayedFrames: 15 })) },
    simultaneousAgentAndWebInputCompleted: true,
    takeoverCompleted: true,
    reconnectRecovery: {
      maxAttemptsPerConnection: 3,
      attempts: 8,
      failures: 0,
      failureDetails: [],
      successfulFreshFrames: 8,
    },
    reconnects: 8,
    crashes: [
      { role: "capture-helper", isolated: true, snapshotFallback: true },
      { role: "wayvnc", isolated: true, snapshotFallback: true },
      { role: "input-helper", isolated: true },
      { role: "compositor", isolated: true },
    ],
    projectionLifecycle: {
      unopenedNoRuntime: true,
      idleWayvncProcessesObserved: 0,
      staticPreviewWayvncProcessesObserved: 0,
      expandedWayvncProcessesObserved: 4,
      postExpandedWayvncProcessesObserved: 0,
    },
    activeResources: {
      screens: Array.from({ length: 4 }, () => ({ pssMiB: 100, rssMiB: 200, cpuPercent: 20 })),
      total: { pssMiB: 500, rssMiB: 900, cpuPercent: 100 },
    },
    aggregateMetrics: { rfbBytesSent: 400_000, rfbBytesReceived: 4_000 },
    admission: {
      capacity: 4,
      noPartialRuntime: true,
      activeUnaffected: true,
      activeEnvelopeMaintained: true,
    },
    cleanup: { clean: true },
  };
}

describe("current Sway projection measurement evidence", () => {
  test("selects the measured configured default without treating it as a performance approval", () => {
    const row = passingDefaultRow();
    expect(requireDefaultProjectionEvidence([row], 4, BOT_SCREEN_CAPACITY_POLICY)).toBe(row);
  });

  test("rejects historical compositor rows as Sway measurement evidence", () => {
    const historical = { ...passingDefaultRow(), runtime: "cage" };
    expect(() => requireDefaultProjectionEvidence([historical], 4, BOT_SCREEN_CAPACITY_POLICY)).toThrow();
  });

  test("requires bidirectional RFB traffic and visible browser paint", () => {
    const missingTraffic = passingDefaultRow();
    missingTraffic.frames = missingTraffic.frames.map((frame) => ({ ...frame, rfbBytesReceived: 0 }));
    expect(() => requireDefaultProjectionEvidence([missingTraffic], 4, BOT_SCREEN_CAPACITY_POLICY)).toThrow();
    const missingPaint = passingDefaultRow();
    missingPaint.frames = missingPaint.frames.map((frame) => ({ ...frame, displayedFrames: 0, renderingSequences: [] }));
    expect(() => requireDefaultProjectionEvidence([missingPaint], 4, BOT_SCREEN_CAPACITY_POLICY)).toThrow();
  });

  test("does not impose video-frame conservation or a historical latency budget on RFB", () => {
    const row = passingDefaultRow();
    row.frames = row.frames.map((frame) => ({
      ...frame, receivedFrames: 100, decodedFrames: 1, displayedFrames: 1,
      receivedFps: 10, decodedFps: 0.1, displayedFps: 0.1, renderingSequences: [1],
      browserReceives: 0, browserDecodes: 0, browserPaints: 0,
    }));
    row.inputToVisibleMs = { source: "browser-paint", samples: [1100, 1300, 1500], p50: 1300, p95: 1500 };
    expect(requireDefaultProjectionEvidence([row], 4, BOT_SCREEN_CAPACITY_POLICY)).toBe(row);
  });

  test("does not substitute a smaller row or incomplete current measurements", () => {
    const smaller = { ...passingDefaultRow(), screens: 2 };
    expect(() => requireDefaultProjectionEvidence([smaller], 4, BOT_SCREEN_CAPACITY_POLICY)).toThrow();
    const incomplete = { ...passingDefaultRow(), measurementsComplete: false };
    expect(() => requireDefaultProjectionEvidence([incomplete], 4, BOT_SCREEN_CAPACITY_POLICY)).toThrow();
  });

  test("requires browser-painted rather than control-receipt latency", () => {
    const row = passingDefaultRow();
    row.inputToVisibleMs = { source: "control-receipt", samples: [20], p50: 20, p95: 20 };
    expect(() => requireDefaultProjectionEvidence([row], 4, BOT_SCREEN_CAPACITY_POLICY)).toThrow();
  });

  test("requires repeated real teardown and fresh surface identities", () => {
    const row = passingDefaultRow();
    row.repeatedProvisionDestroy = [{ cycle: 0, destroyedSurfaceId: "same", provisionedSurfaceId: "same", teardownMs: 1, startupMs: 1 }];
    expect(() => requireDefaultProjectionEvidence([row], 4, BOT_SCREEN_CAPACITY_POLICY)).toThrow();
  });

  test("does not accept loopback as LAN measurement evidence", () => {
    const row = passingDefaultRow();
    row.frames = row.frames.map((frame) => ({ ...frame, lanEndpoint: "https://127.0.0.1:7321" }));
    expect(() => requireDefaultProjectionEvidence([row], 4, BOT_SCREEN_CAPACITY_POLICY)).toThrow();
  });
});

test("LAN selection is deterministic and honors an explicit interface", () => {
  const interfaces = {
    lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: true, cidr: "127.0.0.1/8" }],
    wlan0: [{ address: "192.168.50.12", netmask: "255.255.255.0", family: "IPv4", mac: "00:00:00:00:00:01", internal: false, cidr: "192.168.50.12/24" }],
    eth0: [{ address: "10.0.0.8", netmask: "255.255.255.0", family: "IPv4", mac: "00:00:00:00:00:02", internal: false, cidr: "10.0.0.8/24" }],
  } satisfies NodeJS.Dict<NetworkInterfaceInfo[]>;
  expect(selectNonLoopbackLanAddress(interfaces)).toEqual({ interfaceName: "eth0", address: "10.0.0.8" });

  expect(selectNonLoopbackLanAddress(interfaces, "wlan0")).toEqual({ interfaceName: "wlan0", address: "192.168.50.12" });
});

test("operational gate rejects an incomplete unsupported-performance row", () => {
  const incomplete = { ...passingDefaultRow(), reconnects: 2, repeatedProvisionDestroy: [] };
  expect(() => requireCompletedOperationalRows([incomplete]))
    .toThrow();
});
