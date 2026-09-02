import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "bun:sqlite";
import type { ActorRef, AgentId, ComputerAction } from "@omarchy-bot/domain";
import { isInputAction, isSensitiveAction } from "@omarchy-bot/domain";
import type { EventLog } from "../events/eventLog.ts";
import type { PermissionsService } from "../permissions/permissions.ts";
import type { TaskRunner } from "../tasks/runner.ts";
import type { Supervisor } from "../../supervision/supervisor.ts";
import type { Config } from "../../bootstrap/config.ts";

interface LeaseRow { holder_is_human: number; holder_bot_id: string | null; holder_role_id: string | null; run_id: string | null; token: string; acquired_at: string; expires_at: string }

/**
 * ComputerBroker: the only grantor/revoker of the exclusive input lease and
 * the only path from agents to the desktop. Observation is never lease-gated;
 * every input action is audited; sensitive actions need Action needed even
 * under `trusted`; all failures are fail closed.
 */
export class ComputerBroker {
  #queue: { actor: ActorRef; runId?: string }[] = [];
  #emergencyStopped = false;
  #lastSnapshotAt = 0;
  #snapshotCache?: { mediaType: string; bytes: Uint8Array };
  #lastImageAt?: string;

  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly permissions: PermissionsService,
    private readonly supervisor: Supervisor,
    private readonly runner: TaskRunner,
    private readonly cfg: Config,
  ) {}

  #lease(): LeaseRow | undefined {
    // bun:sqlite .get() returns null (not undefined) for no rows.
    return (this.db.query(`SELECT * FROM computer_leases WHERE id = 1`).get() ?? undefined) as LeaseRow | undefined;
  }

  #writeLease(l: LeaseRow | undefined): void {
    if (!l) {
      this.db.query(`DELETE FROM computer_leases WHERE id = 1`).run();
      return;
    }
    this.db
      .query(`INSERT INTO computer_leases (id, holder_is_human, holder_bot_id, holder_role_id, run_id, token, acquired_at, expires_at)
              VALUES (1, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET holder_is_human=excluded.holder_is_human, holder_bot_id=excluded.holder_bot_id,
                holder_role_id=excluded.holder_role_id, run_id=excluded.run_id, token=excluded.token,
                acquired_at=excluded.acquired_at, expires_at=excluded.expires_at`)
      .run(l.holder_is_human, l.holder_bot_id, l.holder_role_id, l.run_id, l.token, l.acquired_at, l.expires_at);
  }

  #leaseMatchesActor(l: LeaseRow, actor: ActorRef, runId?: string): boolean {
    if (l.holder_is_human) return false;
    return l.holder_bot_id === actor.botId && l.holder_role_id === actor.roleId && (runId === undefined || l.run_id === runId);
  }

  state(): { lease: { holder: ActorRef | "human"; runId?: string; acquiredAt: string; expiresAt: string } | null; queueDepth: number; emergencyStopped: boolean; lastImageAt?: string } {
    const l = this.#lease();
    return {
      lease: l
        ? {
            holder: l.holder_is_human ? ("human" as const) : { botId: l.holder_bot_id as AgentId, roleId: l.holder_role_id! },
            ...(l.run_id !== null ? { runId: l.run_id } : {}),
            acquiredAt: l.acquired_at,
            expiresAt: l.expires_at,
          }
        : null,
      queueDepth: this.#queue.length,
      emergencyStopped: this.#emergencyStopped,
      ...(this.#lastImageAt !== undefined ? { lastImageAt: this.#lastImageAt } : {}),
    };
  }

  /** Bot requests the exclusive input lease. Queues as waiting_for_computer when held. */
  async acquire(actor: ActorRef, runId: string | undefined, ttlMs = this.cfg.leaseTtlMs): Promise<{ granted: boolean; token?: string; queued: boolean }> {
    if (this.#emergencyStopped) return { granted: false, queued: false };
    const l = this.#lease();
    const expired = l !== undefined && new Date(l.expires_at).getTime() <= Date.now();
    if (l === undefined || expired) {
      const token = randomUUID();
      const now = new Date();
      this.#writeLease({
        holder_is_human: 0, holder_bot_id: actor.botId, holder_role_id: actor.roleId, run_id: runId ?? null,
        token, acquired_at: now.toISOString(), expires_at: new Date(now.getTime() + ttlMs).toISOString(),
      });
      this.events.append("computer", "lease", "computer.lease.granted", { holder: actor, runId, expiresAt: ttlMs });
      return { granted: true, token, queued: false };
    }
    if (this.#leaseMatchesActor(l, actor, runId)) return { granted: true, token: l.token, queued: false };
    if (!this.#queue.some((q) => q.actor.botId === actor.botId && q.actor.roleId === actor.roleId && q.runId === runId)) {
      this.#queue.push({ actor, ...(runId !== undefined ? { runId } : {}) });
      this.events.append("computer", "lease", "computer.lease.queued", { holder: actor, runId: runId ?? null, depth: this.#queue.length });
      if (runId) this.runner.parkForComputer(runId);
    }
    return { granted: false, queued: true };
  }

  renew(actor: ActorRef, runId: string | undefined, ttlMs = this.cfg.leaseTtlMs): boolean {
    const l = this.#lease();
    if (!l || !this.#leaseMatchesActor(l, actor, runId)) return false;
    l.expires_at = new Date(Date.now() + ttlMs).toISOString();
    this.#writeLease(l);
    return true;
  }

  release(actor: ActorRef | "human", token: string): void {
    const l = this.#lease();
    if (!l) return;
    if (actor === "human") {
      // Human authority: the user releases only their own lease, no token needed.
      if (!l.holder_is_human) return;
    } else if (l.token !== token || !this.#leaseMatchesActor(l, actor)) {
      return;
    }
    this.#writeLease(undefined);
    this.events.append("computer", "lease", "computer.lease.released", { holder: actor === "human" ? "human" : actor });
    void this.#grantNext();
  }

  /** User Take over (design.md §5.3): stop bot input, lease to human, park the run. */
  takeOver(): { ok: boolean; lease: ReturnType<ComputerBroker["state"]>["lease"] } {
    const l = this.#lease();
    if (l && !l.holder_is_human) {
      const parkedBotId = l.holder_bot_id!;
      const parkedRun = l.run_id ?? undefined;
      this.#writeLease(undefined);
      this.events.append("computer", "lease", "computer.take_over", { from: { botId: parkedBotId }, runId: parkedRun });
      this.runner.parkForHuman(parkedBotId, parkedRun);
      this.#writeLease({
        holder_is_human: 1, holder_bot_id: null, holder_role_id: null, run_id: null,
        token: randomUUID(), acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      });
    } else if (!l) {
      this.#writeLease({
        holder_is_human: 1, holder_bot_id: null, holder_role_id: null, run_id: null,
        token: randomUUID(), acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      });
      this.events.append("computer", "lease", "computer.take_over", { from: null });
    }
    return { ok: true, lease: this.state().lease };
  }

  /** User I'm done: re-observe, then hand the lease to the next waiting run. */
  async imDone(note?: string): Promise<{ observation?: string | null }> {
    const l = this.#lease();
    if (!l || !l.holder_is_human) return {};
    let observation: string | undefined;
    try {
      const r = await this.supervisor.computerCommand({ type: "act", action: { name: "observe", args: {} } }, 15_000);
      observation = r?.text;
    } catch {
      observation = undefined; // fail open for observation only
    }
    this.#writeLease(undefined);
    this.events.append("computer", "lease", "computer.im_done", { note: note ?? null, observation: observation ?? null });
    await this.#grantNext();
    return observation !== undefined ? { observation } : {};
  }

  async #grantNext(): Promise<void> {
    const next = this.#queue.shift();
    if (!next) return;
    const res = await this.acquire(next.actor, next.runId);
    if (res.granted) this.runner.resumeAfterHuman(next.runId);
  }

  emergencyStop(): void {
    this.#emergencyStopped = true;
    const l = this.#lease();
    if (l && !l.holder_is_human) {
      const botId = l.holder_bot_id!;
      const runId = l.run_id ?? undefined;
      this.#writeLease(undefined);
      this.runner.parkForHuman(botId, runId);
    }
    this.#queue = [];
    this.events.append("computer", "lease", "computer.emergency_stop", {});
  }

  resumeAfterEmergencyStop(): void {
    this.#emergencyStopped = false;
    this.events.append("computer", "lease", "computer.resumed", {});
  }

  /**
   * The single path for desktop actions. Input actions require a live lease;
   * sensitive actions require an approval decision even under `trusted`.
   */
  async act(actor: ActorRef | "human", runId: string | undefined, action: ComputerAction): Promise<{ text?: string; imageRef?: string; windowList?: unknown }> {
    if (this.#emergencyStopped && isInputAction(action.name)) throw new Error("computer input is emergency-stopped");
    const l = this.#lease();
    if (isInputAction(action.name)) {
      if (!l) throw new Error("no active input lease");
      if (actor === "human") {
        if (!l.holder_is_human) throw new Error("input lease is not held by human");
      } else if (!this.#leaseMatchesActor(l, actor, runId)) {
        throw new Error(`input lease held by ${l.holder_is_human ? "human" : `${l.holder_bot_id}/${l.holder_role_id}`}`);
      }
    }
    if (isSensitiveAction(action.name) && actor !== "human") {
      const approval = this.permissions.create({
        source: "computer",
        tool: action.name,
        details: action.args,
        ...(runId !== undefined ? { runId } : {}),
        timeoutMs: this.cfg.approvalTimeoutMs,
      });
      const allowed = await new Promise<boolean>((resolve) => this.permissions.registerWaiter(approval.id, resolve));
      if (!allowed) throw new Error(`action ${action.name} not approved`);
    }

    this.events.append("computer", "lease", "computer.action", { actor, runId: runId ?? null, action: action.name, args: action.args, input: isInputAction(action.name) });
    const cmd: { type: "act"; action: ComputerAction; lease?: { holder: ActorRef | "human"; runId?: string; token: string } } = { type: "act", action };
    if (l && isInputAction(action.name)) {
      cmd.lease = {
        holder: l.holder_is_human ? ("human" as const) : { botId: l.holder_bot_id as AgentId, roleId: l.holder_role_id! },
        ...(l.run_id !== null ? { runId: l.run_id } : {}),
        token: l.token,
      };
    }
    const r = await this.supervisor.computerCommand(cmd, 30_000);

    let imageRef: string | undefined;
    if (r?.image?.base64) {
      const id = randomUUID();
      const ext = r.image.mediaType === "image/png" ? "png" : "jpg";
      const p = path.join(this.cfg.artifactsDir, `snapshot-${id}.${ext}`);
      await writeFile(p, Buffer.from(r.image.base64, "base64"));
      this.db.query(`INSERT INTO artifacts (id, kind, media_type, path, created_at) VALUES (?, 'snapshot', ?, ?, ?)`).run(id, r.image.mediaType, p, new Date().toISOString());
      imageRef = id;
      this.#lastImageAt = new Date().toISOString();
    }
    return {
      ...(r?.text !== undefined ? { text: r.text } : {}),
      ...(imageRef !== undefined ? { imageRef } : {}),
      ...(r?.windowList !== undefined ? { windowList: r.windowList } : {}),
    };
  }

  /** Rate-limited observation for the web panel; never lease-gated. */
  async snapshot(): Promise<{ bytes: Uint8Array; mediaType: string } | undefined> {
    if (Date.now() - this.#lastSnapshotAt < 400) return this.#snapshotCache;
    const r = await this.supervisor.computerCommand({ type: "act", action: { name: "screenshot", args: {} } }, 15_000).catch(() => undefined);
    if (!r?.image?.base64) return this.#snapshotCache;
    this.#lastSnapshotAt = Date.now();
    this.#snapshotCache = { mediaType: r.image.mediaType, bytes: Buffer.from(r.image.base64, "base64") };
    this.#lastImageAt = new Date().toISOString();
    return this.#snapshotCache;
  }
}
