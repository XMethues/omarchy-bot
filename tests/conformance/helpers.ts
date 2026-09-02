/**
 * Conformance harness: boots the real daemon with the REAL workers (pi +
 * computer) against the user's actual Pi credentials, in an isolated data dir.
 */
import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ConformanceDaemon {
  baseUrl: string;
  port: number;
  home: string;
  svc: import("../../apps/daemon/src/api/http.ts").DaemonServices;
  stop: () => Promise<void>;
}

export async function startConformanceDaemon(): Promise<ConformanceDaemon> {
  const home = path.join(os.tmpdir(), `omarchy-bot-conformance-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const state = path.join(os.tmpdir(), `omarchy-bot-conformance-state-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(home, { recursive: true });
  mkdirSync(state, { recursive: true });
  // NOTE: no conformance record is pre-baked — the suite writes it on success.

  process.env.OMARCHY_BOT_HOME = home;
  process.env.OMARCHY_BOT_STATE = state;
  process.env.OMARCHY_BOT_PORT = "0";
  delete process.env.OMARCHY_BOT_WORKERS_DIR; // real workers

  // Dynamic import: the harness mutates process.env above; importing main.ts fresh keeps that contract explicit.
  const { main } = await import("../../apps/daemon/src/bootstrap/main.ts");
  const { stop, port, svc } = await main();
  return { baseUrl: `http://127.0.0.1:${port}`, port, home, svc, stop };
}

/** 1×1 red PNG. */
export const RED_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
