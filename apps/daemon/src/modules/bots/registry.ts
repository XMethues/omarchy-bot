import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Database } from "bun:sqlite";
import { AGENT_IDS, type AgentId, type BotStatus } from "@omarchy-bot/domain";
import type { BotDto } from "@omarchy-bot/protocol";
import type { EventLog } from "../events/eventLog.ts";
import type { Supervisor } from "../../supervision/supervisor.ts";

const DISPLAY_NAMES: Record<AgentId, string> = {
  pi: "Pi", omp: "OMP", codex: "Codex", claude: "Claude", grok: "Grok",
  opencode: "OpenCode", gemini: "Gemini", copilot: "Copilot", crush: "Crush",
};

interface BotRow { id: string; display_name: string; agent_version: string; status: string; default_cwd: string; default_model: string | null; permission_policy: string; enabled: number; reason: string | null; created_at: string; updated_at: string }

/**
 * BotRegistry: installation/version/readiness per Agent. `ready` requires a
 * conformance record for the running agent version — never just `command -v`.
 */
export class BotRegistry {
  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly cfg: { conformanceDir: string },
    private readonly supervisor: Supervisor,
    private readonly defaultAgent: AgentId,
  ) {}

  init(): void {
    const now = new Date().toISOString();
    for (const id of AGENT_IDS) {
      const existing = this.db.query(`SELECT id FROM bots WHERE id = ?`).get(id);
      if (existing) continue;
      this.db
        .query(`INSERT INTO bots (id, display_name, default_cwd, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(id, DISPLAY_NAMES[id], "", id === this.defaultAgent ? 1 : 0, now, now);
    }
    this.#refreshPresence();
  }

  /** Cheap presence check for all nine; probe via worker only when enabled. */
  #refreshPresence(): void {
    for (const id of AGENT_IDS) {
      const row = this.#row(id);
      if (row.enabled) continue; // enabled bots get probe-based status
      const installed = Bun.which(id) !== null;
      const status: BotStatus = installed ? "unconfigured" : "missing";
      if (row.status !== status) this.#setStatus(id, status, installed ? undefined : "CLI not found on PATH");
    }
  }

  #row(id: string): BotRow {
    return this.db.query(`SELECT * FROM bots WHERE id = ?`).get(id) as BotRow;
  }

  #setStatus(id: string, status: BotStatus, reason?: string, agentVersion?: string): void {
    this.db
      .query(`UPDATE bots SET status = ?, reason = ?, agent_version = COALESCE(?, agent_version), updated_at = ? WHERE id = ?`)
      .run(status, reason ?? null, agentVersion ?? null, new Date().toISOString(), id);
    this.events.append("bot", id, "bot.status", { status, reason: reason ?? null, agentVersion: agentVersion ?? null });
  }

  list(): BotDto[] {
    const rows = this.db.query(`SELECT * FROM bots ORDER BY enabled DESC, id ASC`).all() as BotRow[];
    // Legacy ordering until Agent records and user-created Bots are separated.
    rows.sort((a, b) => Number(b.enabled) - Number(a.enabled) || (a.id === this.defaultAgent ? -1 : b.id === this.defaultAgent ? 1 : a.id.localeCompare(b.id)));
    return rows.map((r) => ({
      id: r.id, displayName: r.display_name, agentVersion: r.agent_version, status: r.status,
      defaultCwd: r.default_cwd, defaultModel: r.default_model ?? undefined,
      permissionPolicy: r.permission_policy as "ask", enabled: Boolean(r.enabled), reason: r.reason ?? undefined,
    }));
  }

  get(id: string): BotDto {
    return this.list().find((b) => b.id === id)!;
  }

  isEnabled(id: string): boolean {
    return Boolean(this.#row(id).enabled);
  }

  setEnabled(id: string, enabled: boolean): void {
    this.db.query(`UPDATE bots SET enabled = ?, updated_at = ? WHERE id = ?`).run(enabled ? 1 : 0, new Date().toISOString(), id);
    if (!enabled) this.#setStatus(id, "offline");
    this.events.append("bot", id, "bot.enabled", { enabled });
  }

  setPolicy(id: string, policy: "ask" | "trusted"): void {
    this.db.query(`UPDATE bots SET permission_policy = ?, updated_at = ? WHERE id = ?`).run(policy, new Date().toISOString(), id);
    this.events.append("bot", id, "bot.policy", { policy });
  }

  policy(id: string): "ask" | "trusted" {
    return this.#row(id).permission_policy as "ask" | "trusted";
  }

  defaultCwd(id: string): string {
    return this.#row(id).default_cwd || process.cwd();
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

  /** Async probe + conformance gate. Called on recheck or after enabling. */
  async recheck(id: string): Promise<BotDto> {
    const row = this.#row(id);
    this.#setStatus(id, "checking");
    const installed = Bun.which(id) !== null;
    if (!installed) {
      this.#setStatus(id, "missing", "CLI not found on PATH");
      return this.get(id);
    }
    try {
      const w = await this.supervisor.agentWorker(id);
      const probe = await w.request({ type: "probe" }, 30_000);
      if (!probe?.installed || !probe?.sdkOk) {
        this.#setStatus(id, "incompatible", probe?.reason ?? "probe failed", probe?.agentVersion);
        return this.get(id);
      }
      const record = this.conformanceRecord(id, probe.agentVersion);
      if (!record) {
        this.#setStatus(id, "unconfigured", `conformance pending for ${probe.agentVersion} — run tests/conformance`, probe.agentVersion);
        return this.get(id);
      }
      if (!record.ok) {
        this.#setStatus(id, "incompatible", record.reason ?? "conformance failed", probe.agentVersion);
        return this.get(id);
      }
      this.#setStatus(id, "ready", undefined, probe.agentVersion);
    } catch (err) {
      this.#setStatus(id, "offline", String((err as Error).message));
    }
    return this.get(id);
  }
}
