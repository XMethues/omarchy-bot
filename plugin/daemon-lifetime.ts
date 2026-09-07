import { stdin } from "bun";

let stopping = false;

function observeSignal(signal: "SIGTERM" | "SIGINT"): void {
  if (stopping) return;
  stopping = true;
  if (process.listenerCount(signal) === 1) {
    // Bootstrap has not installed its cleanup handler yet. Retain normal
    // termination semantics instead of swallowing an early shutdown request.
    process.off("SIGTERM", onTerminate);
    process.off("SIGINT", onInterrupt);
    process.kill(process.pid, signal);
  }
}

function onTerminate(): void { observeSignal("SIGTERM"); }
function onInterrupt(): void { observeSignal("SIGINT"); }
process.on("SIGTERM", onTerminate);
process.on("SIGINT", onInterrupt);

async function monitorSupervisor(): Promise<void> {
  try {
    // This private pipe carries no application data. EOF also arrives when
    // Quickshell kills the supervisor, unlike a catchable process signal.
    for await (const _chunk of stdin.stream()) {}
  } catch (error) {
    console.error("Plugin supervisor lifeline failed", error);
    process.exitCode = 1;
  }
  // A process-group signal may already have started daemon cleanup. Do not
  // deliver a second signal after bootstrap removes its own signal handlers.
  if (!stopping) process.kill(process.pid, "SIGTERM");
}

void monitorSupervisor();
