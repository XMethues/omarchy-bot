import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import capacityApproval from "./bot-screen-capacity-approval.json";

/** Checked-in schema-v3 final-stack measurement that authorizes production capacity. */
export const BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL = Object.freeze(capacityApproval);

export interface Config {
  dataDir: string;
  stateDir: string;
  dbPath: string;
  artifactsDir: string;
  attachmentsDir: string;
  avatarsDir: string;
  /** Voxtype transcript targets live here; runtime dir preferred, state dir fallback. */
  dictationDir: string;
  /** Transient child sockets and retained Bot-owned application profiles. */
  botScreenRuntimeDir: string;
  botScreenProfileDir: string;
  /** Lazily provisioned portable compositor files owned by this application. */
  botScreenRuntimeSupplyDir: string;
  conformanceDir: string;
  statusPath: string;
  /** Voxtype binary override (defaults to `voxtype` on PATH). */
  voxtypeBin?: string;
  /** ffmpeg override shared by Cage preflight and H.264 Screen Projection. */
  botScreenFfmpegBin?: string;
  /** HTTP listener address. Non-loopback values expose unauthenticated control APIs. */
  host: string;
  port: number;
  turnTimeoutMs: number;
  /** Maximum time deletion waits for a cancelled Turn to report a terminal state. */
  botDeletionTerminalTimeoutMs: number;
  botScreenCapacity: number;
  botScreenProfile: "1080p" | "720p";
  botScreenLogicalWidth: number;
  /** Single UDP port used by multiplexed WebRTC Screen Projection peers. */
  botScreenWebRtcPort: number;
  botScreenLogicalHeight: number;
  botScreenFrameRate: number;
}

function positiveInteger(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function botScreenProfile(): {
  name: "1080p" | "720p";
  logicalWidth: number;
  logicalHeight: number;
} {
  const name = process.env.OMARCHY_BOT_SCREEN_PROFILE ?? "1080p";
  if (name === "1080p") return { name, logicalWidth: 1920, logicalHeight: 1080 };
  if (name === "720p") return { name, logicalWidth: 1280, logicalHeight: 720 };
  throw new Error("OMARCHY_BOT_SCREEN_PROFILE must be 1080p or 720p");
}

function botScreenCapacity(profile: "1080p" | "720p"): number {
  const capacity = positiveInteger(
    "OMARCHY_BOT_SCREEN_CAPACITY",
    BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.defaultCapacity,
  );
  const supported = BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.capacityRows
    .filter((row) => row.profile === profile && row.supportStatus === "supported")
    .reduce((maximum, row) => Math.max(maximum, row.screens), 0);
  if (capacity > supported) {
    throw new Error(
      `OMARCHY_BOT_SCREEN_CAPACITY=${capacity} exceeds the approved ${profile} capacity of ${supported}`,
    );
  }
  return capacity;
}
function validateApprovedCompositorMemory(): void {
  const proof = BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.compositorMemory;
  const matched1080p = (
    measurement: { runtime: string; resolution: { width: number; height: number }; pssMiB: number },
    runtime: "hyprland" | "cage",
  ): boolean =>
    measurement.runtime === runtime
    && measurement.resolution.width === 1920
    && measurement.resolution.height === 1080
    && measurement.pssMiB > 0;
  const measuredReduction =
    (proof.baseline.pssMiB - proof.candidate.pssMiB) / proof.baseline.pssMiB * 100;
  if (
    proof.passed !== true
    || !matched1080p(proof.baseline, "hyprland")
    || !matched1080p(proof.candidate, "cage")
    || proof.minimumReductionPercent <= 0
    || proof.reductionPercent < proof.minimumReductionPercent
    || proof.candidate.pssMiB >= proof.baseline.pssMiB
    || measuredReduction < proof.minimumReductionPercent
    || Math.abs(measuredReduction - proof.reductionPercent) > 0.01
  ) {
    throw new Error("checked Bot Screen approval lacks a passing matched-1080p compositor-memory proof");
  }
}



export function loadConfig(): Config {
  validateApprovedCompositorMemory();
  const dataDir = process.env.OMARCHY_BOT_HOME ?? path.join(os.homedir(), ".local/share/omarchy-bot");
  const stateDir = process.env.OMARCHY_BOT_STATE ?? path.join(os.homedir(), ".local/state/omarchy-bot");
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  const voxtypeBin = process.env.OMARCHY_BOT_VOXTYPE_BIN;
  const botScreenFfmpegBin = process.env.OMARCHY_BOT_FFMPEG_BIN;
  const screenProfile = botScreenProfile();
  const cfg: Config = {
    dataDir,
    stateDir,
    dbPath: path.join(dataDir, "db.sqlite"),
    artifactsDir: path.join(dataDir, "artifacts"),
    attachmentsDir: path.join(dataDir, "attachments"),
    avatarsDir: path.join(dataDir, "avatars"),
    dictationDir: runtimeDir ? path.join(runtimeDir, "omarchy-bot", "dictation") : path.join(stateDir, "dictation"),
    botScreenRuntimeDir: runtimeDir
      ? path.join(runtimeDir, "omarchy-bot", "screens")
      : path.join(stateDir, "screen-runtime"),
    botScreenProfileDir: path.join(dataDir, "screens"),
    botScreenRuntimeSupplyDir: path.join(dataDir, "runtime", "cage"),
    conformanceDir: path.join(dataDir, "conformance"),
    statusPath: path.join(stateDir, "status.json"),
    ...(voxtypeBin !== undefined ? { voxtypeBin } : {}),
    ...(botScreenFfmpegBin === undefined ? {} : { botScreenFfmpegBin }),
    host: process.env.OMARCHY_BOT_HOST ?? "127.0.0.1",
    port: Number(process.env.OMARCHY_BOT_PORT ?? 7321),
    turnTimeoutMs: Number(process.env.OMARCHY_BOT_TURN_TIMEOUT_MS ?? 600_000),
    botDeletionTerminalTimeoutMs: Number(process.env.OMARCHY_BOT_DELETION_TERMINAL_TIMEOUT_MS ?? 30_000),
    botScreenCapacity: botScreenCapacity(screenProfile.name),
    botScreenWebRtcPort: Number(process.env.OMARCHY_BOT_SCREEN_WEBRTC_PORT ?? 7323),
    botScreenProfile: screenProfile.name,
    botScreenLogicalWidth: screenProfile.logicalWidth,
    botScreenLogicalHeight: screenProfile.logicalHeight,
    botScreenFrameRate: positiveInteger("OMARCHY_BOT_SCREEN_FRAME_RATE", BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.captureFrameRate),
  };
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(cfg.artifactsDir, { recursive: true });
  mkdirSync(cfg.attachmentsDir, { recursive: true });
  mkdirSync(cfg.avatarsDir, { recursive: true });
  mkdirSync(cfg.dictationDir, { recursive: true });
  mkdirSync(cfg.botScreenProfileDir, { recursive: true });
  mkdirSync(cfg.conformanceDir, { recursive: true });
  return cfg;
}
