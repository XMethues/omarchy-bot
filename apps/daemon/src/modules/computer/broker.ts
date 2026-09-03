import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "bun:sqlite";
import { isInputAction, type ComputerAction, type ComputerLease } from "@omarchy-bot/domain";
import type { EventLog } from "../events/eventLog.ts";
import type { TurnService } from "../turns/turns.ts";
import type { Supervisor } from "../../supervision/supervisor.ts";
import type { Config } from "../../bootstrap/config.ts";

interface LeaseRow { holder_is_human: number; holder_bot_id: string | null; turn_id: string | null; token: string; acquired_at: string; expires_at: string }
interface ParkedBot {
  actor: { botId: string };
  turnId?: string;
}
export interface ComputerBrokerState {
  lease: ComputerLease | null;
  queuedBotIds: string[];
  needsHumanBotIds: string[];
  emergencyStopped: boolean;
  lastImageAt?: string;
}


/**
 * ComputerBroker: the only grantor/revoker of the exclusive input lease and
 * the only path from agents to the desktop. Observation is never lease-gated;
 * input actions are serialized and failures are fail closed. (ADR 0004:
 * arbitration stays internal and never filters Agent capabilities.)
 */
export class ComputerBroker {
  #queue: ParkedBot[] = [];
  #parkedForHuman: ParkedBot | undefined;
  #parkedForEmergency: ParkedBot | undefined;
  #emergencyStopped = false;
  #lastSnapshotAt = 0;
  #snapshotCache: { mediaType: string; bytes: Uint8Array } | undefined;
  #lastImageAt: string | undefined;

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
      .query(`INSERT INTO computer_leases (id, holder_is_human, holder_bot_id, turn_id, token, acquired_at, expires_at)
              VALUES (1, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET holder_is_human=excluded.holder_is_human, holder_bot_id=excluded.holder_bot_id,
                turn_id=excluded.turn_id, token=excluded.token,
                acquired_at=excluded.acquired_at, expires_at=excluded.expires_at`)
      .run(l.holder_is_human, l.holder_bot_id, l.turn_id, l.token, l.acquired_at, l.expires_at);
  }

  #leaseMatchesActor(l: LeaseRow, actor: { botId: string }, turnId?: string): boolean {
    if (l.holder_is_human) return false;
    return l.holder_bot_id === actor.botId && (turnId === undefined || l.turn_id === turnId);
  }

  state(): ComputerBrokerState {
    const l = this.#lease();
    const needsHumanBotIds = (
      this.db
        .query(`SELECT DISTINCT bot_id FROM turns WHERE status = 'waiting_for_input'`)
        .all() as { bot_id: string }[]
    ).map((row) => row.bot_id);
    return {
      lease: l
        ? {
            holder: l.holder_is_human ? ("human" as const) : { botId: l.holder_bot_id! },
            ...(l.turn_id !== null ? { turnId: l.turn_id } : {}),
            acquiredAt: l.acquired_at,
            expiresAt: l.expires_at,
          }
        : null,
      queuedBotIds: this.#queue.map((entry) => entry.actor.botId),
      needsHumanBotIds,
      emergencyStopped: this.#emergencyStopped,
      ...(this.#lastImageAt !== undefined ? { lastImageAt: this.#lastImageAt } : {}),
    };
  }

  /** Drop runtime-only computer claims so a terminal Turn cannot be resumed after deletion starts. */
  removeBot(botId: string): void {
    let changed = false;
    const retainedQueue = this.#queue.filter((entry) => entry.actor.botId !== botId);
    if (retainedQueue.length !== this.#queue.length) {
      this.#queue = retainedQueue;
      changed = true;
    }
    if (this.#parkedForHuman?.actor.botId === botId) {
      this.#parkedForHuman = undefined;
      changed = true;
    }
    if (this.#parkedForEmergency?.actor.botId === botId) {
      this.#parkedForEmergency = undefined;
      changed = true;
    }
    if (changed) this.events.append("computer", "state", "computer.state.changed", {});
  }

  /** A successful deletion may have released the persisted lease; advance an unrelated waiter. */
  resumeQueueAfterBotRemoval(): void {
    if (this.#lease() === undefined) void this.#grantNext();
  }

  /** Bot requests the exclusive input lease. Queues as waiting_for_computer when held. */
  async acquire(actor: { botId: string }, turnId: string | undefined, ttlMs = this.cfg.leaseTtlMs): Promise<{ granted: boolean; token?: string; queued: boolean }> {
    if (this.#emergencyStopped) return { granted: false, queued: false };
    const l = this.#lease();
    const expired = l !== undefined && l.holder_is_human === 0 && new Date(l.expires_at).getTime() <= Date.now();
    if (l === undefined || expired) {
      const token = randomUUID();
      const now = new Date();
      this.#writeLease({
        holder_is_human: 0, holder_bot_id: actor.botId, turn_id: turnId ?? null,
        token, acquired_at: now.toISOString(), expires_at: new Date(now.getTime() + ttlMs).toISOString(),
      });
      this.events.append("computer", "state", "computer.state.changed", { botId: actor.botId });
      return { granted: true, token, queued: false };
    }
    if (this.#leaseMatchesActor(l, actor, turnId)) return { granted: true, token: l.token, queued: false };
    if (!this.#queue.some((q) => q.actor.botId === actor.botId && q.turnId === turnId)) {
      this.#queue.push({ actor, ...(turnId !== undefined ? { turnId } : {}) });
      this.events.append("computer", "state", "computer.state.changed", { botId: actor.botId });
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
    this.events.append("computer", "state", "computer.state.changed", actor === "human" ? {} : { botId: actor.botId });
    void this.#grantNext();
  }

  /** Contextual takeover: stop Bot input, hand the shared screen to the user, and park the turn. */
  takeOver(): { ok: boolean; lease: ComputerLease | null } {
    const l = this.#lease();
    if (l && !l.holder_is_human) {
      const parkedBotId = l.holder_bot_id!;
      const parkedTurn = l.turn_id ?? undefined;
      this.#parkedForHuman = {
        actor: { botId: parkedBotId },
        ...(parkedTurn !== undefined ? { turnId: parkedTurn } : {}),
      };
      this.#writeLease(undefined);
      this.turns.parkForHuman(parkedTurn);
      this.#writeLease({
        holder_is_human: 1, holder_bot_id: null, turn_id: null,
        token: randomUUID(), acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      });
      this.events.append("computer", "state", "computer.state.changed", { botId: parkedBotId });
    } else if (!l) {
      this.#parkedForHuman = undefined;
      this.#writeLease({
        holder_is_human: 1, holder_bot_id: null, turn_id: null,
        token: randomUUID(), acquired_at: new Date().toISOString(), expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      });
      this.events.append("computer", "state", "computer.state.changed", {});
    }
    return { ok: true, lease: this.state().lease };
  }

  /** User is done: re-observe successfully, then restore the parked Bot before any queued Bot. */
  async imDone(): Promise<{ observation?: string | null }> {
    const l = this.#lease();
    if (!l || !l.holder_is_human) return {};

    const result = (await this.supervisor.computerCommand(
      { type: "act", action: { name: "observe", args: {} } },
      15_000,
    )) as { text?: string } | undefined;
    const observation = result?.text;

    const parked = this.#parkedForHuman;
    this.#parkedForHuman = undefined;
    this.#writeLease(undefined);
    if (parked !== undefined) {
      const restored = await this.acquire(parked.actor, parked.turnId);
      if (restored.granted) this.turns.resumeAfterHuman(parked.turnId);
    } else {
      await this.#grantNext();
    }
    this.events.append("computer", "state", "computer.state.changed", parked === undefined ? {} : { botId: parked.actor.botId });
    return observation !== undefined ? { observation } : {};
  }

  async #grantNext(): Promise<void> {
    const next = this.#queue.shift();
    if (!next) return;
    const res = await this.acquire(next.actor, next.turnId);
    if (res.granted) this.turns.resumeAfterComputer(next.turnId);
  }

  emergencyStop(): void {
    this.#emergencyStopped = true;
    const l = this.#lease();
    this.#parkedForEmergency =
      l !== undefined && !l.holder_is_human
        ? {
            actor: { botId: l.holder_bot_id! },
            ...(l.turn_id !== null ? { turnId: l.turn_id } : {}),
          }
        : undefined;
    if (this.#parkedForEmergency?.turnId !== undefined) {
      this.turns.parkForHuman(this.#parkedForEmergency.turnId);
    }
    this.#parkedForHuman = undefined;
    this.#writeLease(undefined);
    this.events.append("computer", "state", "computer.state.changed", {});
  }

  async resumeAfterEmergencyStop(): Promise<void> {
    if (!this.#emergencyStopped) return;
    const parked = this.#parkedForEmergency;
    if (parked !== undefined || this.#queue.length > 0) {
      await this.supervisor.computerCommand({ type: "act", action: { name: "observe", args: {} } }, 15_000);
    }
    this.#parkedForEmergency = undefined;
    this.#emergencyStopped = false;
    if (parked !== undefined) {
      const restored = await this.acquire(parked.actor, parked.turnId);
      if (restored.granted) this.turns.resumeAfterHuman(parked.turnId);
    } else {
      await this.#grantNext();
    }
    this.events.append("computer", "state", "computer.state.changed", parked === undefined ? {} : { botId: parked.actor.botId });
  }

  /**
   * The single path for desktop actions. Input actions require a live lease;
   * the Agent follows its own native behavior (ADR 0003).
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

    const cmd: { type: "act"; action: ComputerAction; lease?: { holder: { botId: string } | "human"; turnId?: string; token: string } } = { type: "act", action };
    if (l && isInputAction(action.name)) {
      cmd.lease = {
        holder: l.holder_is_human ? ("human" as const) : { botId: l.holder_bot_id! },
        ...(l.turn_id !== null ? { turnId: l.turn_id } : {}),
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
    this.events.append("computer", "state", "computer.state.changed", actor === "human" ? {} : { botId: actor.botId });
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
