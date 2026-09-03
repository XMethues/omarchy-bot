import type { Database } from "bun:sqlite";
import type { ComputerAction, SurfaceId } from "@omarchy-bot/domain";
import type { ComputerInputAuthority } from "@omarchy-bot/agent-contract";
import type { ComputerSurfaceOwner } from "./broker.ts";

export type BotScreenLifecycleState = "stopped" | "starting" | "ready" | "failed";

export interface BotScreenCapture {
  mediaType: "image/png" | "image/jpeg";
  bytes: Uint8Array;
}

export interface BotScreenActionResult {
  text?: string;
  image?: BotScreenCapture;
  windowList?: unknown;
}

export type BotScreenInputEvent =
  | { type: "motion"; x: number; y: number }
  | { type: "button"; x: number; y: number; button: "left" | "middle" | "right"; state: "pressed" | "released" }
  | { type: "scroll"; x: number; y: number; deltaX: number; deltaY: number }
  | { type: "key"; keyCode: number; state: "pressed" | "released" }
  | { type: "paste"; text: string };


export interface BotScreenProvision {
  surfaceId: SurfaceId;
  generation: number;
  logicalWidth: number;
  logicalHeight: number;
  scale: number;
  refreshRate: number;
}

export interface BotScreenProjectionSource {
  surfaceId: SurfaceId;
  runtimeGeneration: number;
  geometryGeneration: number;
  logicalWidth: number;
  logicalHeight: number;
  videoWidth: number;
  videoHeight: number;
  scale: number;
  capture(): Promise<BotScreenCapture>;
  input(event: BotScreenInputEvent): Promise<void>;
  releaseInput(): Promise<void>;
}

/** Internal platform seam. Runtime handles keep process and socket facts private. */
export interface BotScreenRuntime {
  capture(): Promise<BotScreenCapture>;
  act(action: ComputerAction, inputAuthority?: ComputerInputAuthority): Promise<BotScreenActionResult>;
  input(event: BotScreenInputEvent): Promise<void>;
  releaseInput(): Promise<void>;
  /** Resolves only when the runtime exits; deliberate stops are ignored by the manager. */
  exited: Promise<Error>;
  stop(): Promise<void>;
}

export interface BotScreenRuntimeAdapter {
  start(provision: BotScreenProvision): Promise<BotScreenRuntime>;
  /** Returns a still-valid supervised runtime after daemon restart, when reconnectable. */
  reconcile?(provision: BotScreenProvision): Promise<BotScreenRuntime | undefined>;
  /** Removes retained runtime/profile resources for permanent Bot deletion. */
  destroy?(surfaceId: SurfaceId): Promise<void>;
}

export interface BotScreenLifecycle {
  state: BotScreenLifecycleState;
  failure?: string;
  admission?: {
    reason: "capacity";
    active: number;
    limit: number;
  };
}

export interface BotScreenManagerOptions {
  capacity: number;
  logicalWidth: number;
  logicalHeight: number;
  frameRate: number;
}

interface SurfaceRow {
  lifecycle_state: BotScreenLifecycleState;
  runtime_generation: number;
  logical_width: number;
  logical_height: number;
  scale: number;
  refresh_rate: number;
  last_failure: string | null;
}

interface RuntimeEntry {
  start: Promise<BotScreenRuntime>;
  provision: BotScreenProvision;
  runtime?: BotScreenRuntime;
}

interface RecoveryRow extends SurfaceRow {
  surface_id: SurfaceId;
  bot_id: string;
  archived: number;
}

export interface BotScreenTransition {
  surfaceId: SurfaceId;
  state: BotScreenLifecycleState;
  runtimeGeneration: number;
  failure?: string;
}

export type BotScreenTransitionListener = (transition: BotScreenTransition) => void;

/**
 * Deep Bot-owned lifecycle module. Callers can open, capture, and stop a Screen;
 * process trees, sockets, runtime directories, output setup, and child env stay
 * inside the runtime adapter.
 */
export class BotScreenManager {
  #entries = new Map<SurfaceId, RuntimeEntry>();
  #stops = new Map<SurfaceId, Promise<void>>();
  #cleanupRuntimes = new Map<SurfaceId, BotScreenRuntime>();
  #operations = new Map<SurfaceId, Promise<void>>();
  #listeners = new Set<BotScreenTransitionListener>();

  constructor(
    private readonly db: Database,
    private readonly adapter: BotScreenRuntimeAdapter,
    private readonly options: BotScreenManagerOptions,
  ) {
    if (!Number.isSafeInteger(options.capacity) || options.capacity < 1) {
      throw new Error("Bot Screen capacity must be a positive integer");
    }
  }

