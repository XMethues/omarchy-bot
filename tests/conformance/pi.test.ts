/**
 * Pi Agent conformance suite (agents-integration.md §6, ten steps) — the Gate 1
 * gatekeeper. Runs against the REAL Pi worker (real model calls via the user's
 * Pi credentials) and the REAL computer worker. On success it writes the
 * versioned conformance record that flips the Pi Agent to `ready`.
 *
 *   1. temp cwd + session            6. attachments (text file + 1×1 PNG)
 *   2. streamed fixed text           7. close → resume → history
 *   3. read-only tool lifecycle      8. worker exit leaves no orphans
 *   4. native write tool lifecycle    9. capability inventory / event mapping
 *   5. mid-turn cancel + steer      10. Computer fixture via the real broker
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkerClient, sanitizedEnv } from "../../apps/daemon/src/supervision/workerClient.ts";
import { RED_PIXEL_PNG, startConformanceDaemon, type ConformanceDaemon } from "./helpers.ts";
import { normalizeSessionEvent } from "../../workers/pi/src/normalize.ts";

let daemon: ConformanceDaemon;
let pi: WorkerClient;
const events: { type: string; event: Record<string, unknown> }[] = [];
const seenEventTypes = new Set<string>();
const tempDirs: string[] = [];

beforeAll(async () => {
  daemon = await startConformanceDaemon();
  pi = new WorkerClient({
    name: "agent:pi",
    script: path.resolve(import.meta.dir, "../../workers/pi/src/worker.ts"),
    env: sanitizedEnv(),
    onEvent: (event: { type: string }) => {
      events.push({ type: event.type, event: event as unknown as Record<string, unknown> });
      seenEventTypes.add(event.type);
    },
  });
  await pi.start();
}, 30_000);

afterAll(async () => {
  await pi?.stop().catch(() => {});
  await daemon?.stop();
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
  // Gate 1 step 8: no orphan worker processes remain.
  const proc = Bun.spawn(["pgrep", "-P", String(process.pid), "-fa", "worker.ts"]);
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  const stragglers = out.split("\n").filter((l) => l.includes("omarchy-bot/workers"));
  expect(stragglers).toEqual([]);
}, 20_000);

/** Drive one turn and collect streamed output. */
async function send(sessionId: string, text: string, attachments?: { id: string; name: string; path: string; mediaType: string }[]): Promise<number> {
  const before = events.length;
  await pi.request({ type: "message.send", requestId: crypto.randomUUID(), sessionId, turnId: crypto.randomUUID(), message: { text, ...(attachments ? { attachments } : {}) } }, 15_000);
  return before;
}

async function waitForEvent(before: number, pred: (e: { type: string; event: Record<string, unknown> }) => boolean, timeoutMs: number): Promise<{ type: string; event: Record<string, unknown> }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = events.slice(before).find(pred);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`timed out waiting for event (have: ${events.slice(before).map((e) => e.type).join(",")})`);
    await Bun.sleep(150);
  }
}

async function awaitTerminal(before: number, timeoutMs: number): Promise<{ type: string; event: Record<string, unknown> }[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const recent = events.slice(before);
    if (recent.some((e) => e.type === "turn.completed" || e.type === "turn.cancelled" || e.type === "error")) {
      return recent;
    }
    if (Date.now() > deadline) throw new Error(`turn did not finish (events: ${recent.map((e) => e.type).join(",")})`);
    await Bun.sleep(150);
  }
}

async function turn(sessionId: string, text: string, opts: { attachments?: { id: string; name: string; path: string; mediaType: string }[]; timeoutMs?: number } = {}) {
  const before = await send(sessionId, text, opts.attachments);
  return awaitTerminal(before, opts.timeoutMs ?? 120_000);
}

function assistantText(recent: { type: string; event: Record<string, unknown> }[]): string {
  let text = "";
  for (const e of recent) {
    if (e.type === "message.delta") text += String((e.event as { text?: string }).text ?? "");
  }
  return text;
}

