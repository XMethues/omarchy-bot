import type { SurfaceId } from "@omarchy-bot/domain";
import { loadConfig } from "./config.ts";
import { openDb, recoverOnStartup } from "../persistence/db.ts";
import { EventLog } from "../modules/events/eventLog.ts";
import { ThreadsService } from "../modules/threads/threads.ts";
import { AgentsRegistry } from "../modules/agents/registry.ts";
import { BotsService } from "../modules/bots/bots.ts";
import { BotDeletionService } from "../modules/bots/botDeletion.ts";
import { TurnService } from "../modules/turns/turns.ts";
import { ComputerBroker } from "../modules/computer/broker.ts";
import { BotScreenManager, type BotScreenRuntimeAdapter } from "../modules/computer/botScreenManager.ts";
import { HyprlandBotScreenRuntimeAdapter } from "../modules/computer/hyprlandBotScreenRuntime.ts";
import { ScreenProjectionService } from "../modules/computer/screenProjection.ts";
import { InputDiagnostics } from "../modules/computer/inputDiagnostics.ts";
import { AvatarService } from "../modules/avatars/avatarService.ts";
import { DictationService } from "../modules/dictation/dictationService.ts";
import { AttachmentsService } from "../modules/attachments/attachments.ts";
import { Supervisor } from "../supervision/supervisor.ts";
import { startHttp, type DaemonServices } from "../api/http.ts";
import { writeFileSync, renameSync } from "node:fs";
import path from "node:path";

function writeStatusAtomic(statusPath: string, data: unknown): void {
  const tmp = `${statusPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, statusPath);
}

export interface MainOptions {
  botScreenAdapter?: BotScreenRuntimeAdapter;
}

export async function main(options: MainOptions = {}): Promise<{ stop: () => Promise<void>; port: number; svc: DaemonServices }> {
  const cfg = loadConfig();
  const db = openDb(cfg);
  recoverOnStartup(db); // leases never survive a restart as bot-held
  const runtimeDir = process.env.XDG_RUNTIME_DIR;
  const hostWaylandDisplay = process.env.WAYLAND_DISPLAY;
  const workersDir = process.env.OMARCHY_BOT_WORKERS_DIR ?? path.resolve(import.meta.dir, "../../../../workers");
  const agentsDir = path.resolve(workersDir);
  const supervisor: Supervisor = new Supervisor(
    {
      onAgentEvent: (agentId, event) => {
        if (!avatars.onAgentEvent(agentId, event)) turns.onAgentEvent(agentId, event);
      },
      onWorkerCrash: (agentId, err) => {
        events.append("agent", agentId, "agent.worker_crash", { agentId, message: err.message });
        agents.markOffline(agentId, err.message);
        turns.onAgentWorkerCrash(agentId, err);
      },
      onAgentComputerRequest: (agentId, request, signal) =>
        turns.onAgentComputerRequest(agentId, request, computer, signal),
    },
    {
      agents: agentsDir,
      computer: process.env.OMARCHY_BOT_COMPUTER_WORKER_DIR ?? path.resolve(agentsDir, "computer"),
    },
  );
  const productionScreenAdapter = new HyprlandBotScreenRuntimeAdapter({
    runtimeRoot: cfg.botScreenRuntimeDir,
    profileRoot: cfg.botScreenProfileDir,
    computerWorkers: supervisor,
    ...(runtimeDir === undefined ? {} : { hostRuntimeDir: runtimeDir }),
    ...(hostWaylandDisplay === undefined ? {} : { hostWaylandDisplay }),
    ...(process.env.OMARCHY_BOT_HYPRLAND_BIN === undefined
      ? {}
      : { hyprlandBin: process.env.OMARCHY_BOT_HYPRLAND_BIN }),
    ...(process.env.OMARCHY_BOT_HYPRCTL_BIN === undefined
      ? {}
      : { hyprctlBin: process.env.OMARCHY_BOT_HYPRCTL_BIN }),
    ...(process.env.OMARCHY_BOT_GRIM_BIN === undefined
      ? {}
      : { grimBin: process.env.OMARCHY_BOT_GRIM_BIN }),
    ...(process.env.OMARCHY_BOT_SCREEN_APP_BIN === undefined
      ? {}
      : { applicationBin: process.env.OMARCHY_BOT_SCREEN_APP_BIN }),
  });
  const screens = new BotScreenManager(db, options.botScreenAdapter ?? productionScreenAdapter);
  const projections = new ScreenProjectionService(screens, new InputDiagnostics(db));

  const events = new EventLog(db);
  events.subscribe((event) => {
    if (event.aggregateType !== "bot" || (event.type !== "bot.archived" && event.type !== "bot.deleted")) return;
    const payload = event.payload as { surfaceId?: unknown } | undefined;
    if (typeof payload?.surfaceId === "string") {
      projections.closeSurface(payload.surfaceId as SurfaceId);
      void screens.stop(payload.surfaceId as SurfaceId);
    }
  });
  const dictation = new DictationService(cfg.dictationDir, cfg.voxtypeBin ?? "voxtype", events);
  const agents: AgentsRegistry = new AgentsRegistry(db, events, { conformanceDir: cfg.conformanceDir, workersAgentsDir: agentsDir }, supervisor);
  const threads: ThreadsService = new ThreadsService(db, events, agents);
  const bots = new BotsService(db, events, agents, threads);
  const attachments = new AttachmentsService(db, cfg.attachmentsDir, agents);
  attachments.gcStaged();
  const avatars = new AvatarService(bots, supervisor, cfg.avatarsDir);
  const botDeletions = new BotDeletionService(db, events, attachments, avatars, agents, supervisor);
  const turns: TurnService = new TurnService(db, events, threads, agents, bots, attachments, supervisor, cfg);
  const computer = new ComputerBroker(db, events, turns, screens, cfg);

  agents.init();

  // Recheck every agent in the background: probe + conformance gate.
  for (const a of agents.list()) {
    void agents.recheck(a.id).catch(() => {});
  }

  const svc: DaemonServices = {
    cfg,
    db,
    events,
    agents,
    bots,
    botDeletions,
    threads,
    turns,
    avatars,
    attachments,
    dictation,
    computer,
    screens,
    projections,
    supervisor,
  };
  const http = startHttp(svc);

  // Periodic status file for the future bar widget (decoupled pattern from research.md §3).
  const statusTimer = setInterval(() => {
    try {
      writeStatusAtomic(cfg.statusPath, {
        ts: new Date().toISOString(),
        agents: agents.list().map((a) => ({ id: a.id, status: a.status })),
        computer: computer.states(),
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
    await dictation.shutdown();
    computer.shutdown();
    await projections.shutdown();
    await screens.shutdown();
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
