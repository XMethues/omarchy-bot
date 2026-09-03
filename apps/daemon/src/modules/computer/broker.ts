import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "bun:sqlite";
import { isInputAction, type ComputerAction, type ComputerLease, type SurfaceId } from "@omarchy-bot/domain";
import type { EventLog } from "../events/eventLog.ts";
import type { TurnService } from "../turns/turns.ts";
import type { BotScreenInputLease, BotScreenManager } from "./botScreenManager.ts";
import type { Config } from "../../bootstrap/config.ts";

interface LeaseRow {
  surface_id: SurfaceId;
  holder_is_human: number;
  holder_bot_id: string;
  turn_id: string | null;
  token: string;
  acquired_at: string;
  expires_at: string;
}
interface ParkedBot {
  turnId?: string;
}
interface SnapshotCache {
  checkedAt: number;
  mediaType: string;
  bytes: Uint8Array;
}
export interface ComputerBrokerState {
  botId: string;
  surfaceId: SurfaceId;
  lease: ComputerLease | null;
  queuedTurnIds: string[];
  needsHuman: boolean;
  emergencyStopped: boolean;
  lastImageAt?: string;
}

export interface ComputerSurfaceOwner {
  botId: string;
  surfaceId: SurfaceId;
}


/**
 * Surface-scoped input coordination. BotScreenManager owns runtime lifecycle
 * and execution; this module keeps leases, queues, and artifacts Bot-scoped.
 */
