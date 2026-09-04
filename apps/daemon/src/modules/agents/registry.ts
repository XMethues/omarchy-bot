import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Database } from "bun:sqlite";
import { AGENT_IDS, type AgentId, type AgentStatus } from "@omarchy-bot/domain";
import type { AgentDto } from "@omarchy-bot/protocol";
import {
  isAgentCapabilityInventory,
  type AgentCapabilityInventory,
} from "@omarchy-bot/agent-contract";
import type { EventLog } from "../events/eventLog.ts";
import type { Supervisor } from "../../supervision/supervisor.ts";

const DISPLAY_NAMES: Record<AgentId, string> = {
  pi: "Pi", omp: "OMP", codex: "Codex", claude: "Claude", grok: "Grok",
  opencode: "OpenCode", gemini: "Gemini", copilot: "Copilot", crush: "Crush",
};

interface AgentRow { id: string; display_name: string; agent_version: string; status: string; reason: string | null; updated_at: string }

/**
 * AgentRegistry: installation/version/readiness per supported Agent backend.
 * `ready` requires a conformance record for the running agent version — never
 * just a presence check. Bots reference Agents; Agents are never Bots.
 */
export class AgentsRegistry {
  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly cfg: { conformanceDir: string; workersAgentsDir: string },
    private readonly supervisor: Supervisor,
  ) {}

  readonly #capabilityInventories = new Map<AgentId, AgentCapabilityInventory>();
  readonly #recheckGenerations = new Map<AgentId, number>();

  init(): void {
    const now = new Date().toISOString();
    for (const id of AGENT_IDS) {
      const existing = this.db.query(`SELECT id FROM agents WHERE id = ?`).get(id);
      if (existing) continue;
      this.db
        .query(`INSERT INTO agents (id, display_name, updated_at) VALUES (?, ?, ?)`)
        .run(id, DISPLAY_NAMES[id], now);
    }
    // Readiness is process-local because the exact inventory comes from the
    // currently running adapter probe. Never publish a persisted ready status
    // without that required v2 inventory.
    for (const id of AGENT_IDS) {
      const row = this.#row(id);
      if (this.#adapterPresent(id)) {
        if (row.status === "ready") this.#setStatus(id, "checking");
        continue;
      }
      if (row.status !== "missing") {
        this.#setStatus(id, "missing", "adapter not installed in this build");
      }
    }
  }

  #adapterPresent(id: AgentId): boolean {
    return existsSync(path.join(this.cfg.workersAgentsDir, id, "src", "worker.ts"));
  }

  #row(id: string): AgentRow {
    return this.db.query(`SELECT * FROM agents WHERE id = ?`).get(id) as AgentRow;
  }

  #setStatus(id: AgentId, status: AgentStatus, reason?: string, agentVersion?: string): void {
    if (status !== "ready") this.#capabilityInventories.delete(id);
    this.db
      .query(`UPDATE agents SET status = ?, reason = ?, agent_version = COALESCE(?, agent_version), updated_at = ? WHERE id = ?`)
      .run(status, reason ?? null, agentVersion ?? null, new Date().toISOString(), id);
    this.events.append("agent", id, "agent.status", { agentId: id, status, ...(reason !== undefined ? { reason } : {}) });
  }

  toDto(row: AgentRow): AgentDto {
    const id = row.id as AgentId;
    const status = row.status as AgentStatus;
    const guidance = this.guidance(id, status);
    const capabilities = status === "ready" ? this.#capabilityInventories.get(id) : undefined;
    return {
      id,
      displayName: row.display_name,
      version: row.agent_version,
      status,
      ...(row.reason !== null ? { reason: row.reason } : {}),
      ...(guidance !== undefined ? { guidance } : {}),
      ...(capabilities !== undefined ? { capabilities } : {}),
    };
  }

  /** Plain-language setup guidance for the creation Sheet when not ready. */
  guidance(id: AgentId, status: AgentStatus): string | undefined {
    switch (status) {
      case "ready":
      case "checking":
        return undefined;
      case "missing":
        return `${DISPLAY_NAMES[id]} is not available: no adapter is installed in this Omarchy Bot build yet.`;
      case "unconfigured":
        return `${DISPLAY_NAMES[id]} is installed but has not passed conformance for its current version. Run the conformance suite once.`;
      case "incompatible":
        return `${DISPLAY_NAMES[id]} failed its readiness probe. Check the agent's own setup (login/auth) and recheck.`;
      case "offline":
        return `${DISPLAY_NAMES[id]} did not respond. Restart the daemon or check the worker logs.`;
    }
  }

  list(): AgentDto[] {
    const rows = this.db.query(`SELECT * FROM agents ORDER BY id ASC`).all() as AgentRow[];
    return rows.map((r) => this.toDto(r));
  }

  get(id: AgentId): AgentDto | undefined {
    const r = this.db.query(`SELECT * FROM agents WHERE id = ?`).get(id) as AgentRow | undefined;
    return r ? this.toDto(r) : undefined;
  }

  status(id: AgentId): AgentStatus {
    return (this.#row(id).status ?? "missing") as AgentStatus;
  }

  isReady(id: AgentId): boolean {
    return this.status(id) === "ready";
  }

  markOffline(id: AgentId, reason: string): void {
    this.#recheckGenerations.set(id, (this.#recheckGenerations.get(id) ?? 0) + 1);
    this.#setStatus(id, "offline", reason);
  }

  capabilityInventory(id: AgentId): AgentCapabilityInventory | undefined {
    return this.isReady(id) ? this.#capabilityInventories.get(id) : undefined;
  }

  conformanceRecord(agentId: string, version: string): { ok: boolean; reason?: string } | undefined {
    const file = path.join(this.cfg.conformanceDir, `${agentId}-${version}.json`);
    if (!existsSync(file)) return undefined;
    try {
      return JSON.parse(readFileSync(file, "utf8"));
    } catch {
      return undefined;
    }
  }

  /** Async probe + conformance gate. Called at boot and on demand. */
  async recheck(id: AgentId): Promise<AgentDto> {
    const generation = (this.#recheckGenerations.get(id) ?? 0) + 1;
    this.#recheckGenerations.set(id, generation);
    const wasReady = this.isReady(id);
    if (!wasReady) {
      this.#setStatus(id, "checking");
    }
    const isCurrent = (): boolean => this.#recheckGenerations.get(id) === generation;
    if (!this.#adapterPresent(id)) {
      if (isCurrent()) this.#setStatus(id, "missing", "adapter not installed in this build");
      return this.get(id)!;
    }
    try {
      const w = await this.supervisor.agentWorker(id);
      const probe = await w.request({ type: "probe" }, 30_000);
      if (!isCurrent()) return this.get(id)!;
      if (!isAgentCapabilityInventory(probe?.capabilities)) {
        this.#setStatus(id, "incompatible", "agent probe returned an invalid capability inventory", probe?.agentVersion);
        return this.get(id)!;
      }
      if (!probe?.installed || !probe?.sdkOk) {
        this.#setStatus(id, "incompatible", probe?.reason ?? "probe failed", probe?.agentVersion);
        return this.get(id)!;
      }
      const record = this.conformanceRecord(id, probe.agentVersion);
      if (!record) {
        this.#setStatus(id, "unconfigured", `conformance pending for ${probe.agentVersion} — run tests/conformance`, probe.agentVersion);
        return this.get(id)!;
      }
      if (!record.ok) {
        this.#setStatus(id, "incompatible", record.reason ?? "conformance failed", probe.agentVersion);
        return this.get(id)!;
      }
      this.#capabilityInventories.set(id, probe.capabilities);
      this.#setStatus(id, "ready", undefined, probe.agentVersion);
    } catch (error) {
      if (isCurrent()) {
        const reason = error instanceof Error ? error.message : String(error);
        this.#setStatus(id, "offline", reason);
      }
    }
    return this.get(id)!;
  }
}
