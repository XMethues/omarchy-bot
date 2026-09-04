import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import capacityApproval from "./bot-screen-capacity-approval.json";


/** Checked-in schema-v2 measurement that authorizes the shipped default. */
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
  conformanceDir: string;
  statusPath: string;
  /** Voxtype binary override (defaults to `voxtype` on PATH). */
  voxtypeBin?: string;
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

export function loadConfig(): Config {
  const dataDir = process.env.OMARCHY_BOT_HOME ?? path.join(os.homedir(), ".local/share/omarchy-bot");
  const stateDir = process.env.OMARCHY_BOT_STATE ?? path.join(os.homedir(), ".local/state/omarchy-bot");
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  const voxtypeBin = process.env.OMARCHY_BOT_VOXTYPE_BIN;
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
    conformanceDir: path.join(dataDir, "conformance"),
    statusPath: path.join(stateDir, "status.json"),
    ...(voxtypeBin !== undefined ? { voxtypeBin } : {}),
    host: process.env.OMARCHY_BOT_HOST ?? "127.0.0.1",
    port: Number(process.env.OMARCHY_BOT_PORT ?? 7321),
    turnTimeoutMs: Number(process.env.OMARCHY_BOT_TURN_TIMEOUT_MS ?? 600_000),
    botDeletionTerminalTimeoutMs: Number(process.env.OMARCHY_BOT_DELETION_TERMINAL_TIMEOUT_MS ?? 30_000),
    botScreenCapacity: positiveInteger("OMARCHY_BOT_SCREEN_CAPACITY", BOT_SCREEN_DEFAULT_CAPACITY_APPROVAL.defaultCapacity),
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
