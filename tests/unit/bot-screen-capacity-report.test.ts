import { describe, expect, test } from "bun:test";
import type { NetworkInterfaceInfo } from "node:os";
import { BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL } from "../../apps/daemon/src/bootstrap/config.ts";
import {
  selectNonLoopbackLanAddress,
  type BrowserWindowMetric,
} from "../integration/helpers/bot-screen-browser-load.ts";
import {
  requireApprovedDefaultRow,
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
    transportDrops: 0,
    captureAttempts: 160,
    sourceFrames: 160,
    encoderInputs: 160,
    encodedFrames: 160,
    sentFrames: 160,
    encodedBytes: 100_000,
    encodedBitrateBps: 80_000,
    receivedFrames: 160,
    decodedFrames: 159,
    displayedFrames: 158,
    decodeDrops: 1,
    paintDrops: 1,
    sourceFps: 16,
    encodedFps: 16,
    sentFps: 16,
    receivedFps: 16,
    decodedFps: 15.9,
    displayedFps: 15.8,
    preCaptureBackpressureSkips: 0,
    encodedBackpressureDrops: 0,
    transportUnavailableSkips: 0,
    invalidFrameDrops: 0,
    sendFailures: 0,
    unexplainedDrops: 0,
    pipelineBoundaryCarry: {
      start: { capture: 0, encode: 0, rtp: 0, receive: 0, decode: 0, paint: 0 },
      end: { capture: 0, encode: 0, rtp: 0, receive: 0, decode: 0, paint: 0 },
      unexplainedByStage: { capture: 0, encode: 0, rtp: 0, receive: 0, decode: 0, paint: 0 },
    },
    captureLatencyMs: { samples: 160, mean: 12, lifetimeMax: 20 },
    encodeLatencyMs: { samples: 160, mean: 8, lifetimeMax: 15 },
    targetFrameShortfall: { source: 0, encoded: 0, sent: 0, received: 0, decoded: 0, displayed: 0 },
    durationMs: 10_000,
    captureToBrowserMs: [],
    pipelineBoundary: {
      start: { received: 0, decoded: 0, dropped: 0, displayed: 0 },
      end: { received: 160, decoded: 159, dropped: 1, displayed: 158 },
    },
  }));
  return {
    profile: "1080p",
    screens: 4,
    resolution: { width: 1920, height: 1080 },
    targetFps: 15,
    performancePassed: true,
    frames,
    inputToVisibleMs: { source: "browser-paint", samples: [42, 49, 55], p50: 49, p95: 55 },
    repeatedProvisionDestroy: [
      { cycle: 0, destroyedSurfaceId: "surf_0", provisionedSurfaceId: "surf_cycle_0", teardownMs: 45, startupMs: 800 },
      { cycle: 1, destroyedSurfaceId: "surf_cycle_0", provisionedSurfaceId: "surf_cycle_1", teardownMs: 48, startupMs: 820 },
    ],
    captureToBrowserMs: {
      available: false,
      reason: "WebRTC H.264 did not negotiate an absolute capture timestamp",
    },
    operationalPassed: true,
    nativePeerRecovery: {
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
      { role: "encoder", isolated: true, snapshotFallback: true },
      { role: "input-helper", isolated: true },
      { role: "compositor", isolated: true },
    ],
    encodingLifecycle: {
      unopenedNoRuntime: true,
      idleEncoderProcessesObserved: 0,
      staticPreviewEncoderProcessesObserved: 0,
      expandedEncoderProcessesObserved: 4,
      postExpandedEncoderProcessesObserved: 0,
    },
    activeResources: {
      screens: Array.from({ length: 4 }, () => ({ pssMiB: 100, rssMiB: 200, cpuPercent: 20 })),
      total: { pssMiB: 500, rssMiB: 900, cpuPercent: 100 },
    },
    aggregateMetrics: { encodedBytes: 400_000, encodedBitrateBps: 320_000 },
    admission: {
      capacity: 4,
      noPartialRuntime: true,
      activeUnaffected: true,
      activeEnvelopeMaintained: true,
    },
    cleanup: { clean: true },
  };
}

