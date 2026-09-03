import type {
  BotScreenCapture,
  BotScreenInputEvent,
  BotScreenProvision,
  BotScreenRuntime,
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
/** Deterministic in-process platform adapter used by daemon integration tests. */
export class FakeBotScreenRuntimeAdapter implements BotScreenRuntimeAdapter {
  readonly pointerEvents: Array<{ surfaceId: string; runtimeGeneration: number; event: FakePointerEvent }> = [];
  readonly inputEvents: Array<{ surfaceId: string; runtimeGeneration: number; event: BotScreenInputEvent }> = [];
  releaseCount = 0;
  #pointerWaiters: Array<{ count: number; resolve: () => void }> = [];
  #inputWaiters: Array<{ count: number; resolve: () => void }> = [];
  #pointerEventWaiters: Array<{
    predicate: (event: { surfaceId: string; runtimeGeneration: number; event: FakePointerEvent }) => boolean;
    resolve: () => void;
  }> = [];
  #inputAttempts = 0;
  #releaseWaiters: Array<{ count: number; resolve: () => void }> = [];
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
  async start(provision: BotScreenProvision): Promise<BotScreenRuntime> {
    await Promise.resolve();
    if (this.failure !== undefined) throw new Error(this.failure);
    let stopped = false;
    let actionCount = 0;
    const exited = new Promise<Error>(() => {});
    return {
      capture: async (): Promise<BotScreenCapture> => {
        if (stopped) throw new Error("fake Bot Screen is stopped");
        return { mediaType: "image/png", bytes: FAKE_SCREEN_PNG };
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
      input: async (event): Promise<void> => {
        this.#inputAttempts += 1;
        if (this.options.inputFailureAt === this.#inputAttempts) {
          throw new Error("fake Bot Screen input helper failed");
        }
        if (stopped) throw new Error("fake Bot Screen is stopped");
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
      releaseInput: async (): Promise<void> => {
        if (stopped) return;
        if (this.options.releaseDelayMs !== undefined) await Bun.sleep(this.options.releaseDelayMs);
        this.releaseCount += 1;
        for (const waiter of this.#releaseWaiters.splice(0)) {
          if (this.releaseCount >= waiter.count) waiter.resolve();
          else this.#releaseWaiters.push(waiter);
        }
      },
      exited,
      stop: async (): Promise<void> => {
        stopped = true;
      },
    };
  }
}
