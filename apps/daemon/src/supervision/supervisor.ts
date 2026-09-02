import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentEvent, ComputerCommand } from "@omarchy-bot/agent-contract";
import type { AgentId } from "@omarchy-bot/domain";
import { WorkerClient, sanitizedEnv } from "./workerClient.ts";

export interface SupervisorHooks {
  onAgentEvent: (agentId: AgentId, event: AgentEvent) => void;
  onWorkerCrash: (agentId: AgentId, error: Error) => void;
}

/**
 * Starts agent workers on demand per Agent (one worker per Agent, shared by
 * all its Bots), restarts them with bounded backoff, and owns the single
 * computer worker.
 */
export class Supervisor {
  #agentWorkers = new Map<AgentId, WorkerClient>();
  #computerWorker?: WorkerClient;
  #restartTimers = new Map<AgentId, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly hooks: SupervisorHooks,
    private readonly workerDirs: { agents: string; computer: string },
  ) {}

  get agentsDir(): string {
    return this.workerDirs.agents;
  }

  async agentWorker(agentId: AgentId): Promise<WorkerClient> {
    let w = this.#agentWorkers.get(agentId);
    if (w?.alive) return w;
    if (w) await this.#killQuietly(w);
    w = new WorkerClient({
      name: `agent:${agentId}`,
      script: path.join(this.workerDirs.agents, agentId, "src", "worker.ts"),
      env: sanitizedEnv(),
      onEvent: (e) => this.hooks.onAgentEvent(agentId, e),
      onExit: () => {
        // Restart with backoff unless it was an explicit stop; sessions get recovered by callers.
        if (!this.#restartTimers.has(agentId)) {
          const t = setTimeout(() => {
            this.#restartTimers.delete(agentId);
            void this.agentWorker(agentId).catch((err) => this.hooks.onWorkerCrash(agentId, err));
          }, 1000);
          this.#restartTimers.set(agentId, t);
        }
      },
    });
    this.#agentWorkers.set(agentId, w);
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

  computerCommand(cmd: Omit<Extract<ComputerCommand, { type: "act" }>, "requestId">, timeoutMs: number): Promise<unknown> {
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