describe("Bot Screen default-capacity release gate", () => {
  test("ties default four to the checked final-client measurement", () => {
    expect(BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL).toMatchObject({
      schemaVersion: 3,
      sourceReport: { schemaVersion: 3 },
      runtime: "cage",
      defaultCapacity: 4,
      profile: "1080p",
      resolution: { width: 1920, height: 1080 },
      finalClient: {
        built: true,
        transport: "WebRTC H.264 video track",
      },
      lifecycleProof: {
        strategy: "permanent-delete-and-fresh-provision",
        cyclesPerRow: 2,
      },
    });
    expect(BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.sourceReport.path)
      .toEndWith(".scratch/bot-screen-media-desktop/capacity-report.json");
    expect(BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.capacityRows).toContainEqual({
      profile: "1080p",
      screens: 4,
      supportStatus: "supported",
    });
    expect(BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.capacityRows).toContainEqual({
      profile: "1080p",
      screens: 8,
      supportStatus: "unsupported",
      reason: expect.any(String),
    });
    expect(BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.capacityRows).toContainEqual({
      profile: "720p",
      screens: 8,
      supportStatus: "supported",
    });
    const row = passingDefaultRow();
    expect(requireApprovedDefaultRow([row], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL)).toBe(row);
  });

  test("accounts for frames still in server-to-browser transit at the window end", () => {
    const row = passingDefaultRow();
    row.frames = row.frames.map((frame) => ({
      ...frame,
      captureAttempts: 161,
      sourceFrames: 161,
      encoderInputs: 161,
      encodedFrames: 161,
      sentFrames: 161,
      pipelineBoundaryCarry: {
        ...frame.pipelineBoundaryCarry!,
        end: { ...frame.pipelineBoundaryCarry!.end, receive: 1 },
      },
    }));
    expect(requireApprovedDefaultRow([row], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL)).toBe(row);
  });

  test("accounts for a frame sent before the browser measurement window", () => {
    const row = passingDefaultRow();
    row.frames = row.frames.map((frame) => ({
      ...frame,
      receivedFrames: 161,
      decodedFrames: 160,
      displayedFrames: 159,
      renderingSequences: Array.from({ length: 159 }, (_, sequence) => sequence + 1),
      pipelineBoundaryCarry: {
        ...frame.pipelineBoundaryCarry!,
        start: { ...frame.pipelineBoundaryCarry!.start, receive: 1 },
      },
      pipelineBoundary: {
        start: { received: 1, decoded: 0, dropped: 0, displayed: 0 },
        end: { received: 162, decoded: 160, dropped: 1, displayed: 159 },
      },
    }));
    expect(requireApprovedDefaultRow([row], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL)).toBe(row);
  });
  test("does not substitute a smaller passing row when the configured row is absent", () => {
    const smaller = { ...passingDefaultRow(), screens: 2 };
    expect(() => requireApprovedDefaultRow([smaller], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL))
      .toThrow("missing the 4x1080p");
  });

  test("rejects a present default row whose performance result failed", () => {
    const failed = { ...passingDefaultRow(), performancePassed: false };
    expect(() => requireApprovedDefaultRow([failed], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL))
      .toThrow("did not pass");
  });

  test("rejects an approval artifact whose recorded default did not pass", () => {
    const failedApproval = {
      ...BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL,
      observedDisplayedFps: { minimum: 14.99, maximum: 15.31 },
    };
    expect(() => requireApprovedDefaultRow([passingDefaultRow()], 4, failedApproval))
      .toThrow("approval did not pass its recorded thresholds");

    const unexplainedApproval = {
      ...BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL,
      observedDrops: {
        ...BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.observedDrops,
        unexplainedDrops: 1,
      },
    };
    expect(() => requireApprovedDefaultRow([passingDefaultRow()], 4, unexplainedApproval))
      .toThrow("approval did not pass its recorded thresholds");
  });

  test("requires reviewable final-client LAN provenance in the approval artifact", () => {
    const unreviewableApproval = {
      ...BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL,
      finalClient: {
        ...BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.finalClient,
        lanEndpoint: "https://127.0.0.1:33921",
      },
    };
    expect(() => requireApprovedDefaultRow([passingDefaultRow()], 4, unreviewableApproval))
      .toThrow("lacks final-client LAN browser provenance");
  });

  test("requires production encoding, preserved sequence accounting, and browser paint", () => {
    const complete = passingDefaultRow();
    const missingDecode = {
      ...complete,
      frames: complete.frames.map(({ decodedFps: _, ...frame }) => frame),
    };
    expect(() => requireApprovedDefaultRow([missingDecode], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL))
      .toThrow("all-stage FPS");

    const processReceipt = passingDefaultRow();
    processReceipt.inputToVisibleMs = { source: "node-datachannel", samples: [20], p50: 20, p95: 20 };
    expect(() => requireApprovedDefaultRow([processReceipt], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL))
      .toThrow("browser-painted input-to-visible");

  });

  test("rejects a default row with a stage shortfall or unexplained transport loss", () => {
    const shortfall = passingDefaultRow();
    shortfall.frames[0] = { ...shortfall.frames[0]!, encodedFps: 14.9, targetFrameShortfall: { source: 1, encoded: 1, sent: 1, received: 1, decoded: 1, displayed: 1 } };
    expect(() => requireApprovedDefaultRow([shortfall], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL))
      .toThrow("no unexplained drops");

    const transportLoss = passingDefaultRow();
    transportLoss.frames[0] = {
      ...transportLoss.frames[0]!,
      transportDrops: 1,
      receivedFrames: 159,
      decodedFrames: 158,
      displayedFrames: 157,
      renderingSequences: transportLoss.frames[0]!.renderingSequences.slice(0, 157),
      decodeDrops: 1,
      paintDrops: 1,
      unexplainedDrops: 1,
    };
    expect(() => requireApprovedDefaultRow([transportLoss], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL))
      .toThrow("no unexplained drops");
  });

  test("rejects archive-era or missing repeated provision/destroy evidence", () => {
    const incomplete = passingDefaultRow();
    incomplete.repeatedProvisionDestroy = [
      { cycle: 0, destroyedSurfaceId: "surf_0", provisionedSurfaceId: "surf_cycle_0", teardownMs: 45, startupMs: 800 },
    ];
    expect(() => requireApprovedDefaultRow([incomplete], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL))
      .toThrow("repeated permanent deletion");
  });

  test("rejects loopback browser endpoints", () => {
    const complete = passingDefaultRow();
    const row = {
      ...complete,
      frames: complete.frames.map((frame) => ({
        ...frame,
        lanEndpoint: "https://127.0.0.1:7321",
      })),
    };
    expect(() => requireApprovedDefaultRow([row], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL))
      .toThrow("all-stage FPS");
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
  const complete = passingDefaultRow();
  complete.performancePassed = false;
  expect(() => requireCompletedOperationalRows([complete])).not.toThrow();

  const incomplete = { ...complete, reconnects: 2, repeatedProvisionDestroy: [] };
  expect(() => requireCompletedOperationalRows([incomplete]))
    .toThrow("4x1080p did not complete every operational scenario");
});
