import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/** Stop the daemon process, wait for its worker cleanup, and remove run data. */
export default async function globalTeardown(): Promise<void> {
  const stateFile = path.join(import.meta.dirname, ".daemon.json");
  let state: unknown;
  try {
    state = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    return;
  }
  if (
    state === null ||
    typeof state !== "object" ||
    !("pid" in state) ||
    typeof state.pid !== "number" ||
    !("runDir" in state) ||
    typeof state.runDir !== "string"
  ) {
    rmSync(stateFile, { force: true });
    throw new Error("invalid e2e daemon state");
  }

  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(state.pid, 0);
      await delay(50);
    } catch {
      break;
    }
  }
  rmSync(state.runDir, { recursive: true, force: true });
  rmSync(stateFile, { force: true });
}