describe("pi conformance (10 steps, real model)", () => {
  test(
    "all ten steps pass",
    async () => {
      // ---- Step 1: temp cwd + session ----
      const cwd = mkdtempSync(path.join(os.tmpdir(), "pi-conform-"));
      tempDirs.push(cwd);
      const opened = (await pi.request({ type: "session.open", requestId: crypto.randomUUID(), botId: "bot_conformance", threadId: "thread_conformance", options: { cwd, instructions: "" } }, 30_000)) as {
        sessionId: string;
        nativeSessionId: string;
      };
      expect(opened.sessionId).toBeTruthy();
      expect(opened.nativeSessionId).toBeTruthy();
      console.log("conformance: step 1 ok — session", opened.nativeSessionId);

      // ---- Step 2: streamed fixed text ----
      const sayRecent = await turn(opened.sessionId, "Reply with exactly: CONFORM-STREAM-OK and nothing else.");
      const streamed = assistantText(sayRecent);
      expect(streamed).toContain("CONFORM-STREAM-OK");
      const deltaCount = sayRecent.filter((e) => e.type === "message.delta").length;
      expect(deltaCount).toBeGreaterThanOrEqual(1);
      expect(sayRecent.some((e) => e.type === "turn.completed")).toBeTrue();
      console.log(`conformance: step 2 ok — streamed in ${deltaCount} deltas`);

      // ---- Step 3: read-only native tool lifecycle ----
      const roFile = path.join(cwd, "conform-readonly.txt");
      writeFileSync(roFile, "READ-ONLY-CONFORM");
      const lsRecent = await turn(opened.sessionId, `Use the read tool (NOT bash) to read the file ${roFile}, then reply DONE.`);
      expect(lsRecent.some((e) => e.type === "tool.started" && (e.event as { name?: string }).name === "read")).toBeTrue();
      const lsDone = lsRecent.find((e) => e.type === "tool.completed");
      expect(lsDone).toBeDefined();
      expect((lsDone!.event as { isError?: boolean }).isError).toBeFalse();
      console.log("conformance: step 3 ok — read-only native tool lifecycle");

      // ---- Step 4: native write tool lifecycle under Pi's own behavior ----
      const target = path.join(cwd, "conform-write-test.txt");
      const writeRecent = await turn(
        opened.sessionId,
        `Use the write tool to create a file at exactly ${target} containing the single word OK.`,
        { timeoutMs: 180_000 },
      );
      expect(writeRecent.some((e) => e.type === "tool.started" && (e.event as { name?: string }).name === "write")).toBeTrue();
      expect(writeRecent.some((e) => e.type === "tool.completed" && (e.event as { isError?: boolean }).isError === false)).toBeTrue();
      expect(writeRecent.some((e) => e.type === "turn.completed")).toBeTrue();
      const deadline4 = Date.now() + 30_000;
      while (!existsSync(target) && Date.now() < deadline4) await Bun.sleep(200);
      expect((await Bun.file(target).text()).trim()).toBe("OK");
      console.log("conformance: step 4 ok — native write tool completed");

      // ---- Step 5: cancel mid-turn; no late writes after cancel ----
      // Dedicated session: an aborted run must never pollute later turns.
      const countSession = (await pi.request({ type: "session.open", requestId: crypto.randomUUID(), botId: "bot_conformance", threadId: "thread_conformance_count", options: { cwd, instructions: "" } }, 30_000)) as { sessionId: string };
      const before = events.length;
      await pi.request({ type: "message.send", requestId: crypto.randomUUID(), sessionId: countSession.sessionId, turnId: crypto.randomUUID(), message: { text: "Count from 1 to 400, one number per line, no commentary." } }, 15_000);
      const deadline5 = Date.now() + 60_000;
      let sawDeltas = 0;
      while (Date.now() < deadline5) {
        sawDeltas = events.slice(before).filter((e) => e.type === "message.delta").length;
        if (sawDeltas >= 5) break;
        await Bun.sleep(150);
      }
      expect(sawDeltas).toBeGreaterThanOrEqual(5);
      await pi.request({ type: "turn.abort", requestId: crypto.randomUUID(), sessionId: countSession.sessionId }, 30_000);
      const cancelled = events.slice(before).find((e) => e.type === "turn.cancelled");
      expect(cancelled).toBeDefined();
      await Bun.sleep(2500); // settle window: nothing may land after cancel
      const cancelledIndex = events.findIndex((event) => event === cancelled);
      const lateWrites = events
        .slice(cancelledIndex + 1)
        .filter((event) => event.type === "tool.started" || event.type === "message.delta");
      expect(lateWrites).toEqual([]);
      console.log("conformance: step 5 ok — cancelled mid-turn, no late writes");

      // ---- Step 5b: native steer keeps the active session and completes ----
      const steerSession = (await pi.request({
        type: "session.open",
        requestId: crypto.randomUUID(),
        botId: "bot_conformance",
        threadId: "thread_conformance_steer",
        options: { cwd, instructions: "" },
      }, 30_000)) as { sessionId: string; nativeSessionId: string };
      const steerBefore = events.length;
      await pi.request({
        type: "message.send",
        requestId: crypto.randomUUID(),
        sessionId: steerSession.sessionId,
        turnId: crypto.randomUUID(),
        message: { text: "Count from 1 to 1000, one number per line, no commentary." },
      }, 15_000);
      await waitForEvent(
        steerBefore,
        (event) => event.type === "message.delta" && event.event.sessionId === steerSession.sessionId,
        60_000,
      );
      const steerResult = await pi.request({
        type: "message.steer",
        requestId: crypto.randomUUID(),
        sessionId: steerSession.sessionId,
        text: "Change course now. Stop counting and reply exactly STEER-NATIVE-OK.",
      }, 30_000) as { steered: boolean };
      expect(steerResult.steered).toBeTrue();
      const steeredRecent = (await awaitTerminal(steerBefore, 120_000))
        .filter((event) => event.event.sessionId === steerSession.sessionId);
      expect(steeredRecent.some((event) => event.type === "turn.completed")).toBeTrue();
      expect(steeredRecent.some((event) => event.type === "turn.cancelled")).toBeFalse();
      expect(steeredRecent.every((event) => event.event.sessionId === steerSession.sessionId)).toBeTrue();
      expect(assistantText(steeredRecent)).toContain("STEER-NATIVE-OK");
      console.log(`conformance: step 5b ok — native steer completed in session ${steerSession.nativeSessionId}`);

      // ---- Step 6: attachments (text file + 1×1 PNG) ----
      const textPath = path.join(cwd, "secret.txt");
      writeFileSync(textPath, "The secret phrase is CONFORM-TEXT-42.");
      const pngPath = path.join(cwd, "red.png");
      writeFileSync(pngPath, RED_PIXEL_PNG);
      // Capabilities are global to normal Bot turns, so image support must be
      // exercised through the same default-model session path used in production.
      let imageResult: "ok" | "provider-unsupported" = "provider-unsupported";
      let imageNote = "default model did not identify the image";
      let attachReply = "";
      try {
        const imageSession = (await pi.request({
          type: "session.open",
          requestId: crypto.randomUUID(),
          botId: "bot_conformance",
          threadId: "thread_conformance_vision",
          options: { cwd, instructions: "" },
        }, 30_000)) as { sessionId: string };
        const recent = await turn(
          imageSession.sessionId,
          "A text attachment contains a secret phrase and an image attachment is solid red. Reply in one line: the secret phrase, then the color word.",
          {
            attachments: [
              { id: "a1", name: "secret.txt", path: textPath, mediaType: "text/plain" },
              { id: "a2", name: "red.png", path: pngPath, mediaType: "image/png" },
            ],
          },
        );
        attachReply = assistantText(recent);
        if (attachReply.includes("CONFORM-TEXT-42") && /\bred\b/i.test(attachReply)) {
          imageResult = "ok";
          imageNote = "default model identified the solid red image";
        }
      } catch (error) {
        imageNote = `default model rejected image input: ${error instanceof Error ? error.message : String(error)}`;
      }
      const textAttachRecent = attachReply.includes("CONFORM-TEXT-42")
        ? null
        : await (async () => {
            const ts = (await pi.request({ type: "session.open", requestId: crypto.randomUUID(), botId: "bot_conformance", threadId: "thread_conformance_text", options: { cwd, instructions: "" } }, 30_000)) as { sessionId: string };
            return turn(ts.sessionId, "The attachment names a secret phrase. Reply with just the secret phrase.", { attachments: [{ id: "a1", name: "secret.txt", path: textPath, mediaType: "text/plain" }] });
          })();
      if (textAttachRecent) attachReply = assistantText(textAttachRecent);
      expect(attachReply).toContain("CONFORM-TEXT-42");
      console.log(`conformance: step 6 ok — text attachment ok; image: ${imageResult} (${imageNote})`);

      // ---- Step 7: close → resume → history ----
      await pi.request({ type: "session.close", requestId: crypto.randomUUID(), sessionId: opened.sessionId }, 15_000);
      const resumed = (await pi.request(
        { type: "session.resume", requestId: crypto.randomUUID(), botId: "bot_conformance", threadId: "thread_conformance", nativeSessionId: opened.nativeSessionId, options: { cwd, instructions: "" } },
        30_000,
      )) as { sessionId: string };
      const history = (await pi.request({ type: "session.history", requestId: crypto.randomUUID(), sessionId: resumed.sessionId }, 30_000)) as {
        messages: { role: string; text?: string }[];
      };
      const roles = history.messages.map((m) => m.role);
      expect(roles).toContain("user");
      expect(roles).toContain("assistant");
      const allText = history.messages.map((m) => m.text ?? "").join("\n");
      expect(allText).toContain("CONFORM-STREAM-OK");
      console.log(`conformance: step 7 ok — resumed native session, ${history.messages.length} history messages`);

      // ---- Step 8: worker exit leaves no orphans (asserted in afterAll pgrep) ----
      // Kill this worker abruptly; supervisor semantics are exercised by the
      // integration suite. Here we verify a fresh client takes over cleanly.
      await pi.stop().catch(() => {});
      pi = new WorkerClient({
        name: "agent:pi",
        script: path.resolve(import.meta.dir, "../../workers/pi/src/worker.ts"),
        env: sanitizedEnv(),
        onEvent: (event: { type: string }) => {
          events.push({ type: event.type, event: event as unknown as Record<string, unknown> });
          seenEventTypes.add(event.type);
        },
      });
      await pi.start();
      const reprobe = await pi.request({ type: "probe", requestId: crypto.randomUUID() }, 30_000);
      expect((reprobe as { sdkOk?: boolean }).sdkOk).toBeTrue();
      console.log("conformance: step 8 ok — worker restart clean (orphans checked in afterAll)");

      // ---- Step 9: capability inventory / event mapping ----
      // Pi does not emit progress updates for every tool (fast read/write tools
      // commonly jump from start to end), so require only live lifecycle
      // boundaries here and exercise the optional update mapping directly.
      const REQUIRED_LIVE_EVENT_TYPES = ["message.delta", "tool.started", "tool.completed", "turn.completed", "turn.cancelled"] as const;
      for (const t of REQUIRED_LIVE_EVENT_TYPES) {
        expect(seenEventTypes.has(t), `missing live event type ${t}; saw ${[...seenEventTypes].sort().join(", ")}`).toBeTrue();
      }
      expect(normalizeSessionEvent({
        type: "tool_execution_update",
        toolCallId: "tool_conformance",
        partialResult: { content: [{ type: "text", text: "partial output" }] },
      }, "session_conformance")).toEqual([{
        type: "tool.updated",
        sessionId: "session_conformance",
        id: "tool_conformance",
        output: { text: "partial output" },
      }]);
      console.log(`conformance: step 9 ok — normalized event inventory mapped: ${[...seenEventTypes].sort().join(", ")}`);

      // ---- Step 10: Computer fixture via the REAL broker + REAL computer worker ----
      const broker = daemon.svc.computer;
      const botActor = { botId: "bot_conformance" };
      // observe without lease
      const obs = await broker.act(botActor, undefined, { name: "observe", args: {} });
      expect((obs.text ?? "").length).toBeGreaterThan(0);
      // screenshot lands an artifact
      await broker.act(botActor, undefined, { name: "screenshot", args: {} });
      expect(daemon.svc.computer.state().lastImageAt).toBeDefined();
      // Gate 1: bot input without lease is rejected
      await expect(broker.act(botActor, undefined, { name: "click", args: {} })).rejects.toThrow(/no active input lease/);
      // acquire lease as bot, harmless test input (lone shift press is a no-op)
      const lease = await broker.acquire(botActor, undefined);
      expect(lease.granted).toBeTrue();
      await broker.act(botActor, undefined, { name: "key", args: { key: "shift" } });
      // Take over: human steals the lease; bot input must now fail
      broker.takeOver();
      await expect(broker.act(botActor, undefined, { name: "type", args: { text: "x" } })).rejects.toThrow();
      // I'm done: re-observe, release, bot can resume
      await broker.imDone();
      const reAcquire = await broker.acquire(botActor, undefined);
      expect(reAcquire.granted).toBeTrue();
      const obs2 = await broker.act(botActor, undefined, { name: "observe", args: {} });
      expect((obs2.text ?? "").length).toBeGreaterThan(0);
      broker.release(botActor, reAcquire.token!);
      console.log("conformance: step 10 ok — observe/screenshot/lease/input/take-over/im-done/resume");

      // ---- Record: write the versioned conformance record and verify the gate ----
      const version = await pi.request({ type: "probe", requestId: crypto.randomUUID() }, 30_000);
      const agentVersion = (version as { agentVersion?: string }).agentVersion!;
      const image = imageResult === "ok" ? "verified" : "provider-unsupported";
      const realConfDir = path.join(os.homedir(), ".local/share/omarchy-bot/conformance");
      mkdirSync(realConfDir, { recursive: true });
      const record = JSON.stringify({ ok: true, at: new Date().toISOString(), steps: 10, image });
      const recordPath = path.join(realConfDir, `pi-${agentVersion}.json`);
      writeFileSync(recordPath, record);
      // The daemon under test resolves conformanceDir from its own (temp) home.
      const testConfDir = path.join(daemon.home, "conformance");
      mkdirSync(testConfDir, { recursive: true });
      writeFileSync(path.join(testConfDir, `pi-${agentVersion}.json`), record);
      console.log(`conformance: record written ${recordPath}`);
      const agent = await daemon.svc.agents.recheck("pi");
      expect(agent.status).toBe("ready");
      console.log("conformance: Pi Agent is READY");
    },
    600_000,
  );
});
