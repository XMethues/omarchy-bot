import { fileURLToPath } from "node:url";

// Quickshell destroys Process objects with SIGKILL. Keep the daemon behind a
// pipe whose EOF can request graceful cleanup even when this supervisor dies.
// Descriptor 9 is launch.sh's flock; its duplicate in the child keeps reloads
// waiting until the daemon has finished releasing its owned resources.
const child = Bun.spawn({
  cmd: [
    process.execPath,
    "--preload",
    fileURLToPath(new URL("./daemon-lifetime.ts", import.meta.url)),
    "apps/daemon/src/bootstrap/main.ts",
  ],
  stdio: ["pipe", "inherit", "inherit", 9],
});

let stopping = false;
const stop = (): void => {
  if (stopping) return;
  stopping = true;
  child.stdin.end();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);

const code = await child.exited;
stop();
process.exitCode = code;