export class ComputerBroker {
  #queues = new Map<SurfaceId, ParkedBot[]>();
  #parkedForHuman = new Map<SurfaceId, ParkedBot>();
  #parkedForEmergency = new Map<SurfaceId, ParkedBot>();
  #emergencyStopped = new Set<SurfaceId>();
  #snapshotCaches = new Map<SurfaceId, SnapshotCache>();

  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly turns: TurnService,
    private readonly screens: BotScreenManager,
    private readonly cfg: Config,
  ) {
    this.events.subscribe((event) => {
      if (event.aggregateType !== "bot" || (event.type !== "bot.archived" && event.type !== "bot.deleted")) return;
      const payload = event.payload as { surfaceId?: unknown } | undefined;
      if (typeof payload?.surfaceId === "string") this.#clearSurface(payload.surfaceId as SurfaceId);
    });
  }

  resolveOwner(botId: string, surfaceId: string): ComputerSurfaceOwner | undefined {
    const row = this.db
      .query(
        `SELECT bot_surfaces.surface_id
         FROM bot_surfaces
         JOIN bots ON bots.id = bot_surfaces.bot_id
         WHERE bot_surfaces.bot_id = ? AND bot_surfaces.surface_id = ? AND bots.archived = 0`,
      )
      .get(botId, surfaceId) as { surface_id: SurfaceId } | null;
    return row === null ? undefined : { botId, surfaceId: row.surface_id };
  }

  ownerForBot(botId: string): ComputerSurfaceOwner | undefined {
    const row = this.db
      .query(
        `SELECT bot_surfaces.surface_id
         FROM bot_surfaces
         JOIN bots ON bots.id = bot_surfaces.bot_id
         WHERE bot_surfaces.bot_id = ? AND bots.archived = 0`,
      )
      .get(botId) as { surface_id: SurfaceId } | null;
    return row === null ? undefined : { botId, surfaceId: row.surface_id };
  }

  #requireOwner(owner: ComputerSurfaceOwner): ComputerSurfaceOwner {
    const resolved = this.resolveOwner(owner.botId, owner.surfaceId);
    if (resolved === undefined) throw new Error("unknown, archived, or mismatched Computer Surface owner");
    return resolved;
  }

  #lease(surfaceId: SurfaceId): LeaseRow | undefined {
    return (this.db.query(`SELECT * FROM computer_leases WHERE surface_id = ?`).get(surfaceId) ?? undefined) as
      | LeaseRow
      | undefined;
  }

  #writeLease(owner: ComputerSurfaceOwner, lease: LeaseRow | undefined): void {
    if (lease === undefined) {
      this.db.query(`DELETE FROM computer_leases WHERE surface_id = ?`).run(owner.surfaceId);
      return;
    }
    this.db
      .query(
        `INSERT INTO computer_leases
           (surface_id, holder_is_human, holder_bot_id, turn_id, token, acquired_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(surface_id) DO UPDATE SET
           holder_is_human=excluded.holder_is_human,
           holder_bot_id=excluded.holder_bot_id,
           turn_id=excluded.turn_id,
           token=excluded.token,
           acquired_at=excluded.acquired_at,
           expires_at=excluded.expires_at`,
      )
      .run(
        lease.surface_id,
        lease.holder_is_human,
        lease.holder_bot_id,
        lease.turn_id,
        lease.token,
        lease.acquired_at,
        lease.expires_at,
      );
  }

  #event(owner: ComputerSurfaceOwner): void {
    this.events.append("computer", owner.surfaceId, "computer.state.changed", owner);
  }

  #queue(surfaceId: SurfaceId): ParkedBot[] {
    let queue = this.#queues.get(surfaceId);
    if (queue === undefined) {
      queue = [];
      this.#queues.set(surfaceId, queue);
    }
    return queue;
  }

  state(input: ComputerSurfaceOwner): ComputerBrokerState {
    const owner = this.#requireOwner(input);
    const lease = this.#lease(owner.surfaceId);
    const surface = this.db
      .query(`SELECT last_image_at FROM bot_surfaces WHERE surface_id = ?`)
      .get(owner.surfaceId) as { last_image_at: string | null };
    const needsHuman =
      this.db.query(`SELECT 1 FROM turns WHERE bot_id = ? AND status = 'waiting_for_input' LIMIT 1`).get(owner.botId) !== null;
    return {
      ...owner,
      lease:
        lease === undefined
          ? null
          : {
              surfaceId: owner.surfaceId,
              holder: lease.holder_is_human ? ("human" as const) : { botId: owner.botId },
              ...(lease.turn_id !== null ? { turnId: lease.turn_id } : {}),
              acquiredAt: lease.acquired_at,
              expiresAt: lease.expires_at,
            },
      queuedTurnIds: this.#queue(owner.surfaceId).flatMap((entry) =>
        entry.turnId === undefined ? [] : [entry.turnId]
      ),
      needsHuman,
      emergencyStopped: this.#emergencyStopped.has(owner.surfaceId),
      ...(surface.last_image_at !== null ? { lastImageAt: surface.last_image_at } : {}),
    };
  }

  states(): ComputerBrokerState[] {
    const owners = this.db
      .query(
        `SELECT bot_surfaces.bot_id, bot_surfaces.surface_id
         FROM bot_surfaces JOIN bots ON bots.id = bot_surfaces.bot_id
         WHERE bots.archived = 0`,
      )
      .all() as Array<{ bot_id: string; surface_id: SurfaceId }>;
    return owners.map((owner) => this.state({ botId: owner.bot_id, surfaceId: owner.surface_id }));
  }

  async acquire(input: ComputerSurfaceOwner, turnId: string | undefined, ttlMs = this.cfg.leaseTtlMs): Promise<{ granted: boolean; token?: string; queued: boolean }> {
    const owner = this.#requireOwner(input);
    if (this.#emergencyStopped.has(owner.surfaceId)) return { granted: false, queued: false };
    const lease = this.#lease(owner.surfaceId);
    const expired = lease !== undefined && new Date(lease.expires_at).getTime() <= Date.now();
    if (lease === undefined || expired) {
      const token = randomUUID();
      const now = new Date();
      this.#writeLease(owner, {
        surface_id: owner.surfaceId,
        holder_is_human: 0,
        holder_bot_id: owner.botId,
        turn_id: turnId ?? null,
        token,
        acquired_at: now.toISOString(),
        expires_at: new Date(now.getTime() + ttlMs).toISOString(),
      });
      this.#event(owner);
      return { granted: true, token, queued: false };
    }
    if (!lease.holder_is_human && (turnId === undefined || lease.turn_id === turnId)) {
      return { granted: true, token: lease.token, queued: false };
    }
    const queue = this.#queue(owner.surfaceId);
    if (!queue.some((entry) => entry.turnId === turnId)) {
      queue.push(turnId === undefined ? {} : { turnId });
      this.#event(owner);
      if (turnId !== undefined) this.turns.parkForComputer(turnId);
    }
    return { granted: false, queued: true };
  }

  renew(input: ComputerSurfaceOwner, turnId: string | undefined, ttlMs = this.cfg.leaseTtlMs): boolean {
    const owner = this.#requireOwner(input);
    const lease = this.#lease(owner.surfaceId);
    if (lease === undefined || lease.holder_is_human || (turnId !== undefined && lease.turn_id !== turnId)) return false;
    lease.expires_at = new Date(Date.now() + ttlMs).toISOString();
    this.#writeLease(owner, lease);
    return true;
  }

  release(input: ComputerSurfaceOwner, token: string, actor: "bot" | "human" = "bot"): void {
    const owner = this.#requireOwner(input);
    const lease = this.#lease(owner.surfaceId);
    if (lease === undefined) return;
    if (actor === "human" ? !lease.holder_is_human : lease.holder_is_human || lease.token !== token) return;
    this.#writeLease(owner, undefined);
    this.#event(owner);
    void this.#grantNext(owner);
  }

  takeOver(input: ComputerSurfaceOwner): { ok: boolean; lease: ComputerLease | null } {
    const owner = this.#requireOwner(input);
    const lease = this.#lease(owner.surfaceId);
    if (lease?.holder_is_human) return { ok: true, lease: this.state(owner).lease };
    if (lease !== undefined) {
      const parkedTurn = lease.turn_id ?? undefined;
      this.#parkedForHuman.set(owner.surfaceId, parkedTurn === undefined ? {} : { turnId: parkedTurn });
      this.turns.parkForHuman(parkedTurn);
    } else {
      this.#parkedForHuman.delete(owner.surfaceId);
    }
    const now = new Date();
    this.#writeLease(owner, {
      surface_id: owner.surfaceId,
      holder_is_human: 1,
      holder_bot_id: owner.botId,
      turn_id: null,
      token: randomUUID(),
      acquired_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 24 * 3600_000).toISOString(),
    });
    this.#event(owner);
    return { ok: true, lease: this.state(owner).lease };
  }

  async imDone(input: ComputerSurfaceOwner): Promise<{ observation?: string | null }> {
    const owner = this.#requireOwner(input);
    const lease = this.#lease(owner.surfaceId);
    if (lease === undefined || !lease.holder_is_human) return {};
    const result = await this.act(owner, undefined, { name: "observe", args: {} }, "human");
    const parked = this.#parkedForHuman.get(owner.surfaceId);
    this.#parkedForHuman.delete(owner.surfaceId);
    this.#writeLease(owner, undefined);
    if (parked !== undefined) {
      const restored = await this.acquire(owner, parked.turnId);
      if (restored.granted) this.turns.resumeAfterHuman(parked.turnId);
    } else {
      await this.#grantNext(owner);
    }
    this.#event(owner);
    return result?.text === undefined ? {} : { observation: result.text };
  }

  async #grantNext(owner: ComputerSurfaceOwner): Promise<void> {
    const next = this.#queue(owner.surfaceId).shift();
    if (next === undefined) return;
    const result = await this.acquire(owner, next.turnId);
    if (result.granted) this.turns.resumeAfterComputer(next.turnId);
  }

  emergencyStop(input: ComputerSurfaceOwner): void {
    const owner = this.#requireOwner(input);
    this.#emergencyStopped.add(owner.surfaceId);
    const lease = this.#lease(owner.surfaceId);
    if (lease !== undefined && !lease.holder_is_human) {
      const parked = lease.turn_id === null ? {} : { turnId: lease.turn_id };
      this.#parkedForEmergency.set(owner.surfaceId, parked);
      if (parked.turnId !== undefined) this.turns.parkForHuman(parked.turnId);
    } else {
      this.#parkedForEmergency.delete(owner.surfaceId);
    }
    this.#parkedForHuman.delete(owner.surfaceId);
    this.#writeLease(owner, undefined);
    this.#event(owner);
  }

  async resumeAfterEmergencyStop(input: ComputerSurfaceOwner): Promise<void> {
    const owner = this.#requireOwner(input);
    if (!this.#emergencyStopped.has(owner.surfaceId)) return;
    const parked = this.#parkedForEmergency.get(owner.surfaceId);
    if (parked !== undefined || this.#queue(owner.surfaceId).length > 0) {
      await this.act(owner, undefined, { name: "observe", args: {} });
    }
    this.#parkedForEmergency.delete(owner.surfaceId);
    this.#emergencyStopped.delete(owner.surfaceId);
    if (parked !== undefined) {
      const restored = await this.acquire(owner, parked.turnId);
      if (restored.granted) this.turns.resumeAfterHuman(parked.turnId);
    } else {
      await this.#grantNext(owner);
    }
    this.#event(owner);
  }

  async act(
    input: ComputerSurfaceOwner,
    turnId: string | undefined,
    action: ComputerAction,
    actor: "bot" | "human" = "bot",
  ): Promise<{ text?: string; imageRef?: string; windowList?: unknown }> {
    const owner = this.#requireOwner(input);
    if (this.#emergencyStopped.has(owner.surfaceId) && isInputAction(action.name)) {
      throw new Error("computer input is emergency-stopped");
    }
    const lease = this.#lease(owner.surfaceId);
    if (isInputAction(action.name)) {
      if (lease === undefined) throw new Error("no active input lease");
      if (actor === "human") {
        if (!lease.holder_is_human) throw new Error("input lease is not held by human");
      } else if (lease.holder_is_human || (turnId !== undefined && lease.turn_id !== turnId)) {
        throw new Error(`input lease held by ${lease.holder_is_human ? "human" : owner.botId}`);
      }
    }

    const screenLease: BotScreenInputLease | undefined = !isInputAction(action.name) || lease === undefined
      ? undefined
      : {
          surfaceId: owner.surfaceId,
          holder: actor === "human" ? "human" : { botId: owner.botId },
          ...(lease.turn_id === null ? {} : { turnId: lease.turn_id }),
          token: lease.token,
        };
    const result = await this.screens.act(owner, action, screenLease);

    let imageRef: string | undefined;
    if (result.image !== undefined) {
      const id = randomUUID();
      const extension = result.image.mediaType === "image/png" ? "png" : "jpg";
      const artifactPath = path.join(this.cfg.artifactsDir, `snapshot-${id}.${extension}`);
      const observedAt = new Date().toISOString();
      await writeFile(artifactPath, result.image.bytes);
      this.db
        .query(`INSERT INTO artifacts (id, kind, media_type, path, created_at, surface_id) VALUES (?, 'snapshot', ?, ?, ?, ?)`)
        .run(id, result.image.mediaType, artifactPath, observedAt, owner.surfaceId);
      this.db.query(`UPDATE bot_surfaces SET last_image_at = ? WHERE surface_id = ?`).run(observedAt, owner.surfaceId);
      imageRef = id;
    }
    this.#event(owner);
    return {
      ...(result?.text !== undefined ? { text: result.text } : {}),
      ...(imageRef !== undefined ? { imageRef } : {}),
      ...(result?.windowList !== undefined ? { windowList: result.windowList } : {}),
    };
  }

  async snapshot(input: ComputerSurfaceOwner): Promise<{ bytes: Uint8Array; mediaType: string } | undefined> {
    const owner = this.#requireOwner(input);
    const cached = this.#snapshotCaches.get(owner.surfaceId);
    if (cached !== undefined && Date.now() - cached.checkedAt < 400) {
      return { mediaType: cached.mediaType, bytes: cached.bytes };
    }
    const result = await this.screens.capture(owner).catch(() => undefined);
    if (result === undefined) {
      return cached === undefined ? undefined : { mediaType: cached.mediaType, bytes: cached.bytes };
    }
    const checkedAt = Date.now();
    const next = {
      checkedAt,
      mediaType: result.mediaType,
      bytes: result.bytes,
    };
    this.#snapshotCaches.set(owner.surfaceId, next);
    this.db
      .query(`UPDATE bot_surfaces SET last_image_at = ? WHERE surface_id = ?`)
      .run(new Date(checkedAt).toISOString(), owner.surfaceId);
    this.#event(owner);
    return { mediaType: next.mediaType, bytes: next.bytes };
  }

  shutdown(): void {
    this.db.exec(`DELETE FROM computer_leases`);
    this.#queues.clear();
    this.#parkedForHuman.clear();
    this.#parkedForEmergency.clear();
    this.#emergencyStopped.clear();
    this.#snapshotCaches.clear();
  }

  #clearSurface(surfaceId: SurfaceId): void {
    this.db.query(`DELETE FROM computer_leases WHERE surface_id = ?`).run(surfaceId);
    this.#queues.delete(surfaceId);
    this.#parkedForHuman.delete(surfaceId);
    this.#parkedForEmergency.delete(surfaceId);
    this.#emergencyStopped.delete(surfaceId);
    this.#snapshotCaches.delete(surfaceId);
  }
}
