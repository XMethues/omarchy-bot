/**
 * Fake computer worker: records every act and echoes the lease it was given.
 * Refuses input actions when the daemon did not attach a lease token
 * (defense in depth — the broker already gates this).
 */
import { readJsonl } from "../../../../../packages/agent-contract/src/framing.ts";
import { isInputAction } from "../../../../../packages/domain/src/index.ts";
import type { ComputerActionName } from "../../../../../packages/domain/src/index.ts";

const write = (msg: unknown): void => {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
};

write({ type: "hello", v: 1, worker: "computer:computer", pid: process.pid });

const log: { action: string; hadLease: boolean }[] = [];

readJsonl(Bun.stdin.stream(), (raw) => {
  const msg = raw as { type: string; requestId?: string; action?: { name: string; args?: Record<string, unknown> }; lease?: { token: string } };
  if (msg.type === "probe") {
    write({ requestId: msg.requestId!, ok: true, payload: { ok: true, backend: "fake" } });
    return;
  }
  if (msg.type === "act") {
    const action = msg.action!;
    const hadLease = msg.lease !== undefined;
    const actionName = action.name as ComputerActionName;
    if (isInputAction(actionName) && !hadLease) {
      write({ requestId: msg.requestId!, ok: false, error: "fake worker refuses input without lease token" });
      return;
    }
    log.push({ action: actionName, hadLease });
    write({
      requestId: msg.requestId!,
      ok: true,
      payload: {
        text: `fake-${action.name}#${log.length}`,
        ...(action.name === "list_windows" ? { windowList: [] } : {}),
      },
    });
    return;
  }
  if (msg.requestId) write({ requestId: msg.requestId, ok: false, error: `unknown ${msg.type}` });
});
