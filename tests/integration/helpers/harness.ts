/**
 * Daemon harness for integration tests: boots the real daemon in-process with
 * an isolated data dir, random port, and the scripted fake workers.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface Harness {
  baseUrl: string;
  port: number;
  home: string;
  stop: () => Promise<void>;
}

export async function startDaemon(existingHome?: string): Promise<Harness> {
  const home = existingHome ?? path.join(os.tmpdir(), `omarchy-bot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const state = path.join(os.tmpdir(), `omarchy-bot-test-state-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(home, { recursive: true });
  mkdirSync(state, { recursive: true });
  // Fake conformance record so the fake pi worker probes to `ready`.
  const conf = path.join(home, "conformance");
  mkdirSync(conf, { recursive: true });
  writeFileSync(path.join(conf, "pi-fake-pi-1.json"), JSON.stringify({ ok: true }));

  process.env.OMARCHY_BOT_HOME = home;
  process.env.OMARCHY_BOT_STATE = state;
  process.env.OMARCHY_BOT_PORT = "0";
  process.env.OMARCHY_BOT_WORKERS_DIR = path.resolve(import.meta.dir, "../fake-workers");

  const { main } = await import("../../../apps/daemon/src/bootstrap/main.ts");
  const { stop, port } = await main();
  const base: Harness = { baseUrl: `http://127.0.0.1:${port}`, port, home, stop };
  // wait until the fake pi bot finishes its probe and reports ready
  const deadline = Date.now() + 20_000;
  for (;;) {
    const bots = await fetch(`${base.baseUrl}/api/bots`).then((r) => r.json()) as { id: string; status: string }[];
    const pi = bots.find((b) => b.id === "pi");
    if (pi?.status === "ready") break;
    if (Date.now() > deadline) throw new Error(`pi bot never became ready (status: ${pi?.status ?? "none"})`);
    await Bun.sleep(150);
  }
  return base;
}

export async function api<T>(h: Harness, method: string, p: string, body?: unknown): Promise<T> {
  const res = await fetch(`${h.baseUrl}${p}`, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    headers: { "content-type": "application/json", "x-command-id": crypto.randomUUID() },
  });
  if (!res.ok && res.status !== 409 && res.status !== 503) {
    const text = (await res.text()).slice(0, 300);
    throw new Error(`${method} ${p} -> ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

/** Create a thread on the (only) enabled bot and return its id. */
export async function makeThread(h: Harness, title = "t"): Promise<string> {
  const bots = await api<{ id: string }[]>(h, "GET", "/api/bots");
  const t = await api<{ id: string }>(h, "POST", "/api/threads", { botId: bots[0]!.id, title });
  return t.id;
}
