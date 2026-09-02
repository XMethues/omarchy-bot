import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Config {
  dataDir: string;
  stateDir: string;
  dbPath: string;
  artifactsDir: string;
  attachmentsDir: string;
  avatarsDir: string;
  /** Voxtype transcript targets live here; runtime dir preferred, state dir fallback. */
  dictationDir: string;
  conformanceDir: string;
  statusPath: string;
  /** Voxtype binary override (defaults to `voxtype` on PATH). */
  voxtypeBin?: string;
  port: number;
  /** TTL for bot-held computer leases; human leases never auto-expire. */
  leaseTtlMs: number;
  turnTimeoutMs: number;
}

export function loadConfig(): Config {
  const dataDir = process.env.OMARCHY_BOT_HOME ?? path.join(os.homedir(), ".local/share/omarchy-bot");
  const stateDir = process.env.OMARCHY_BOT_STATE ?? path.join(os.homedir(), ".local/state/omarchy-bot");
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  const voxtypeBin = process.env.OMARCHY_BOT_VOXTYPE_BIN;
  const cfg: Config = {
    dataDir,
    stateDir,
    dbPath: path.join(dataDir, "db.sqlite"),
    artifactsDir: path.join(dataDir, "artifacts"),
    attachmentsDir: path.join(dataDir, "attachments"),
    avatarsDir: path.join(dataDir, "avatars"),
    dictationDir: runtimeDir ? path.join(runtimeDir, "omarchy-bot", "dictation") : path.join(stateDir, "dictation"),
    conformanceDir: path.join(dataDir, "conformance"),
    statusPath: path.join(stateDir, "status.json"),
    ...(voxtypeBin !== undefined ? { voxtypeBin } : {}),
    port: Number(process.env.OMARCHY_BOT_PORT ?? 7321),
    leaseTtlMs: Number(process.env.OMARCHY_BOT_LEASE_TTL_MS ?? 120_000),
    turnTimeoutMs: Number(process.env.OMARCHY_BOT_TURN_TIMEOUT_MS ?? 600_000),
  };
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(cfg.artifactsDir, { recursive: true });
  mkdirSync(cfg.attachmentsDir, { recursive: true });
  mkdirSync(cfg.avatarsDir, { recursive: true });
  mkdirSync(cfg.dictationDir, { recursive: true });
  mkdirSync(cfg.conformanceDir, { recursive: true });
  return cfg;
}
