import { expect, test } from "bun:test";
import path from "node:path";
import { WorkerClient, sanitizedEnv } from "../../apps/daemon/src/supervision/workerClient.ts";

const SURFACE_ID = "surf_11111111111111111111111111111111";
const WORKER_SCRIPT = path.resolve(import.meta.dir, "../../workers/computer/src/worker.ts");
const WORKER_ENV = {
  ...sanitizedEnv(),
  OMARCHY_BOT_SURFACE_ID: SURFACE_ID,
  OMARCHY_BOT_RUNTIME_GENERATION: "1",
};

test("computer worker flushes the successful shutdown response before exiting", async () => {
  const requestId = "shutdown-response";
  const startedAt = performance.now();
  const worker = Bun.spawn({
    cmd: [process.execPath, WORKER_SCRIPT],
    env: WORKER_ENV,
    stdin: new Blob([`${JSON.stringify({ type: "shutdown", requestId })}\n`]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    worker.exited,
    new Response(worker.stdout).text(),
    new Response(worker.stderr).text(),
  ]);

  expect(status).toBe(0);
  expect(stdout.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
    expect.objectContaining({ type: "hello", worker: "computer:computer" }),
    { requestId, ok: true, payload: { done: true } },
  ]);
  expect(stderr).toBe("");
  expect(performance.now() - startedAt).toBeLessThan(500);
});

test("WorkerClient stop observes the computer worker's graceful exit without reaching its kill timeout", async () => {
  const worker = new WorkerClient({
    name: "computer-shutdown-test",
    script: WORKER_SCRIPT,
    env: WORKER_ENV,
    onEvent: () => {},
  });
  await worker.start();

  const startedAt = performance.now();
  await worker.stop();
  const elapsedMs = performance.now() - startedAt;

  expect(worker.alive).toBeFalse();
  expect(elapsedMs).toBeLessThan(500);
});
