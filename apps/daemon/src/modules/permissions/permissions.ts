import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ApprovalDto, EventEnvelope } from "@omarchy-bot/protocol";
import type { EventLog } from "../events/eventLog.ts";

interface PermRow { id: string; source: string; run_id: string | null; worker_session_id: string | null; tool: string; details: string | null; status: string; created_at: string; decided_at: string | null }

export interface PendingWaiter {
  permissionId: string;
  resolve: (allowed: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Agent tool approvals + Computer approvals, fail closed: timeouts, shutdown
 * and crashes all resolve as not-granted. Two layers never share a decision.
 */
export class PermissionsService {
  #waiters = new Map<string, PendingWaiter>();
  #deciders = new Map<string, (allowed: boolean) => void>();

  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
  ) {}

  create(input: { source: "agent" | "computer"; tool: string; details: unknown; runId?: string; workerSessionId?: string; timeoutMs: number; threadId?: string }): ApprovalDto {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .query(`INSERT INTO permissions (id, source, run_id, worker_session_id, tool, details, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`)
      .run(id, input.source, input.runId ?? null, input.workerSessionId ?? null, input.tool, JSON.stringify(input.details ?? null), now);
    const dto = this.get(id)!;
    this.events.append("thread", input.threadId ?? "global", "permission.requested", dto);
    const timer = setTimeout(() => this.expire(id), input.timeoutMs);
    timer.unref?.();
    return dto;
  }

  /** Resolve via a waiter registered by the module that will forward the decision. */
  registerWaiter(permissionId: string, resolve: (allowed: boolean) => void): void {
    this.#waiters.set(permissionId, { permissionId, resolve, timer: setTimeout(() => {}, 60_000) });
  }

  respond(permissionId: string, decision: { decision: boolean; note?: string }): ApprovalDto | undefined {
    const row = this.get(permissionId);
    if (!row || row.status !== "pending") return row;
    const now = new Date().toISOString();
    this.db.query(`UPDATE permissions SET status = ?, decided_at = ? WHERE id = ?`).run(decision.decision ? "allowed" : "denied", now, permissionId);
    this.events.append("thread", "global", "permission.decided", { permissionId, ...decision });
    this.#waiters.get(permissionId)?.resolve(decision.decision);
    this.#waiters.delete(permissionId);
    return this.get(permissionId);
  }

  expire(permissionId: string): void {
    const row = this.get(permissionId);
    if (!row || row.status !== "pending") return;
    this.db.query(`UPDATE permissions SET status = 'expired', decided_at = ? WHERE id = ?`).run(new Date().toISOString(), permissionId);
    this.events.append("thread", "global", "permission.expired", { permissionId });
    this.#waiters.get(permissionId)?.resolve(false);
    this.#waiters.delete(permissionId);
  }

  get(id: string): ApprovalDto | undefined {
    const r = this.db.query(`SELECT * FROM permissions WHERE id = ?`).get(id) as PermRow | undefined;
    if (!r) return undefined;
    return {
      id: r.id, source: r.source as "agent", runId: r.run_id ?? undefined, tool: r.tool,
      details: r.details ? JSON.parse(r.details) : undefined,
      status: r.status as ApprovalDto["status"], createdAt: r.created_at,
    };
  }

  listPending(): ApprovalDto[] {
    const rows = this.db.query(`SELECT id FROM permissions WHERE status = 'pending' ORDER BY created_at ASC`).all() as { id: string }[];
    return rows.map((r) => this.get(r.id)!).filter(Boolean);
  }

  list(): ApprovalDto[] {
    const rows = this.db.query(`SELECT id FROM permissions ORDER BY created_at DESC LIMIT 200`).all() as { id: string }[];
    return rows.map((r) => this.get(r.id)!).filter(Boolean);
  }

  /** Shutdown order step 4: pending approvals resolve as unavailable. */
  failClosedAll(): void {
    for (const p of this.listPending()) this.expire(p.id);
  }
}
