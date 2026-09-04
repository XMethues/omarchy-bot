import type { SurfaceId } from "@omarchy-bot/domain";
import { BotScreenInputRejectedError } from "./botScreenManager.ts";
import type {
  BotScreenCapture,
  BotScreenCaptureStream,
  BotScreenInputEvent,
  BotScreenProvision,
  BotScreenRuntime,
  BotScreenRuntimeOutcome,
  BotScreenRuntimeAdapter,
} from "./botScreenManager.ts";


type FakePointerEvent = Extract<BotScreenInputEvent, { type: "motion" | "button" | "scroll" }>;
const FAKE_SCREEN_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWMQMgn7D8IAC5MDN627upEAAAAASUVORK5CYII=",
  "base64",
);


interface FakeBotScreenRuntimeOptions {
  pointerDelayMs?: number;
  inputFailureAt?: number;
  releaseDelayMs?: number;
}

interface FakeRuntimeRecord {
  provision: BotScreenProvision;
  runtime: BotScreenRuntime;
  finish(outcome: BotScreenRuntimeOutcome): void;
}
/** Deterministic in-process platform adapter used by daemon integration tests. */
export class FakeBotScreenRuntimeAdapter implements BotScreenRuntimeAdapter {
  readonly pointerEvents: Array<{ surfaceId: string; runtimeGeneration: number; event: FakePointerEvent }> = [];
  readonly inputEvents: Array<{ surfaceId: string; runtimeGeneration: number; event: BotScreenInputEvent }> = [];
  releaseCount = 0;
  readonly starts: BotScreenProvision[] = [];
  readonly stops: Array<{ surfaceId: string; runtimeGeneration: number }> = [];
  readonly destroyed = new Set<string>();
  captureStreamsOpened = 0;
  captureStreamsClosed = 0;
  captureRequestsInFlight = 0;
  maximumCaptureRequestsInFlight = 0;
  #unreconciled = new Set<string>();
  #runtimes = new Map<string, FakeRuntimeRecord>();
  #pointerWaiters: Array<{ count: number; resolve: () => void }> = [];
  #inputWaiters: Array<{ count: number; resolve: () => void }> = [];
  #pointerEventWaiters: Array<{
    predicate: (event: { surfaceId: string; runtimeGeneration: number; event: FakePointerEvent }) => boolean;
    resolve: () => void;
  }> = [];
  #inputAttempts = 0;
  #releaseWaiters: Array<{ count: number; resolve: () => void }> = [];
  #captureStreamCloseWaiters: Array<{ count: number; resolve: () => void }> = [];
  #captureStreamFailures = new Set<string>();
  #blockActions = false;
  #actionsStarted = 0;
  #actionWaiters: Array<{ count: number; resolve: () => void }> = [];
  #actionGate = Promise.withResolvers<void>();

  constructor(
    private readonly failure?: string,
    private readonly options: FakeBotScreenRuntimeOptions = {},
  ) {}

  blockActions(): void {
    this.#blockActions = true;
    this.#actionGate = Promise.withResolvers<void>();
  }

  waitForActions(count: number): Promise<void> {
    if (this.#actionsStarted >= count) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.#actionWaiters.push({ count, resolve });
    return promise;
  }

  releaseActions(): void {
    this.#blockActions = false;
    this.#actionGate.resolve();
  }


  waitForInputEvents(count: number): Promise<void> {
    if (this.inputEvents.length >= count) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.#inputWaiters.push({ count, resolve });
    return promise;
  }

  waitForPointerEvents(count: number): Promise<void> {
    if (this.pointerEvents.length >= count) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.#pointerWaiters.push({ count, resolve });
    return promise;
  }

  waitForPointerEvent(
    predicate: (event: { surfaceId: string; runtimeGeneration: number; event: FakePointerEvent }) => boolean,
  ): Promise<void> {
    if (this.pointerEvents.some(predicate)) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.#pointerEventWaiters.push({ predicate, resolve });
    return promise;
  }

  waitForReleases(count: number): Promise<void> {
    if (this.releaseCount >= count) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.#releaseWaiters.push({ count, resolve });
    return promise;
  }

  waitForCaptureStreamsClosed(count: number): Promise<void> {
    if (this.captureStreamsClosed >= count) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.#captureStreamCloseWaiters.push({ count, resolve });
    return promise;
  }

  failNextCaptureStreamFrame(surfaceId: string): void {
    this.#captureStreamFailures.add(surfaceId);
  }

  running(surfaceId: string): { generation: number } | undefined {
    const record = this.#runtimes.get(surfaceId);
    return record === undefined ? undefined : { generation: record.provision.generation };
  }

  runtimeOutcome(surfaceId: string): Promise<BotScreenRuntimeOutcome> {
    const record = this.#runtimes.get(surfaceId);
    if (record === undefined) throw new Error("fake Bot Screen is not running");
    return record.runtime.outcome;
  }

  crash(surfaceId: string, message: string): void {
    this.#finish(surfaceId, { type: "computer-worker-exited", error: new Error(message) });
  }

  exitApplication(surfaceId: string, message = "fake Bot Screen application exited"): void {
    this.#finish(surfaceId, { type: "application-exited", error: new Error(message) });
  }

  exitDesktop(surfaceId: string, message = "fake Bot Desktop exited"): void {
    this.#finish(surfaceId, { type: "desktop-exited", error: new Error(message) });
  }

  exitCompositor(surfaceId: string, message = "fake Bot Screen compositor exited"): void {
    this.#finish(surfaceId, { type: "compositor-exited", error: new Error(message) });
  }

  #finish(surfaceId: string, outcome: BotScreenRuntimeOutcome): void {
    const record = this.#runtimes.get(surfaceId);
    if (record === undefined) throw new Error("fake Bot Screen is not running");
    record.finish(outcome);
  }

  rejectReconciliation(surfaceId: string): void {
    this.#unreconciled.add(surfaceId);
  }


  async reconcile(provision: BotScreenProvision): Promise<BotScreenRuntime | undefined> {
    const record = this.#runtimes.get(provision.surfaceId);
    if (record === undefined || record.provision.generation !== provision.generation) return undefined;
    if (!this.#unreconciled.delete(provision.surfaceId)) return record.runtime;
    await record.runtime.stop();
    return undefined;
  }

  async destroy(surfaceId: SurfaceId): Promise<void> {
    await this.#runtimes.get(surfaceId)?.runtime.stop();
    this.destroyed.add(surfaceId);
  }

  async start(provision: BotScreenProvision): Promise<BotScreenRuntime> {
    await Promise.resolve();
    if (this.failure !== undefined) throw new Error(this.failure);
    this.starts.push(provision);
    let stopped = false;
    let controllerEpoch: number | undefined;
    let highestControllerEpoch = 0;
    let lastInputSequence = 0;
    let actionCount = 0;
    const outcome = Promise.withResolvers<BotScreenRuntimeOutcome>();
    let record!: FakeRuntimeRecord;
    const captureStreams = new Set<BotScreenCaptureStream>();
    const runtime: BotScreenRuntime = {
      readiness: {
        compositor: "ready",
        waylandSocket: "private",
        output: {
          geometryGeneration: provision.geometryGeneration,
          logicalWidth: provision.logicalWidth,
          logicalHeight: provision.logicalHeight,
          scale: provision.scale,
          refreshRate: provision.refreshRate,
        },
        desktopSurface: "ready",
        capture: "ready",
        input: "ready",
        computerWorker: "ready",
      },
      capture: async (): Promise<BotScreenCapture> => {
        if (stopped) throw new Error("fake Bot Screen is stopped");
        return { mediaType: "image/png", bytes: FAKE_SCREEN_PNG };
      },
      openCaptureStream: async (): Promise<BotScreenCaptureStream> => {
        if (stopped) throw new Error("fake Bot Screen is stopped");
        this.captureStreamsOpened += 1;
        let closed = false;
        const stream: BotScreenCaptureStream = {
          next: async () => {
            if (closed || stopped) throw new Error("fake Bot Screen capture stream is closed");
            this.captureRequestsInFlight += 1;
            this.maximumCaptureRequestsInFlight = Math.max(
              this.maximumCaptureRequestsInFlight,
              this.captureRequestsInFlight,
            );
            try {
              await Promise.resolve();
              if (this.#captureStreamFailures.delete(provision.surfaceId)) {
                throw new Error("fake Bot Screen capture stream failed");
              }
              return {
                mediaType: "image/png",
                bytes: FAKE_SCREEN_PNG,
                capturedAt: new Date(),
              };
            } finally {
              this.captureRequestsInFlight -= 1;
            }
          },
          close: async () => {
            if (closed) return;
            closed = true;
            captureStreams.delete(stream);
            this.captureStreamsClosed += 1;
            for (const waiter of this.#captureStreamCloseWaiters.splice(0)) {
              if (this.captureStreamsClosed >= waiter.count) waiter.resolve();
              else this.#captureStreamCloseWaiters.push(waiter);
            }
          },
        };
        captureStreams.add(stream);
        return stream;
      },
      act: async (action) => {
        if (stopped) throw new Error("fake Bot Screen is stopped");
        actionCount += 1;
        this.#actionsStarted += 1;
        for (const waiter of this.#actionWaiters.splice(0)) {
          if (this.#actionsStarted >= waiter.count) waiter.resolve();
          else this.#actionWaiters.push(waiter);
        }
        if (this.#blockActions) await this.#actionGate.promise;
        return {
          text: `fake-${action.name}#${actionCount}`,
          ...(action.name === "list_windows" ? { windowList: [] } : {}),
          ...(action.name === "screenshot"
            ? { image: { mediaType: "image/png" as const, bytes: FAKE_SCREEN_PNG } }
            : {}),
        };
      },
      setInputAuthority: async (epoch): Promise<void> => {
        if (!Number.isSafeInteger(epoch) || epoch <= highestControllerEpoch) {
          throw new BotScreenInputRejectedError("fake Bot Screen rejected stale input authority");
        }
        controllerEpoch = epoch;
        highestControllerEpoch = epoch;
        lastInputSequence = 0;
      },
      input: async (event): Promise<void> => {
        this.#inputAttempts += 1;
        if (
          event.surfaceId !== provision.surfaceId
          || event.runtimeGeneration !== provision.generation
          || event.geometryGeneration !== provision.geometryGeneration
          || event.controllerEpoch !== controllerEpoch
          || !Number.isSafeInteger(event.sequence)
          || event.sequence <= lastInputSequence
        ) {
          throw new BotScreenInputRejectedError("fake Bot Screen rejected the input envelope");
        }
        if (this.options.inputFailureAt === this.#inputAttempts) {
          throw new Error("fake Bot Screen input helper failed");
        }
        if (stopped) throw new Error("fake Bot Screen is stopped");
        lastInputSequence = event.sequence;
        if (this.options.pointerDelayMs !== undefined && event.type === "motion") {
          await Bun.sleep(this.options.pointerDelayMs);
        }
        const recorded = {
          surfaceId: provision.surfaceId,
          runtimeGeneration: provision.generation,
          event,
        };
        this.inputEvents.push(recorded);
        for (const waiter of this.#inputWaiters.splice(0)) {
          if (this.inputEvents.length >= waiter.count) waiter.resolve();
          else this.#inputWaiters.push(waiter);
        }
        if (event.type === "key" || event.type === "paste") return;
        this.pointerEvents.push({
          surfaceId: provision.surfaceId,
          runtimeGeneration: provision.generation,
          event,
        });
        for (const waiter of this.#pointerWaiters.splice(0)) {
          if (this.pointerEvents.length >= waiter.count) waiter.resolve();
          else this.#pointerWaiters.push(waiter);
        }
        for (const waiter of this.#pointerEventWaiters.splice(0)) {
          if (waiter.predicate(this.pointerEvents.at(-1)!)) waiter.resolve();
          else this.#pointerEventWaiters.push(waiter);
        }
      },
      releaseInput: async (epoch): Promise<void> => {
        if (stopped) return;
        if (epoch !== undefined && epoch !== controllerEpoch) {
          throw new BotScreenInputRejectedError("fake Bot Screen rejected stale input authority release");
        }
        controllerEpoch = undefined;
        lastInputSequence = 0;
        if (this.options.releaseDelayMs !== undefined) await Bun.sleep(this.options.releaseDelayMs);
        this.releaseCount += 1;
        for (const waiter of this.#releaseWaiters.splice(0)) {
          if (this.releaseCount >= waiter.count) waiter.resolve();
          else this.#releaseWaiters.push(waiter);
        }
      },
      outcome: outcome.promise,
      stop: async (): Promise<void> => {
        if (stopped) return;
        stopped = true;
        this.stops.push({ surfaceId: provision.surfaceId, runtimeGeneration: provision.generation });
        await Promise.allSettled([...captureStreams].map((stream) => stream.close()));
        if (this.#runtimes.get(provision.surfaceId) === record) this.#runtimes.delete(provision.surfaceId);
      },
    };
    record = { provision, runtime, finish: outcome.resolve };
    this.#runtimes.set(provision.surfaceId, record);
    return runtime;
  }
}
