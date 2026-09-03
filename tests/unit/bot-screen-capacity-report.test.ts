import { describe, expect, test } from "bun:test";
import type { NetworkInterfaceInfo } from "node:os";
import { BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL } from "../../apps/daemon/src/bootstrap/config.ts";
import {
  selectNonLoopbackLanAddress,
  type BrowserWindowMetric,
} from "../integration/helpers/bot-screen-browser-load.ts";
import {
  requireApprovedDefaultRow,
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
    sequences: Array.from({ length: 160 }, (_, sequence) => sequence + 1),
    transportSequenceGaps: 0,
    sourceFrames: 160,
    encodedFrames: 160,
    sentFrames: 160,
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
    targetFrameShortfall: { source: 0, encoded: 0, sent: 0, received: 0, decoded: 0, displayed: 0 },
    durationMs: 10_000,
    captureToBrowserMs: [24, 31, 38],
  }));
  return {
    profile: "1080p",
    screens: 4,
    resolution: { width: 1920, height: 1080 },
    targetFps: 15,
    performancePassed: true,
    frames,
    inputToVisibleMs: { source: "browser-paint", samples: [42, 49, 55], p50: 49, p95: 55 },
    captureToBrowserMs: { source: "browser-paint", samples: [24, 31, 38], p50: 31, p95: 38 },
  };
}

describe("Bot Screen default-capacity release gate", () => {
  test("ties default four to the checked final-client measurement", () => {
    expect(BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL).toMatchObject({
      schemaVersion: 2,
      defaultCapacity: 4,
      profile: "1080p",
      resolution: { width: 1920, height: 1080 },
      finalClient: {
        built: true,
        browser: "Brave Browser 152.1.94.119",
        mode: "headless",
        lanEndpoint: "https://192.168.10.25:43757",
      },
      observedSourceFps: { minimum: 15.72, maximum: 15.78 },
      observedEncodedFps: { minimum: 15.72, maximum: 15.78 },
      observedDisplayedFps: { minimum: 15.72, maximum: 15.78 },
      observedInputToVisibleP50Ms: 138.7,
      observedInputToVisibleP95Ms: 488.3,
    });
    const row = passingDefaultRow();
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

  test("requires production encoding, preserved sequence accounting, browser paint, and capture latency", () => {
    const complete = passingDefaultRow();
    const missingDecode = {
      ...complete,
      frames: complete.frames.map(({ decodedFps: _, ...frame }) => frame),
    };
    expect(() => requireApprovedDefaultRow([missingDecode], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL))
      .toThrow("sequence/drop accounting");

    const processReceipt = passingDefaultRow();
    processReceipt.inputToVisibleMs = { source: "node-datachannel", samples: [20], p50: 20, p95: 20 };
    expect(() => requireApprovedDefaultRow([processReceipt], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL))
      .toThrow("browser-painted input-to-visible");

    const missingCapture = passingDefaultRow();
    missingCapture.captureToBrowserMs = { source: "browser-paint", samples: [], p50: null, p95: null };
    expect(() => requireApprovedDefaultRow([missingCapture], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL))
      .toThrow("capture-to-browser");
  });

  test("rejects a default row with source shortfall or unexplained sequence loss", () => {
    const shortfall = passingDefaultRow();
    shortfall.frames[0] = { ...shortfall.frames[0]!, encodedFps: 14.9, targetFrameShortfall: { source: 1, encoded: 1, sent: 1, received: 1, decoded: 1, displayed: 1 } };
    expect(() => requireApprovedDefaultRow([shortfall], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL))
      .toThrow("no unexplained drops");

    const sequenceLoss = passingDefaultRow();
    sequenceLoss.frames[0] = {
      ...sequenceLoss.frames[0]!,
      sequences: sequenceLoss.frames[0]!.sequences.slice(0, -1),
      unexplainedDrops: 1,
    };
    expect(() => requireApprovedDefaultRow([sequenceLoss], 4, BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL))
      .toThrow("no unexplained drops");
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
      .toThrow("production encoded and browser-displayed FPS");
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