  subscribe(listener: BotScreenTransitionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Reconciles Screens which were active, or still cleaning up a failure, when
   * the daemon stopped. An adapter may reconnect a complete supervised tree;
   * otherwise the manager removes stale runtime facts and advances active
   * Screens to a fresh generation.
   */
  async recover(): Promise<void> {
    const rows = this.db
      .query(
        `SELECT bot_surfaces.surface_id, bot_surfaces.bot_id, bots.archived,
                bot_surfaces.lifecycle_state, bot_surfaces.runtime_generation,
                bot_surfaces.logical_width, bot_surfaces.logical_height,
                bot_surfaces.scale, bot_surfaces.refresh_rate, bot_surfaces.last_failure
         FROM bot_surfaces
         JOIN bots ON bots.id = bot_surfaces.bot_id
         WHERE bot_surfaces.lifecycle_state IN ('starting', 'ready', 'failed')
         ORDER BY bot_surfaces.transitioned_at, bot_surfaces.surface_id`,
      )
      .all() as RecoveryRow[];

    for (const row of rows) {
      await this.#serialize(row.surface_id, async () => {
        const provision = this.#provision(row.surface_id, row.runtime_generation, row);
        const runtime = await this.adapter.reconcile?.(provision).catch(() => undefined);
        if (row.archived) {
          await runtime?.releaseInput().catch(() => {});
          await runtime?.stop().catch(() => {});
          this.#transition(row.surface_id, "stopped", null);
          return;
        }
        if (row.lifecycle_state === "failed") {
          await runtime?.releaseInput().catch(() => {});
          await runtime?.stop().catch(() => {});
          this.#transition(row.surface_id, "failed", row.last_failure);
          return;
        }
        if (this.#reservedCapacity() >= this.options.capacity) {
          await runtime?.releaseInput().catch(() => {});
          await runtime?.stop().catch(() => {});
          this.#transition(row.surface_id, "stopped", null);
          return;
        }
        if (runtime !== undefined) {
          this.#install(row.surface_id, provision, Promise.resolve(runtime), runtime);
          return;
        }
        this.#transition(row.surface_id, "stopped", null);
        await this.#start({ botId: row.bot_id, surfaceId: row.surface_id }, this.#row(row.surface_id));
      });
    }
  }

  open(owner: ComputerSurfaceOwner): BotScreenLifecycle {
    if (this.#stops.has(owner.surfaceId)) return { state: "stopped" };
    let row = this.#row(owner.surfaceId);
    const entry = this.#entries.get(owner.surfaceId);

    if ((row.lifecycle_state === "ready" || row.lifecycle_state === "starting") && entry === undefined) {
      this.#transition(owner.surfaceId, "stopped", null);
      row = this.#row(owner.surfaceId);
    }
    if (row.lifecycle_state !== "stopped") return this.#lifecycle(row);
    const active = this.#reservedCapacity();
    if (active >= this.options.capacity) {
      return {
        state: "stopped",
        admission: { reason: "capacity", active, limit: this.options.capacity },
      };
    }


    void this.#start(owner, row);
    return { state: "starting" };
  }

  state(owner: ComputerSurfaceOwner): BotScreenLifecycle {
    return this.#lifecycle(this.#row(owner.surfaceId));
  }

  async capture(owner: ComputerSurfaceOwner): Promise<BotScreenCapture | undefined> {
    return this.#serialize(owner.surfaceId, async () => {
      const runtime = await this.#readyRuntime(owner);
      const entry = this.#entries.get(owner.surfaceId);
      if (runtime === undefined || entry?.runtime !== runtime) return undefined;
      return this.#invoke(owner.surfaceId, entry, () => runtime.capture());
    });
  }

  async projectionSource(owner: ComputerSurfaceOwner): Promise<BotScreenProjectionSource | undefined> {
    return this.#serialize(owner.surfaceId, async () => {
      const runtime = await this.#readyRuntime(owner);
      const entry = this.#entries.get(owner.surfaceId);
      if (runtime === undefined || entry?.runtime !== runtime) return undefined;
      const generation = this.#row(owner.surfaceId).runtime_generation;
      const geometryGeneration = 1;
      const { logicalWidth, logicalHeight, scale } = entry.provision;
      const currentEntry = (): RuntimeEntry => {
        const row = this.#row(owner.surfaceId);
        if (
          row.lifecycle_state !== "ready"
          || row.runtime_generation !== generation
          || this.#entries.get(owner.surfaceId) !== entry
          || entry.runtime !== runtime
        ) {
          throw new Error("Screen Projection source is stale");
        }
        return entry;
      };
      return {
        surfaceId: owner.surfaceId,
        runtimeGeneration: generation,
        geometryGeneration,
        logicalWidth,
        logicalHeight,
        videoWidth: Math.round(logicalWidth * scale),
        videoHeight: Math.round(logicalHeight * scale),
        scale,
        capture: () =>
          this.#serialize(owner.surfaceId, () =>
            this.#invoke(owner.surfaceId, currentEntry(), () => runtime.capture())
          ),
        input: (event) =>
          this.#serialize(owner.surfaceId, () =>
            this.#invoke(owner.surfaceId, currentEntry(), () => runtime.input(event))
          ),
        releaseInput: () =>
          this.#serialize(owner.surfaceId, () =>
            this.#invoke(owner.surfaceId, currentEntry(), () => runtime.releaseInput())
          ),
      };
    });
  }

  async act(
    owner: ComputerSurfaceOwner,
    action: ComputerAction,
    inputAuthority?: ComputerInputAuthority,
  ): Promise<BotScreenActionResult> {
    if (inputAuthority !== undefined && inputAuthority.surfaceId !== owner.surfaceId) {
      throw new Error("input authority does not belong to this Computer Surface");
    }
    return this.#serialize(owner.surfaceId, async () => {
      const runtime = await this.#readyRuntime(owner);
      const entry = this.#entries.get(owner.surfaceId);
      if (runtime === undefined || entry?.runtime !== runtime) {
        throw new Error(this.state(owner).failure ?? "Bot Screen is unavailable");
      }
      return this.#invoke(owner.surfaceId, entry, () => runtime.act(action, inputAuthority));
    });
  }

  async ensureReady(owner: ComputerSurfaceOwner): Promise<boolean> {
    return (await this.#readyRuntime(owner)) !== undefined;
  }

  async stop(surfaceId: SurfaceId): Promise<void> {
    const activeStop = this.#stops.get(surfaceId);
    if (activeStop !== undefined) return activeStop;
    const operation = this.#serialize(surfaceId, () => this.#stopSurface(surfaceId));
    this.#stops.set(surfaceId, operation);
    try {
      await operation;
    } finally {
      if (this.#stops.get(surfaceId) === operation) this.#stops.delete(surfaceId);
    }
  }

  async destroy(surfaceId: SurfaceId): Promise<void> {
    await this.stop(surfaceId);
    try {
      await this.adapter.destroy?.(surfaceId);
    } catch (error) {
      if (this.#exists(surfaceId)) this.#transition(surfaceId, "failed", this.#failure(error));
      throw error;
    }
  }
  async shutdown(): Promise<void> {
    const surfaceIds = new Set([
      ...this.#entries.keys(),
      ...this.#cleanupRuntimes.keys(),
      ...this.#stops.keys(),
      ...this.#operations.keys(),
    ]);
    await Promise.all([...surfaceIds].map((surfaceId) => this.stop(surfaceId)));
  }

  /** Leaves supervised runtime trees alive for a replacement daemon to reconcile. */
  detach(): void {
    this.#entries.clear();
    this.#cleanupRuntimes.clear();
    this.#stops.clear();
    this.#operations.clear();
  }

  async #start(owner: ComputerSurfaceOwner, row: SurfaceRow): Promise<void> {
    if (this.#entries.has(owner.surfaceId)) return;
    const generation = row.runtime_generation + 1;
    this.db
      .query(
        `UPDATE bot_surfaces
         SET lifecycle_state = 'starting', runtime_generation = ?, last_failure = NULL, transitioned_at = ?
         WHERE surface_id = ?`,
      )
      .run(generation, new Date().toISOString(), owner.surfaceId);

    const provision = this.#provision(owner.surfaceId, generation, row);
    const start = Promise.resolve().then(() => this.adapter.start(provision));
    const entry: RuntimeEntry = { provision, start };
    this.#entries.set(owner.surfaceId, entry);
    try {
      const runtime = await start;
      if (this.#entries.get(owner.surfaceId) !== entry) {
        await runtime.releaseInput().catch(() => {});
        await runtime.stop();
        return;
      }
      this.#install(owner.surfaceId, provision, start, runtime);
    } catch (error) {
      if (this.#entries.get(owner.surfaceId) !== entry) return;
      this.#entries.delete(owner.surfaceId);
      this.#transition(owner.surfaceId, "failed", this.#failure(error));
    }
  }

  #install(
    surfaceId: SurfaceId,
    provision: BotScreenProvision,
    start: Promise<BotScreenRuntime>,
    runtime: BotScreenRuntime,
  ): void {
    const entry: RuntimeEntry = { provision, start, runtime };
    this.#entries.set(surfaceId, entry);
    this.#transition(surfaceId, "ready", null);
    void runtime.exited.then((error) => this.#failRuntime(surfaceId, entry, error));
  }

  async #stopSurface(surfaceId: SurfaceId): Promise<void> {
    const entry = this.#entries.get(surfaceId);
    this.#entries.delete(surfaceId);
    const activeRuntime = entry === undefined
      ? undefined
      : entry.runtime ?? await entry.start.catch(() => undefined);
    const cleanupRuntime = this.#cleanupRuntimes.get(surfaceId);
    try {
      for (const runtime of new Set([activeRuntime, cleanupRuntime])) {
        if (runtime === undefined) continue;
        await runtime.releaseInput().catch(() => {});
        await runtime.stop();
      }
      this.#cleanupRuntimes.delete(surfaceId);
      if (this.#exists(surfaceId)) this.#transition(surfaceId, "stopped", null);
    } catch (error) {
      const runtime = cleanupRuntime ?? activeRuntime;
      if (runtime !== undefined) this.#cleanupRuntimes.set(surfaceId, runtime);
      if (this.#exists(surfaceId)) this.#transition(surfaceId, "failed", this.#failure(error));
      throw error;
    }
  }

  async #readyRuntime(owner: ComputerSurfaceOwner): Promise<BotScreenRuntime | undefined> {
    const lifecycle = this.open(owner);
    if (lifecycle.state === "failed" || lifecycle.state === "stopped") return undefined;
    const entry = this.#entries.get(owner.surfaceId);
    if (entry === undefined) return undefined;
    await entry.start.catch(() => undefined);
    return this.#entries.get(owner.surfaceId)?.runtime;
  }

  async #invoke<T>(surfaceId: SurfaceId, entry: RuntimeEntry, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (this.#entries.get(surfaceId) === entry) await this.#failRuntime(surfaceId, entry, error);
      throw error;
    }
  }

  async #failRuntime(surfaceId: SurfaceId, entry: RuntimeEntry, error: unknown): Promise<void> {
    if (this.#entries.get(surfaceId) !== entry) return;
    this.#entries.delete(surfaceId);
    if (this.#exists(surfaceId)) this.#transition(surfaceId, "failed", this.#failure(error));
    const runtime = entry.runtime ?? await entry.start.catch(() => undefined);
    if (runtime === undefined) return;
    this.#cleanupRuntimes.set(surfaceId, runtime);
    await runtime.releaseInput().catch(() => {});
    try {
      await runtime.stop();
      if (this.#cleanupRuntimes.get(surfaceId) === runtime) this.#cleanupRuntimes.delete(surfaceId);
    } catch {
      // stop()/destroy() will retry this retained failed-runtime handle.
    }
  }

  #provision(surfaceId: SurfaceId, generation: number, _row: SurfaceRow): BotScreenProvision {
    return {
      surfaceId,
      generation,
      logicalWidth: this.options.logicalWidth,
      logicalHeight: this.options.logicalHeight,
      scale: 1,
      refreshRate: this.options.frameRate,
    };
  }

  #row(surfaceId: SurfaceId): SurfaceRow {
    const row = this.db
      .query(
        `SELECT lifecycle_state, runtime_generation, logical_width, logical_height, scale, refresh_rate, last_failure
         FROM bot_surfaces WHERE surface_id = ?`,
      )
      .get(surfaceId) as SurfaceRow | null;
    if (row === null) throw new Error("unknown Computer Surface");
    return row;
  }

  #exists(surfaceId: SurfaceId): boolean {
    return this.db.query(`SELECT 1 FROM bot_surfaces WHERE surface_id = ?`).get(surfaceId) !== null;
  }

  #transition(surfaceId: SurfaceId, state: BotScreenLifecycleState, failure: string | null): void {
    this.db
      .query(
        `UPDATE bot_surfaces
         SET lifecycle_state = ?, last_failure = ?, transitioned_at = ?
         WHERE surface_id = ?`,
      )
      .run(state, failure, new Date().toISOString(), surfaceId);
    const runtimeGeneration = this.#row(surfaceId).runtime_generation;
    const transition: BotScreenTransition = {
      surfaceId,
      state,
      runtimeGeneration,
      ...(failure === null ? {} : { failure }),
    };
    for (const listener of this.#listeners) listener(transition);
  }

  #reservedCapacity(): number {
    return new Set([
      ...this.#entries.keys(),
      ...this.#stops.keys(),
      ...this.#cleanupRuntimes.keys(),
    ]).size;
  }

  #lifecycle(row: SurfaceRow): BotScreenLifecycle {
    return {
      state: row.lifecycle_state,
      ...(row.last_failure === null ? {} : { failure: row.last_failure }),
    };
  }

  async #serialize<T>(surfaceId: SurfaceId, operation: () => Promise<T>): Promise<T> {
    const previous = this.#operations.get(surfaceId) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(operation);
    const settled = result.then(
      () => {},
      () => {},
    );
    this.#operations.set(surfaceId, settled);
    try {
      return await result;
    } finally {
      if (this.#operations.get(surfaceId) === settled) this.#operations.delete(surfaceId);
    }
  }

  #failure(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/[\r\n]+/g, " ").slice(0, 240) || "Bot Screen could not start";
  }
}
