import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentEvent } from "@omarchy-bot/agent-contract";
import type { ComputerAction } from "@omarchy-bot/domain";
import { WorkerClient, sanitizedEnv } from "./workerClient.ts";

export interface SupervisorHooks {
  onAgentEvent: (botId: string, event: AgentEvent) => void;
  onWorkerCrash: (botId: string, error: Error) => void;
}

/**
 * Starts agent workers on demand (never nine resident workers), restarts them
 * with bounded backoff, and owns the single computer worker.
 */
export class Supervisor {
  #agentWorkers = new Map<string, WorkerClient>();
  #computerWorker?: WorkerClient;
  #restartTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly hooks: SupervisorHooks,
    private readonly workerDirs: { agents: string; computer: string },
  ) {}

  async agentWorker(botId: string): Promise<WorkerClient> {
    let w = this.#agentWorkers.get(botId);
    if (w?.alive) return w;
    if (w) await this.#killQuietly(w);
    w = new WorkerClient({
      name: `agent:${botId}`,
      script: path.join(this.workerDirs.agents, botId, "src", "worker.ts"),
      env: sanitizedEnv(),
      onEvent: (e) => this.hooks.onAgentEvent(botId, e),
      onExit: () => {
        // Restart with backoff unless it was an explicit stop; sessions get recovered by callers.
        if (!this.#restartTimers.has(botId)) {
          const t = setTimeout(() => {
            this.#restartTimers.delete(botId);
            void this.agentWorker(botId).catch((err) => this.hooks.onWorkerCrash(botId, err));
          }, 1000);
          this.#restartTimers.set(botId, t);
        }
      },
    });
    this.#agentWorkers.set(botId, w);
    await w.start();
    return w;
  }

  async computerWorker(): Promise<WorkerClient> {
    let w = this.#computerWorker;
    if (w?.alive) return w;
    w = new WorkerClient({
      name: "computer",
      script: path.join(this.workerDirs.computer, "src", "worker.ts"),
      env: { ...sanitizedEnv(), WAYLAND_DISPLAY: process.env.WAYLAND_DISPLAY ?? "wayland-1", XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid?.() ?? 1000}` },
      onEvent: () => {},
    });
    this.#computerWorker = w;
    await w.start();
    return w;
  }

  computerCommand(cmd: { type: "probe" } | { type: "act"; action: ComputerAction; lease?: { holder: import("@omarchy-bot/domain").ActorRef | "human"; runId?: string; token: string } } | { type: "shutdown" }, timeoutMs: number): Promise<any> {
    return this.computerWorker().then((w) => w.request({ ...cmd, requestId: randomUUID() }, timeoutMs));
  }

  async stopAll(): Promise<void> {
    for (const [, t] of this.#restartTimers) clearTimeout(t);
    this.#restartTimers.clear();
    await Promise.allSettled([...this.#agentWorkers.values(), ...(this.#computerWorker ? [this.#computerWorker] : [])].map((w) => w.stop()));
  }

  async #killQuietly(w: WorkerClient): Promise<void> {
    await w.stop().catch(() => {});
  }
}
