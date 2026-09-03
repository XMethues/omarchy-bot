import type {
  BotScreenCapture,
  BotScreenPointerEvent,
  BotScreenProvision,
  BotScreenRuntime,
  BotScreenRuntimeAdapter,
} from "./botScreenManager.ts";

const FAKE_SCREEN_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWMQMgn7D8IAC5MDN627upEAAAAASUVORK5CYII=",
  "base64",
);


interface FakeBotScreenRuntimeOptions {
  pointerDelayMs?: number;
}
/** Deterministic in-process platform adapter used by daemon integration tests. */
export class FakeBotScreenRuntimeAdapter implements BotScreenRuntimeAdapter {
  readonly pointerEvents: Array<{ surfaceId: string; runtimeGeneration: number; event: BotScreenPointerEvent }> = [];
  releaseCount = 0;
  #pointerWaiters: Array<{ count: number; resolve: () => void }> = [];
  #pointerEventWaiters: Array<{
    predicate: (event: { surfaceId: string; runtimeGeneration: number; event: BotScreenPointerEvent }) => boolean;
    resolve: () => void;
  }> = [];
  #releaseWaiters: Array<{ count: number; resolve: () => void }> = [];

  constructor(
    private readonly failure?: string,
    private readonly options: FakeBotScreenRuntimeOptions = {},
  ) {}


  waitForPointerEvents(count: number): Promise<void> {
    if (this.pointerEvents.length >= count) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    this.#pointerWaiters.push({ count, resolve });
    return promise;
  }

  waitForPointerEvent(
    predicate: (event: { surfaceId: string; runtimeGeneration: number; event: BotScreenPointerEvent }) => boolean,
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
        return {
          text: `fake-${action.name}#${actionCount}`,
          ...(action.name === "list_windows" ? { windowList: [] } : {}),
          ...(action.name === "screenshot"
            ? { image: { mediaType: "image/png" as const, bytes: FAKE_SCREEN_PNG } }
            : {}),
        };
      },
      pointer: async (event): Promise<void> => {
        if (stopped) throw new Error("fake Bot Screen is stopped");
        if (this.options.pointerDelayMs !== undefined) await Bun.sleep(this.options.pointerDelayMs);
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
      releasePointer: async (): Promise<void> => {
        if (stopped) return;
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
