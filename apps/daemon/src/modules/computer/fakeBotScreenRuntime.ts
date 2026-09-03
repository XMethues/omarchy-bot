import type {
  BotScreenCapture,
  BotScreenProvision,
  BotScreenRuntime,
  BotScreenRuntimeAdapter,
} from "./botScreenManager.ts";

const FAKE_SCREEN_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWMQMgn7D8IAC5MDN627upEAAAAASUVORK5CYII=",
  "base64",
);

/** Deterministic in-process platform adapter used by daemon integration tests. */
export class FakeBotScreenRuntimeAdapter implements BotScreenRuntimeAdapter {
  constructor(private readonly failure?: string) {}

  async start(_provision: BotScreenProvision): Promise<BotScreenRuntime> {
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
      exited,
      stop: async (): Promise<void> => {
        stopped = true;
      },
    };
  }
}
