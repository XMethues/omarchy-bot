import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "bun:sqlite";
import { isInputAction, type ComputerAction } from "@omarchy-bot/domain";
import type { EventLog } from "../events/eventLog.ts";
import type { TurnService } from "../turns/turns.ts";
import type { Supervisor } from "../../supervision/supervisor.ts";
import type { Config } from "../../bootstrap/config.ts";

interface LeaseRow { holder_is_human: number; holder_bot_id: string | null; run_id: string | null; token: string; acquired_at: string; expires_at: string }

/**
 * ComputerBroker: the only grantor/revoker of the exclusive input lease and
 * the only path from agents to the desktop. Observation is never lease-gated;
 * every input action is audited; all failures are fail closed. (ADR 0004:
 * arbitration stays internal — no approval gate sits on this path.)
 */
export class ComputerBroker {
  #queue: { actor: { botId: string }; turnId?: string }[] = [];
  #emergencyStopped = false;
  #lastSnapshotAt = 0;
  #snapshotCache?: { mediaType: string; bytes: Uint8Array };
  #lastImageAt?: string;

  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly turns: TurnService,
    private readonly supervisor: Supervisor,
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
      .query(`INSERT INTO computer_leases (id, holder_is_human, holder_bot_id, run_id, token, acquired_at, expires_at)
              VALUES (1, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET holder_is_human=excluded.holder_is_human, holder_bot_id=excluded.holder_bot_id,
                run_id=excluded.run_id, token=excluded.token,
                acquired_at=excluded.acquired_at, expires_at=excluded.expires_at`)
      .run(l.holder_is_human, l.holder_bot_id, l.run_id, l.token, l.acquired_at, l.expires_at);
  }

  #leaseMatchesActor(l: LeaseRow, actor: { botId: string }, turnId?: string): boolean {
    if (l.holder_is_human) return false;
    return l.holder_bot_id === actor.botId && (turnId === undefined || l.run_id === turnId);
  }

  state(): { lease: { holder: { botId: string } | "human"; turnId?: string; acquiredAt: string; expiresAt: string } | null; queueDepth: number; emergencyStopped: boolean; lastImageAt?: string } {
    const l = this.#lease();
    return {
      lease: l
        ? {
            holder: l.holder_is_human ? ("human" as const) : { botId: l.holder_bot_id! },
            ...(l.run_id !== null ? { turnId: l.run_id } : {}),
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
  async acquire(actor: { botId: string }, turnId: string | undefined, ttlMs = this.cfg.leaseTtlMs): Promise<{ granted: boolean; token?: string; queued: boolean }> {
    if (this.#emergencyStopped) return { granted: false, queued: false };
    const l = this.#lease();
    const expired = l !== undefined && new Date(l.expires_at).getTime() <= Date.now();
    if (l === undefined || expired) {
      const token = randomUUID();
      const now = new Date();
      this.#writeLease({
        holder_is_human: 0, holder_bot_id: actor.botId, run_id: turnId ?? null,
        token, acquired_at: now.toISOString(), expires_at: new Date(now.getTime() + ttlMs).toISOString(),
      });
      this.events.append("computer", "lease", "computer.lease.granted", { holder: actor, turnId, expiresAt: ttlMs });
      return { granted: true, token, queued: false };
    }
    if (this.#leaseMatchesActor(l, actor, turnId)) return { granted: true, token: l.token, queued: false };
    if (!this.#queue.some((q) => q.actor.botId === actor.botId && q.turnId === turnId)) {
      this.#queue.push({ actor, ...(turnId !== undefined ? { turnId } : {}) });
      this.events.append("computer", "lease", "computer.lease.queued", { holder: actor, turnId: turnId ?? null, depth: this.#queue.length });
      if (turnId !== undefined) this.turns.parkForComputer(turnId);
    }
    return { granted: false, queued: true };
  }

  renew(actor: { botId: string }, turnId: string | undefined, ttlMs = this.cfg.leaseTtlMs): boolean {
    const l = this.#lease();
    if (!l || !this.#leaseMatchesActor(l, actor, turnId)) return false;
    l.expires_at = new Date(Date.now() + ttlMs).toISOString();
    this.#writeLease(l);
    return true;
  }

  release(actor: { botId: string } | "human", token: string): void {
    const l = this.#lease();
    if (!l) return;
    if (actor === "human") {
      // Human authority: the user releases only their own lease, no token needed.
      if (!l.holder_is_human) return;
    } else if (l.token !== token || !this.#leaseMatchesActor(l, actor)) {
      return;
    }
    this.#writeLease(undefined);
    this.events.append("computer", "lease", "computer.lease.released", { holder: actor });
    void this.#grantNext();
  }

  /** Contextual takeover: stop Bot input, hand the shared screen to the user, and park the turn. */
  takeOver(): { ok: boolean; lease: ReturnType<ComputerBroker["state"]>["lease"] } {
    const l = this.#lease();
    if (l && !l.holder_is_human) {
      const parkedBotId = l.holder_bot_id!;
      const parkedTurn = l.run_id ?? undefined;
      this.#writeLease(undefined);
      this.events.append("computer", "lease", "computer.take_over", { from: { botId: parkedBotId }, turnId: parkedTurn });
      this.turns.parkForHuman(parkedTurn);
      this.#writeLease({
        holder_is_human: 1, holder_bot_id: null, run_id: null,
        token: randomUUID(), acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      });
    } else if (!l) {
      this.#writeLease({
        holder_is_human: 1, holder_bot_id: null, run_id: null,
        token: randomUUID(), acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      });
      this.events.append("computer", "lease", "computer.take_over", { from: null });
    }
    return { ok: true, lease: this.state().lease };
  }

  /** User I'm done: re-observe, then hand the lease to the next waiting turn. */
  async imDone(note?: string): Promise<{ observation?: string | null }> {
    const l = this.#lease();
    if (!l || !l.holder_is_human) return {};
    let observation: string | undefined;
    try {
      const r = (await this.supervisor.computerCommand({ type: "act", action: { name: "observe", args: {} } }, 15_000)) as { text?: string } | undefined;
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
    const res = await this.acquire(next.actor, next.turnId);
    if (res.granted) this.turns.resumeAfterHuman(next.turnId);
  }

  emergencyStop(): void {
    this.#emergencyStopped = true;
    const l = this.#lease();
    if (l && !l.holder_is_human) {
      const turnId = l.run_id ?? undefined;
      this.#writeLease(undefined);
      this.turns.parkForHuman(turnId);
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
   * everything is audited. No capability/approval filter — the Agent follows
   * its own native behavior (ADR 0003).
   */
  async act(actor: { botId: string } | "human", turnId: string | undefined, action: ComputerAction): Promise<{ text?: string; imageRef?: string; windowList?: unknown }> {
    if (this.#emergencyStopped && isInputAction(action.name)) throw new Error("computer input is emergency-stopped");
    const l = this.#lease();
    if (isInputAction(action.name)) {
      if (!l) throw new Error("no active input lease");
      if (actor === "human") {
        if (!l.holder_is_human) throw new Error("input lease is not held by human");
      } else if (!this.#leaseMatchesActor(l, actor, turnId)) {
        throw new Error(`input lease held by ${l.holder_is_human ? "human" : l.holder_bot_id}`);
      }
    }

    this.events.append("computer", "lease", "computer.action", { actor, turnId: turnId ?? null, action: action.name, args: action.args, input: isInputAction(action.name) });
    const cmd: { type: "act"; action: ComputerAction; lease?: { holder: { botId: string } | "human"; turnId?: string; token: string } } = { type: "act", action };
    if (l && isInputAction(action.name)) {
      cmd.lease = {
        holder: l.holder_is_human ? ("human" as const) : { botId: l.holder_bot_id! },
        ...(l.run_id !== null ? { turnId: l.run_id } : {}),
        token: l.token,
      };
    }
    const r = (await this.supervisor.computerCommand(cmd, 30_000)) as {
      text?: string;
      image?: { mediaType: "image/png" | "image/jpeg"; base64: string };
      windowList?: unknown;
    } | undefined;

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
    const r = (await this.supervisor.computerCommand({ type: "act", action: { name: "screenshot", args: {} } }, 15_000).catch(() => undefined)) as
      | { image?: { mediaType: string; base64: string } }
      | undefined;
    if (!r?.image?.base64) return this.#snapshotCache;
    this.#lastSnapshotAt = Date.now();
    this.#snapshotCache = { mediaType: r.image.mediaType, bytes: Buffer.from(r.image.base64, "base64") };
    this.#lastImageAt = new Date().toISOString();
    return this.#snapshotCache;
  }
}
