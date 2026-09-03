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

type AgentToolOutput = {
  text?: string;
  imageRef?: string;
  imageFile?: { mediaType: "image/png" | "image/jpeg"; path: string };
  windowList?: unknown;
};

type TakeoverPhase = "running" | "takeover-requested" | "held" | "completing" | "settled";
type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  let reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}


interface PendingAgentTool {
  owner: ComputerSurfaceOwner;
  turnId: string;
  toolCallId: string;
  phase: TakeoverPhase;
  actionDone: Deferred<void>;
  activated: Deferred<void>;
  completion: Deferred<AgentToolOutput>;
  actionError?: unknown;
  cancellation?: Error;
}

export type WebControlRevoker = (surfaceId: SurfaceId) => Promise<void>;
export interface ComputerBrokerState {
  botId: string;
  surfaceId: SurfaceId;
  lease: ComputerLease | null;
  queuedTurnIds: string[];
  emergencyStopped: boolean;
  takeover: "unavailable" | "available" | "active";
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
  #parkedForEmergency = new Map<SurfaceId, ParkedBot>();
  #emergencyStopped = new Set<SurfaceId>();
  #snapshotCaches = new Map<SurfaceId, SnapshotCache>();
  #agentOperations = new Map<SurfaceId, Promise<void>>();
  #pendingAgentTools = new Map<SurfaceId, PendingAgentTool>();

  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly turns: TurnService,
    private readonly screens: BotScreenManager,
    private readonly cfg: Config,
    private readonly revokeWebControl: WebControlRevoker,
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
    const pending = this.#pendingAgentTools.get(owner.surfaceId);
    const takeover =
      pending?.phase === "held" || pending?.phase === "completing"
        ? "active" as const
        : pending?.phase === "running" || pending?.phase === "takeover-requested"
          ? "available" as const
          : "unavailable" as const;
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
      takeover,
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

