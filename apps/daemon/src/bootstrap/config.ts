import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Config {
  dataDir: string;
  stateDir: string;
  dbPath: string;
  artifactsDir: string;
  attachmentsDir: string;
  conformanceDir: string;
  statusPath: string;
  port: number;
  /** TTL for bot-held computer leases; human leases never auto-expire. */
  leaseTtlMs: number;
  approvalTimeoutMs: number;
  turnTimeoutMs: number;
}

export function loadConfig(): Config {
  const dataDir = process.env.OMARCHY_BOT_HOME ?? path.join(os.homedir(), ".local/share/omarchy-bot");
  const stateDir = process.env.OMARCHY_BOT_STATE ?? path.join(os.homedir(), ".local/state/omarchy-bot");
  const cfg: Config = {
    dataDir,
    stateDir,
    dbPath: path.join(dataDir, "db.sqlite"),
    artifactsDir: path.join(dataDir, "artifacts"),
    attachmentsDir: path.join(dataDir, "attachments"),
    conformanceDir: path.join(dataDir, "conformance"),
    statusPath: path.join(stateDir, "status.json"),
    port: Number(process.env.OMARCHY_BOT_PORT ?? 7321),
    leaseTtlMs: Number(process.env.OMARCHY_BOT_LEASE_TTL_MS ?? 120_000),
    approvalTimeoutMs: Number(process.env.OMARCHY_BOT_APPROVAL_TIMEOUT_MS ?? 300_000),
    turnTimeoutMs: Number(process.env.OMARCHY_BOT_TURN_TIMEOUT_MS ?? 600_000),
  };
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });
  mkdirSync(cfg.artifactsDir, { recursive: true });
  mkdirSync(cfg.attachmentsDir, { recursive: true });
  mkdirSync(cfg.conformanceDir, { recursive: true });
  return cfg;
}
