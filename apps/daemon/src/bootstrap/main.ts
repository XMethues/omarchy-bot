import { loadConfig } from "./config.ts";
import { openDb, recoverOnStartup } from "../persistence/db.ts";
import { EventLog } from "../modules/events/eventLog.ts";
import { ThreadsService } from "../modules/threads/threads.ts";
import { ApprovalsService } from "../modules/approvals/approvals.ts";
import { AgentsRegistry } from "../modules/agents/registry.ts";
import { BotsService } from "../modules/bots/bots.ts";
import { TurnService } from "../modules/turns/turns.ts";
import { ComputerBroker } from "../modules/computer/broker.ts";
import { AvatarService } from "../modules/avatars/avatarService.ts";
import { DictationService } from "../modules/dictation/dictationService.ts";
import { Supervisor } from "../supervision/supervisor.ts";
import { startHttp, type DaemonServices } from "../api/http.ts";
import { writeFileSync, renameSync } from "node:fs";
import path from "node:path";

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
  const dictation = new DictationService(cfg.dictationDir, cfg.voxtypeBin ?? "voxtype", events);
  const approvals = new ApprovalsService(db, events);
  const workersDir = process.env.OMARCHY_BOT_WORKERS_DIR ?? path.resolve(import.meta.dir, "../../../../workers");
  const agentsDir = path.resolve(workersDir);
  const supervisor = new Supervisor(
    {
      onAgentEvent: (agentId, event) => {
        if (!avatars.onAgentEvent(agentId, event)) turns.onAgentEvent(agentId, event);
      },
      onWorkerCrash: (agentId, err) => events.append("bot", agentId, "agent.worker_crash", { agentId, message: err.message }),
    },
    {
      agents: agentsDir,
      computer: path.resolve(agentsDir, "computer"),
    },
  );
  const agents = new AgentsRegistry(db, events, { conformanceDir: cfg.conformanceDir, workersAgentsDir: agentsDir }, supervisor);
  const bots = new BotsService(db, events, agents, threads);
  const avatars = new AvatarService(bots, supervisor, cfg.avatarsDir);
  const turns = new TurnService(db, events, threads, approvals, agents, bots, supervisor, { turnTimeoutMs: cfg.turnTimeoutMs });
  const computer = new ComputerBroker(db, events, turns, supervisor, cfg);

  agents.init();

  // Recheck every agent in the background: probe + conformance gate.
  for (const a of agents.list()) {
    void agents.recheck(a.id).catch(() => {});
  }

  const svc: DaemonServices = { cfg, db, events, agents, bots, threads, turns, approvals, avatars, dictation, computer, supervisor };
  const http = startHttp(svc);

  // Periodic status file for the future bar widget (decoupled pattern from research.md §3).
  const statusTimer = setInterval(() => {
    try {
      writeStatusAtomic(cfg.statusPath, {
        ts: new Date().toISOString(),
        agents: agents.list().map((a) => ({ id: a.id, status: a.status })),
        approvals: approvals.listPending().length,
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
    // Safe shutdown order: stop new work before revoking shared resources.
    clearInterval(statusTimer);
    approvals.failClosedAll(); // pending approvals resolve as unavailable
    await dictation.shutdown();
    computer.emergencyStop(); // revoke leases, stop input (also parks turns)
    await supervisor.stopAll(); // close workers
    http.stop(); // close listeners
    db.close(); // flush WAL
    console.log("omarchy-bot daemon stopped");
  };

  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());

  return { stop, port: http.port, svc };
}

if (import.meta.main) {
  void main();
}