  async takeOver(input: ComputerSurfaceOwner): Promise<{ ok: boolean }> {
    const owner = this.#requireOwner(input);
    const pending = this.#pendingAgentTools.get(owner.surfaceId);
    if (pending === undefined) return { ok: false };
    if (pending.phase === "held" || pending.phase === "completing") return { ok: true };
    if (pending.phase === "settled") return { ok: false };
    if (pending.phase === "running") {
      pending.phase = "takeover-requested";
      this.#event(owner);
    }

    await pending.actionDone.promise;
    const current = this.#pendingAgentTools.get(owner.surfaceId);
    if (
      current?.phase === "settled"
      || current !== pending
      || pending.cancellation !== undefined
      || pending.actionError !== undefined
    ) {
      return { ok: false };
    }
    if (pending.phase === "takeover-requested") {
      const now = new Date();
      this.#writeLease(owner, {
        surface_id: owner.surfaceId,
        holder_is_human: 1,
        holder_bot_id: owner.botId,
        turn_id: pending.turnId,
        token: randomUUID(),
        acquired_at: now.toISOString(),
        expires_at: new Date(now.getTime() + 24 * 3600_000).toISOString(),
      });
      pending.phase = "held";
      pending.activated.resolve();
      this.#event(owner);
    }
    return { ok: pending.phase === "held" || pending.phase === "completing" };
  }

  async imDone(input: ComputerSurfaceOwner): Promise<{ observation?: string }> {
    const owner = this.#requireOwner(input);
    const pending = this.#pendingAgentTools.get(owner.surfaceId);
    if (pending === undefined || pending.phase !== "held") {
      throw new Error("Takeover is not active");
    }
    pending.phase = "completing";
    this.#event(owner);
    try {
      await this.revokeWebControl(owner.surfaceId);
      if (pending.cancellation !== undefined) throw pending.cancellation;
      const context = await this.act(owner, pending.turnId, { name: "observe", args: {} }, "human");
      if (pending.cancellation !== undefined) throw pending.cancellation;
      const screenshot = await this.act(owner, pending.turnId, { name: "screenshot", args: {} }, "human");
      if (pending.cancellation !== undefined) throw pending.cancellation;
      const result = await this.#withImageFile(owner, {
        ...context,
        ...screenshot,
        ...(context.text === undefined ? {} : { text: context.text }),
        ...(context.windowList === undefined ? {} : { windowList: context.windowList }),
      });
      pending.phase = "settled";
      this.#releaseHumanLease(pending);
      pending.completion.resolve(result);
      this.#event(owner);
      return result.text === undefined ? {} : { observation: result.text };
    } catch (error) {
      if (pending.cancellation === undefined) {
        pending.phase = "held";
        this.#event(owner);
      }
      throw error;
    }
  }
  canAcceptWebControl(input: ComputerSurfaceOwner): boolean {
    const owner = this.resolveOwner(input.botId, input.surfaceId);
    if (owner === undefined) return false;
    const pending = this.#pendingAgentTools.get(owner.surfaceId);
    if (pending !== undefined) return pending.phase === "held";
    return this.#lease(owner.surfaceId) === undefined;
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

  /**
   * Executes one SDK computer tool call under Surface-scoped coordination.
   * The queue is per Surface, so separate Bot Screens remain independent.
   */
  async agentToolAct(
    input: ComputerSurfaceOwner,
    turnId: string,
    toolCallId: string,
    action: ComputerAction,
    signal: AbortSignal,
  ): Promise<AgentToolOutput> {
    const owner = this.#requireOwner(input);
    return this.#serializeAgentOperation(owner.surfaceId, async () => {
      signal.throwIfAborted();
      this.#requireOwner(owner);

      let acquiredToken: string | undefined;
      if (isInputAction(action.name)) {
        const lease = this.#lease(owner.surfaceId);
        const expired = lease !== undefined
          && new Date(lease.expires_at).getTime() <= Date.now();
        if (
          lease !== undefined
          && !expired
          && (lease.holder_is_human || lease.turn_id !== turnId)
        ) {
          throw new Error("Computer Surface input is busy");
        }
        if (lease === undefined || expired) {
          const acquired = await this.acquire(owner, turnId);
          if (!acquired.granted || acquired.token === undefined) {
            throw new Error("Computer Surface input is busy");
          }
          acquiredToken = acquired.token;
        }
      }

      const pending: PendingAgentTool = {
        owner,
        turnId,
        toolCallId,
        phase: "running",
        actionDone: deferred<void>(),
        activated: deferred<void>(),
        completion: deferred<AgentToolOutput>(),
      };
      pending.activated.promise.catch(() => {});
      pending.completion.promise.catch(() => {});
      this.#pendingAgentTools.set(owner.surfaceId, pending);
      this.#event(owner);
      const cancel = (): void => {
        const reason = signal.reason instanceof Error
          ? signal.reason
          : new Error("computer tool call cancelled");
        void this.#cancelPending(pending, reason);
      };
      signal.addEventListener("abort", cancel, { once: true });

      try {
        let initial: AgentToolOutput;
        try {
          await this.revokeWebControl(owner.surfaceId);
          signal.throwIfAborted();
          initial = await this.#withImageFile(owner, await this.act(owner, turnId, action));
          signal.throwIfAborted();
        } catch (error) {
          pending.actionError = error;
          throw error;
        } finally {
          pending.actionDone.resolve();
        }

        if (pending.phase === "running") return initial;
        if (pending.phase === "takeover-requested") await pending.activated.promise;
        if (pending.cancellation !== undefined) throw pending.cancellation;
        return await pending.completion.promise;
      } finally {
        signal.removeEventListener("abort", cancel);
        if (this.#pendingAgentTools.get(owner.surfaceId) === pending) {
          this.#pendingAgentTools.delete(owner.surfaceId);
        }
        if (acquiredToken !== undefined) this.release(owner, acquiredToken);
        this.#event(owner);
      }
    });
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
    for (const pending of this.#pendingAgentTools.values()) {
      const error = new Error("daemon stopped during pending computer tool");
      pending.cancellation = error;
      pending.phase = "settled";
      pending.activated.reject(error);
      pending.completion.reject(error);
    }
    this.#pendingAgentTools.clear();
    this.#queues.clear();
    this.#parkedForEmergency.clear();
    this.#emergencyStopped.clear();
    this.#snapshotCaches.clear();
  }

  #clearSurface(surfaceId: SurfaceId): void {
    const pending = this.#pendingAgentTools.get(surfaceId);
    if (pending !== undefined) {
      void this.#cancelPending(pending, new Error("Computer Surface was removed during pending tool"));
    }
    this.db.query(`DELETE FROM computer_leases WHERE surface_id = ?`).run(surfaceId);
    this.#queues.delete(surfaceId);
    this.#parkedForEmergency.delete(surfaceId);
    this.#emergencyStopped.delete(surfaceId);
    this.#snapshotCaches.delete(surfaceId);
  }
  async #withImageFile(
    owner: ComputerSurfaceOwner,
    result: { text?: string; imageRef?: string; windowList?: unknown },
  ): Promise<AgentToolOutput> {
    if (result.imageRef === undefined) return result;
    const artifact = this.db
      .query(`SELECT media_type, path FROM artifacts WHERE id = ? AND surface_id = ?`)
      .get(result.imageRef, owner.surfaceId) as { media_type: string; path: string } | null;
    if (
      artifact === null
      || (artifact.media_type !== "image/png" && artifact.media_type !== "image/jpeg")
    ) {
      throw new Error("Bot Screen observation artifact is unavailable");
    }
    return {
      ...result,
      imageFile: { mediaType: artifact.media_type, path: artifact.path },
    };
  }

  async #cancelPending(pending: PendingAgentTool, error: Error): Promise<void> {
    if (pending.cancellation !== undefined || pending.phase === "settled") return;
    pending.cancellation = error;
    const held = pending.phase === "held" || pending.phase === "completing";
    pending.phase = "settled";
    if (held) {
      await this.revokeWebControl(pending.owner.surfaceId).catch(() => {});
      this.#releaseHumanLease(pending);
    }
    pending.activated.reject(error);
    pending.completion.reject(error);
    this.#event(pending.owner);
  }

  #releaseHumanLease(pending: PendingAgentTool): void {
    const lease = this.#lease(pending.owner.surfaceId);
    if (
      lease?.holder_is_human
      && lease.turn_id === pending.turnId
    ) {
      this.#writeLease(pending.owner, undefined);
    }
  }

  async #serializeAgentOperation<T>(
    surfaceId: SurfaceId,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#agentOperations.get(surfaceId) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    const settled = result.then(
      () => {},
      () => {},
    );
    this.#agentOperations.set(surfaceId, settled);
    try {
      return await result;
    } finally {
      if (this.#agentOperations.get(surfaceId) === settled) {
        this.#agentOperations.delete(surfaceId);
      }
    }
  }

}

