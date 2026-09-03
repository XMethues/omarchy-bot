/**
 * Fake Bot Screen worker: records every scoped action and refuses input
 * without authoritative Bot/Surface context.
 */
import { readJsonl } from "../../../../../packages/agent-contract/src/framing.ts";
import { isInputAction, isSurfaceId } from "../../../../../packages/domain/src/index.ts";
import type { ComputerActionName } from "../../../../../packages/domain/src/index.ts";

const write = (msg: unknown): void => {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
};

write({ type: "hello", v: 1, worker: "computer:computer", pid: process.pid });
const expectedSurfaceId = process.env.OMARCHY_BOT_SURFACE_ID;
const expectedRuntimeGeneration = Number(process.env.OMARCHY_BOT_RUNTIME_GENERATION);
const heartbeat = setInterval(() => write({ type: "heartbeat" }), 10_000);
heartbeat.unref?.();

const log: { action: string; hadAuthority: boolean }[] = [];
const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";


readJsonl(Bun.stdin.stream(), (raw) => {
  const msg = raw as {
    type: string;
    requestId?: string;
    surfaceId?: string;
    runtimeGeneration?: number;
    action?: { name: string; args?: Record<string, unknown> };
    inputAuthority?: { surfaceId?: string; botId?: string; turnId?: string };
  };
  if (msg.type === "act") {
    if (!isSurfaceId(msg.surfaceId ?? "")) {
      write({ requestId: msg.requestId!, ok: false, error: "fake worker requires a valid surfaceId" });
      return;
    }
    if (msg.surfaceId !== expectedSurfaceId) {
      write({ requestId: msg.requestId!, ok: false, error: "fake worker rejects mismatched worker Surface context" });
      return;
    }
    if (msg.runtimeGeneration !== expectedRuntimeGeneration) {
      write({ requestId: msg.requestId!, ok: false, error: "fake worker rejects stale runtime generation" });
      return;
    }
    if (msg.inputAuthority !== undefined && msg.inputAuthority.surfaceId !== msg.surfaceId) {
      write({ requestId: msg.requestId!, ok: false, error: "fake worker rejects mismatched input authority Surface" });
      return;
    }
    const action = msg.action!;
    if (action.args?.crash === true) process.exit(17);
    const hadAuthority = msg.inputAuthority !== undefined;
    const actionName = action.name as ComputerActionName;
    if (isInputAction(actionName) && !hadAuthority) {
      write({ requestId: msg.requestId!, ok: false, error: "fake worker refuses input without Bot Screen authority" });
      return;
    }
    log.push({ action: actionName, hadAuthority });
    write({
      requestId: msg.requestId!,
      ok: true,
      payload: {
        text: `fake-${action.name}#${log.length}`,
        ...(action.name === "list_windows" ? { windowList: [] } : {}),
        ...(action.name === "screenshot"
          ? { image: { mediaType: "image/png", base64: ONE_PIXEL_PNG } }
          : {}),
      },
    });
    return;
  }
  if (msg.type === "shutdown") {
    write({ requestId: msg.requestId!, ok: true, payload: { done: true } });
    process.exit(0);
  }
  if (msg.requestId) write({ requestId: msg.requestId, ok: false, error: `unknown ${msg.type}` });
});
