import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Database } from "bun:sqlite";
import { isInputAction, isSurfaceId, type ComputerAction, type SurfaceId } from "@omarchy-bot/domain";
import type { EventLog } from "../events/eventLog.ts";
import type { BotScreenManager } from "./botScreenManager.ts";


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
  screenUse: "idle" | "bot" | "human";
  takeover: "unavailable" | "available" | "active";
  lastImageAt?: string;
}

export interface ComputerSurfaceOwner {
  botId: string;
  surfaceId: SurfaceId;
}

/**
 * Coordinates Bot and Web Control for each Computer Surface independently.
 * BotScreenManager owns runtime lifecycle and operation serialization.
 */
export class ComputerBroker {
  #surfaceOperations = new Map<SurfaceId, Promise<void>>();
  #pendingAgentTools = new Map<SurfaceId, PendingAgentTool>();
  #unsubscribeScreens: () => void;

  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly screens: BotScreenManager,
    private readonly artifactsDir: string,
    private readonly revokeWebControl: WebControlRevoker,
  ) {
    this.events.subscribe((event) => {
      if (event.aggregateType !== "bot" || (event.type !== "bot.archived" && event.type !== "bot.deleted")) return;
      const payload = event.payload as { surfaceId?: unknown } | undefined;
      if (typeof payload?.surfaceId !== "string" || !isSurfaceId(payload.surfaceId)) {
        throw new Error("Bot lifecycle event requires a valid Surface");
      }
      this.#clearSurface(payload.surfaceId, "Computer Surface was removed during pending tool");
    });
    this.#unsubscribeScreens = this.screens.subscribe((transition) => {
      if (transition.state === "failed") {
        this.#clearSurface(transition.surfaceId, "Bot Screen became unavailable during pending tool");
      } else if (transition.state === "stopped") {
        this.#clearSurface(transition.surfaceId, "Bot Screen stopped during pending tool");
      }
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


  #requireOwner(owner: ComputerSurfaceOwner): ComputerSurfaceOwner {
    const resolved = this.resolveOwner(owner.botId, owner.surfaceId);
    if (resolved === undefined) throw new Error("unknown, archived, or mismatched Computer Surface owner");
    return resolved;
  }

  #event(owner: ComputerSurfaceOwner): void {
    this.events.append("computer", owner.surfaceId, "computer.state.changed", owner);
  }

  state(input: ComputerSurfaceOwner): ComputerBrokerState {
    const owner = this.#requireOwner(input);
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
    const screenUse = takeover === "active" ? "human" as const
      : takeover === "available" ? "bot" as const
      : "idle" as const;
    return {
      ...owner,
      screenUse,
      takeover,
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
      const context = await this.#act(owner, pending.turnId, { name: "observe", args: {} });
      if (pending.cancellation !== undefined) throw pending.cancellation;
      const screenshot = await this.#act(owner, pending.turnId, { name: "screenshot", args: {} });
      if (pending.cancellation !== undefined) throw pending.cancellation;
      const result = await this.#withImageFile(owner, {
        ...context,
        ...screenshot,
        ...(context.text === undefined ? {} : { text: context.text }),
        ...(context.windowList === undefined ? {} : { windowList: context.windowList }),
      });
      pending.phase = "settled";
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
    return pending === undefined || pending.phase === "held";
  }

  async #act(
    input: ComputerSurfaceOwner,
    turnId: string,
    action: ComputerAction,
  ): Promise<{ text?: string; imageRef?: string; windowList?: unknown }> {
    const owner = this.#requireOwner(input);
    const inputAuthority = isInputAction(action.name)
      ? { surfaceId: owner.surfaceId, botId: owner.botId, turnId }
      : undefined;
    const result = await this.screens.act(owner, action, inputAuthority);

    let imageRef: string | undefined;
    if (result.image !== undefined) {
      const id = randomUUID();
      const extension = result.image.mediaType === "image/png" ? "png" : "jpg";
      const artifactPath = path.join(this.artifactsDir, `snapshot-${id}.${extension}`);
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
      ...(result.text !== undefined ? { text: result.text } : {}),
      ...(imageRef !== undefined ? { imageRef } : {}),
      ...(result.windowList !== undefined ? { windowList: result.windowList } : {}),
    };
  }

  /** Executes one SDK computer tool call for its authoritative Bot Screen. */
  async agentToolAct(
    input: ComputerSurfaceOwner,
    turnId: string,
    toolCallId: string,
    action: ComputerAction,
    signal: AbortSignal,
  ): Promise<AgentToolOutput> {
    const owner = this.#requireOwner(input);
    return this.#serializeSurfaceOperation(owner.surfaceId, async () => {
      signal.throwIfAborted();
      this.#requireOwner(owner);

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
          initial = await this.#withImageFile(owner, await this.#act(owner, turnId, action));
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
        this.#event(owner);
      }
    });
  }

  async snapshot(input: ComputerSurfaceOwner): Promise<{ bytes: Uint8Array; mediaType: string } | undefined> {
    const owner = this.#requireOwner(input);
    const result = await this.screens.capture(owner).catch(() => undefined);
    if (result === undefined) return undefined;
    const observedAt = new Date().toISOString();
    this.db
      .query(`UPDATE bot_surfaces SET last_image_at = ? WHERE surface_id = ?`)
      .run(observedAt, owner.surfaceId);
    this.#event(owner);
    return { mediaType: result.mediaType, bytes: result.bytes };
  }

  shutdown(): void {
    this.#unsubscribeScreens();
    for (const pending of this.#pendingAgentTools.values()) {
      const error = new Error("daemon stopped during pending computer tool");
      pending.cancellation = error;
      pending.phase = "settled";
      pending.activated.reject(error);
      pending.completion.reject(error);
    }
    this.#pendingAgentTools.clear();
    this.#surfaceOperations.clear();
  }

  #clearSurface(surfaceId: SurfaceId, reason: string): void {
    const pending = this.#pendingAgentTools.get(surfaceId);
    if (pending !== undefined) {
      void this.#cancelPending(pending, new Error(reason));
    }
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
    if (held) await this.revokeWebControl(pending.owner.surfaceId).catch(() => {});
    pending.activated.reject(error);
    pending.completion.reject(error);
    this.#event(pending.owner);
  }

  async #serializeSurfaceOperation<T>(
    surfaceId: SurfaceId,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.#surfaceOperations.get(surfaceId) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    const settled = result.then(
      () => {},
      () => {},
    );
    this.#surfaceOperations.set(surfaceId, settled);
    try {
      return await result;
    } finally {
      if (this.#surfaceOperations.get(surfaceId) === settled) {
        this.#surfaceOperations.delete(surfaceId);
      }
    }
  }
}
