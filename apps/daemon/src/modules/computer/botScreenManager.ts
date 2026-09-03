import type { Database } from "bun:sqlite";
import type { ComputerAction, SurfaceId } from "@omarchy-bot/domain";
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

export interface BotScreenInputLease {
  surfaceId: SurfaceId;
  holder: { botId: string } | "human";
  turnId?: string;
  token: string;
}

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
  act(action: ComputerAction, lease?: BotScreenInputLease): Promise<BotScreenActionResult>;
  input(event: BotScreenInputEvent): Promise<void>;
  releaseInput(): Promise<void>;
  /** Resolves only when the runtime exits; deliberate stops are ignored by the manager. */
  exited: Promise<Error>;
  stop(): Promise<void>;
}

export interface BotScreenRuntimeAdapter {
  start(provision: BotScreenProvision): Promise<BotScreenRuntime>;
}

export interface BotScreenLifecycle {
  state: BotScreenLifecycleState;
  failure?: string;
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

/**
 * Deep Bot-owned lifecycle module. Callers can open, capture, and stop a Screen;
 * process trees, sockets, runtime directories, output setup, and child env stay
 * inside the runtime adapter.
 */
export class BotScreenManager {
  #entries = new Map<SurfaceId, RuntimeEntry>();
  #stops = new Map<SurfaceId, Promise<void>>();
  #operations = new Map<SurfaceId, Promise<void>>();

  constructor(
    private readonly db: Database,
    private readonly adapter: BotScreenRuntimeAdapter,
  ) {}

  open(owner: ComputerSurfaceOwner): BotScreenLifecycle {
    let row = this.#row(owner.surfaceId);
    const entry = this.#entries.get(owner.surfaceId);

    if (row.lifecycle_state === "ready" && entry === undefined) {
      this.#transition(owner.surfaceId, "stopped", null);
      row = this.#row(owner.surfaceId);
    }
    if (row.lifecycle_state !== "stopped") return this.#lifecycle(row);

    const generation = row.runtime_generation + 1;
    this.db
      .query(
        `UPDATE bot_surfaces
         SET lifecycle_state = 'starting', runtime_generation = ?, last_failure = NULL, transitioned_at = ?
         WHERE surface_id = ?`,
      )
      .run(generation, new Date().toISOString(), owner.surfaceId);

    const provision: BotScreenProvision = {
      surfaceId: owner.surfaceId,
      generation,
      logicalWidth: row.logical_width,
      logicalHeight: row.logical_height,
      scale: row.scale,
      refreshRate: row.refresh_rate,
    };
    const entryToStart: RuntimeEntry = {
      provision,
      start: Promise.resolve().then(() => this.adapter.start(provision)),
    };
    this.#entries.set(owner.surfaceId, entryToStart);
    void entryToStart.start.then(
      async (runtime) => {
        if (this.#entries.get(owner.surfaceId) !== entryToStart) {
          await runtime.stop();
          return;
        }
        entryToStart.runtime = runtime;
        this.#transition(owner.surfaceId, "ready", null);
        void runtime.exited.then(async (error) => {
          if (this.#entries.get(owner.surfaceId) !== entryToStart) return;
          this.#entries.delete(owner.surfaceId);
          this.#transition(owner.surfaceId, "failed", this.#failure(error));
          await runtime.stop().catch(() => {});
        });
      },
      (error: unknown) => {
        if (this.#entries.get(owner.surfaceId) !== entryToStart) return;
        this.#entries.delete(owner.surfaceId);
        this.#transition(owner.surfaceId, "failed", this.#failure(error));
      },
    );
    return { state: "starting" };
  }

  state(owner: ComputerSurfaceOwner): BotScreenLifecycle {
    return this.#lifecycle(this.#row(owner.surfaceId));
  }

  async capture(owner: ComputerSurfaceOwner): Promise<BotScreenCapture | undefined> {
    return this.#serialize(owner.surfaceId, async () => {
      const runtime = await this.#readyRuntime(owner);
      return runtime?.capture();
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
      const currentRuntime = async (): Promise<BotScreenRuntime> => {
        const row = this.#row(owner.surfaceId);
        if (
          row.lifecycle_state !== "ready"
          || row.runtime_generation !== generation
          || this.#entries.get(owner.surfaceId) !== entry
          || entry.runtime !== runtime
        ) {
          throw new Error("Screen Projection source is stale");
        }
        return runtime;
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
          this.#serialize(owner.surfaceId, async () => (await currentRuntime()).capture()),
        input: (event) =>
          this.#serialize(owner.surfaceId, async () => (await currentRuntime()).input(event)),
        releaseInput: () =>
          this.#serialize(owner.surfaceId, async () => (await currentRuntime()).releaseInput()),
      };
    });
  }

  async act(
    owner: ComputerSurfaceOwner,
    action: ComputerAction,
    lease?: BotScreenInputLease,
  ): Promise<BotScreenActionResult> {
    if (lease !== undefined && lease.surfaceId !== owner.surfaceId) {
      throw new Error("input lease does not belong to this Computer Surface");
    }
    return this.#serialize(owner.surfaceId, async () => {
      const runtime = await this.#readyRuntime(owner);
      if (runtime === undefined) throw new Error(this.state(owner).failure ?? "Bot Screen is unavailable");
      return runtime.act(action, lease);
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

  async shutdown(): Promise<void> {
    const surfaceIds = new Set([...this.#entries.keys(), ...this.#stops.keys(), ...this.#operations.keys()]);
    await Promise.all([...surfaceIds].map((surfaceId) => this.stop(surfaceId)));
  }

  async #stopSurface(surfaceId: SurfaceId): Promise<void> {
    const entry = this.#entries.get(surfaceId);
    this.#entries.delete(surfaceId);
    if (entry !== undefined) {
      const runtime = entry.runtime ?? await entry.start.catch(() => undefined);
      await runtime?.stop();
    }
    const exists = this.db.query(`SELECT 1 FROM bot_surfaces WHERE surface_id = ?`).get(surfaceId) !== null;
    if (exists) this.#transition(surfaceId, "stopped", null);
  }

  async #readyRuntime(owner: ComputerSurfaceOwner): Promise<BotScreenRuntime | undefined> {
    const lifecycle = this.open(owner);
    if (lifecycle.state === "failed") return undefined;
    const entry = this.#entries.get(owner.surfaceId);
    if (entry === undefined) return undefined;
    await entry.start.catch(() => undefined);
    return this.#entries.get(owner.surfaceId)?.runtime;
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

  #transition(surfaceId: SurfaceId, state: BotScreenLifecycleState, failure: string | null): void {
    this.db
      .query(
        `UPDATE bot_surfaces
         SET lifecycle_state = ?, last_failure = ?, transitioned_at = ?
         WHERE surface_id = ?`,
      )
      .run(state, failure, new Date().toISOString(), surfaceId);
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
