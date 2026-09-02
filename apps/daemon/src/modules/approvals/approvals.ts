import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ApprovalDto, EventEnvelope } from "@omarchy-bot/protocol";
import type { EventLog } from "../events/eventLog.ts";

interface ApprovalRow { id: string; turn_id: string | null; worker_session_id: string | null; tool: string; details: string | null; status: string; created_at: string; decided_at: string | null }

export interface PendingWaiter {
  approvalId: string;
  resolve: (allowed: boolean) => void;
}

/**
 * Pass-through for Agent-native approvals (ADR 0003): the daemon records the
 * adapter's own permission requests and forwards user decisions. There is NO
 * omarchy-bot policy layer — fail closed: timeouts, shutdown and crashes all
 * resolve as not-granted.
 */
export class ApprovalsService {
  #waiters = new Map<string, PendingWaiter>();

  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
  ) {}

  create(input: { tool: string; details: unknown; turnId?: string; workerSessionId?: string; timeoutMs: number; threadId?: string }): ApprovalDto {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .query(`INSERT INTO approvals (id, turn_id, worker_session_id, tool, details, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?)`)
      .run(id, input.turnId ?? null, input.workerSessionId ?? null, input.tool, JSON.stringify(input.details ?? null), now);
    const dto = this.get(id)!;
    this.events.append("approval", id, "approval.requested", { ...dto, threadId: input.threadId });
    const timer = setTimeout(() => this.expire(id), input.timeoutMs);
    timer.unref?.();
    return dto;
  }

  /** Resolve via a waiter registered by the module that will forward the decision. */
  registerWaiter(approvalId: string, resolve: (allowed: boolean) => void): void {
    this.#waiters.set(approvalId, { approvalId, resolve });
  }

  respond(approvalId: string, decision: { decision: boolean; note?: string }): ApprovalDto | undefined {
    const row = this.get(approvalId);
    if (!row || row.status !== "pending") return row;
    const now = new Date().toISOString();
    this.db.query(`UPDATE approvals SET status = ?, decided_at = ? WHERE id = ?`).run(decision.decision ? "allowed" : "denied", now, approvalId);
    this.events.append("approval", approvalId, "approval.decided", { approvalId, ...decision });
    this.#waiters.get(approvalId)?.resolve(decision.decision);
    this.#waiters.delete(approvalId);
    return this.get(approvalId);
  }

  expire(approvalId: string): void {
    const row = this.get(approvalId);
    if (!row || row.status !== "pending") return;
    this.db.query(`UPDATE approvals SET status = 'expired', decided_at = ? WHERE id = ?`).run(new Date().toISOString(), approvalId);
    this.events.append("approval", approvalId, "approval.expired", { approvalId });
    this.#waiters.get(approvalId)?.resolve(false);
    this.#waiters.delete(approvalId);
  }

  get(id: string): ApprovalDto | undefined {
    const r = this.db.query(`SELECT * FROM approvals WHERE id = ?`).get(id) as ApprovalRow | undefined;
    if (!r) return undefined;
    return {
      id: r.id,
      ...(r.turn_id !== null ? { turnId: r.turn_id } : {}),
      tool: r.tool,
      ...(r.details !== null ? { details: JSON.parse(r.details) } : {}),
      status: r.status as ApprovalDto["status"],
      createdAt: r.created_at,
    };
  }

  listPending(): ApprovalDto[] {
    const rows = this.db.query(`SELECT id FROM approvals WHERE status = 'pending' ORDER BY created_at ASC`).all() as { id: string }[];
    return rows.map((r) => this.get(r.id)!).filter(Boolean);
  }

  list(): ApprovalDto[] {
    const rows = this.db.query(`SELECT id FROM approvals ORDER BY created_at DESC LIMIT 200`).all() as { id: string }[];
    return rows.map((r) => this.get(r.id)!).filter(Boolean);
  }

  /** Shutdown step: pending approvals resolve as unavailable. */
  failClosedAll(): void {
    for (const a of this.listPending()) this.expire(a.id);
  }
}

export type { EventEnvelope };
