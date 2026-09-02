import { loadConfig } from "./config.ts";
import { openDb, recoverOnStartup } from "../persistence/db.ts";
import { EventLog } from "../modules/events/eventLog.ts";
import { ThreadsService } from "../modules/threads/threads.ts";
import { PermissionsService } from "../modules/permissions/permissions.ts";
import { BotRegistry } from "../modules/bots/registry.ts";
import { TaskRunner } from "../modules/tasks/runner.ts";
import { ComputerBroker } from "../modules/computer/broker.ts";
import { Supervisor } from "../supervision/supervisor.ts";
import { startHttp, type DaemonServices } from "../api/http.ts";
import { writeFileSync, renameSync } from "node:fs";
import path from "node:path";

/** The default agent Bot ranks first (research.md §6); read-only discovery only. */
function readDefaultAgent(): "pi" {
  try {
    const out = Bun.spawnSync(["omarchy", "default", "agent"], { stdout: "pipe", stderr: "ignore" });
    const v = out.stdout.toString().trim();
    return (["pi", "omp", "codex", "claude", "grok", "opencode", "gemini", "copilot", "crush"].includes(v) ? v : "pi") as "pi";
  } catch {
    return "pi";
  }
}

function writeStatusAtomic(statusPath: string, data: unknown): void {
  const tmp = `${statusPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, statusPath);
}

export async function main(): Promise<{ stop: () => Promise<void>; port: number; svc: DaemonServices }> {
  const cfg = loadConfig();
  const db = openDb(cfg);
  recoverOnStartup(db); // leases never survive a restart as bot-held

  const events = new EventLog(db);
  const threads = new ThreadsService(db, events);
  const permissions = new PermissionsService(db, events);
  const supervisor = new Supervisor(
    {
      onAgentEvent: (botId, event) => runner.onAgentEvent(botId, event),
      onWorkerCrash: (botId, err) => events.append("bot", botId, "bot.worker_crash", { message: err.message }),
    },
    {
      agents: path.resolve(import.meta.dir, process.env.OMARCHY_BOT_WORKERS_DIR ?? "../../../../workers"),
      computer: path.resolve(import.meta.dir, process.env.OMARCHY_BOT_WORKERS_DIR ?? "../../../../workers", "computer"),
    },
  );
  const bots = new BotRegistry(db, events, cfg, supervisor, readDefaultAgent());
  const runner = new TaskRunner(db, events, threads, permissions, bots, supervisor, { turnTimeoutMs: cfg.turnTimeoutMs });
  const computer = new ComputerBroker(db, events, permissions, supervisor, runner, cfg);

  bots.init();

  // Recheck enabled bots in the background: probe only; conformance stays explicit.
  for (const b of bots.list().filter((x) => x.enabled)) {
    void bots.recheck(b.id).catch(() => {});
  }

  const svc: DaemonServices = { cfg, db, events, bots, threads, runner, permissions, computer, supervisor };
  const http = startHttp(svc);

  // Periodic status file for the future bar widget (decoupled pattern from research.md §3).
  const statusTimer = setInterval(() => {
    try {
      writeStatusAtomic(cfg.statusPath, {
        ts: new Date().toISOString(),
        bots: bots.list().map((b) => ({ id: b.id, status: b.status })),
        approvals: permissions.listPending().length,
        computer: computer.state(),
      });
    } catch {
      /* status file is best-effort */
    }
  }, 2000);
  statusTimer.unref?.();

  console.log(`omarchy-bot daemon listening on http://127.0.0.1:${http.port}`);

  let stopping = false;
  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    // Shutdown order (app-structure.md §12):
    clearInterval(statusTimer);
    permissions.failClosedAll(); // 4. pending approvals resolve as unavailable
    computer.emergencyStop(); // 3. revoke leases, stop input (also parks runs)
    await supervisor.stopAll(); // 6. close workers
    http.stop(); // 8. close listeners
    db.close(); // 7. flush WAL
    console.log("omarchy-bot daemon stopped");
  };

  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  return { stop, port: http.port, svc };
}

if (import.meta.main) {
  void main();
}
