import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DictationResultDto } from "../../packages/protocol/src/index.ts";
import { handleDictationRequest } from "../../apps/daemon/src/api/dictationRoutes.ts";
import {
  DictationConflictError,
  DictationService,
  type DictationEventSink,
} from "../../apps/daemon/src/modules/dictation/dictationService.ts";
import { insertDictationTranscript } from "../../apps/web/src/lib/dictation.ts";

interface EventRecord {
  aggregateType: string;
  aggregateId: string;
  type: string;
  payload: unknown;
}

interface Fixture {
  root: string;
  binary: string;
  commandsPath: string;
  events: EventRecord[];
  service: DictationService;
}

const roots = new Set<string>();

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.clear();
});

function makeFixture(
  outcome: "success" | "empty" | "timeout" | "failure" | "hang" = "success",
  options: { text?: string; timeoutMs?: number } = {},
): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-dictation-"));
  roots.add(root);
  const binary = path.join(root, "voxtype");
  copyFileSync(path.join(import.meta.dir, "fixtures", "fake-voxtype.ts"), binary);
  chmodSync(binary, 0o700);
  writeFileSync(path.join(root, "control.json"), JSON.stringify({ outcome, text: options.text }));
  const commandsPath = path.join(root, "commands.ndjson");
  const events: EventRecord[] = [];
  const eventSink: DictationEventSink = {
    append(aggregateType, aggregateId, type, payload) {
      events.push({ aggregateType, aggregateId, type, payload });
    },
  };
  const service = new DictationService(root, binary, eventSink, { timeoutMs: options.timeoutMs ?? 1_000 });
  return { root, binary, commandsPath, events, service };
}

function commands(fixture: Fixture): string[][] {
  return readFileSync(fixture.commandsPath, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as string[]);
}

function runtimeArtifacts(fixture: Fixture): string[] {
  return readdirSync(fixture.root).filter((name) => name.startsWith("rec_"));
}

async function jsonBody(response: Response | undefined): Promise<unknown> {
  expect(response).toBeDefined();
  return response?.json();
}

describe("dictation draft insertion", () => {
  test("preserves existing text and inserts at the captured cursor", () => {
    expect(
      insertDictationTranscript(
        { text: "hello world", cursor: 11, stagedIds: ["att_keep"], dictationAnchor: 5 },
        " dictated ",
        5,
      ),
    ).toEqual({ text: "hello dictated world", cursor: 14, stagedIds: ["att_keep"] });
  });
});

describe("DictationService", () => {
  test("reports an unavailable binary without attempting recording", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-dictation-missing-"));
    roots.add(root);
    const events: EventRecord[] = [];
    const service = new DictationService(root, path.join(root, "not-installed"), {
      append(aggregateType, aggregateId, type, payload) {
        events.push({ aggregateType, aggregateId, type, payload });
      },
    });

    expect(service.state()).toEqual({ state: "unavailable", error: "Voxtype is unavailable." });
    expect(await service.start()).toEqual({ state: "unavailable", error: "Voxtype is unavailable." });
    expect(await service.stop()).toEqual({ outcome: "unavailable" });
    expect(events).toEqual([]);
  });

  test("starts with a unique private target, disables synthetic submission, and rejects another start", async () => {
    const fixture = makeFixture();

    const started = await fixture.service.start();
    expect(started.state).toBe("recording");
    expect(started.recordingId).toMatch(/^rec_[0-9a-f]{32}$/);
    const startArgs = commands(fixture)[0];
    expect(startArgs?.slice(0, 2)).toEqual(["record", "start"]);
    expect(startArgs).toContain("--no-auto-submit");
    expect(startArgs).toContain("--no-smart-auto-submit");
    const fileArg = startArgs?.find((arg) => arg.startsWith("--file="));
    expect(fileArg).toBe(`--file=${path.join(fixture.root, `${started.recordingId}.txt`)}`);

    await expect(fixture.service.start()).rejects.toBeInstanceOf(DictationConflictError);
    await fixture.service.cancel();
    const restarted = await fixture.service.start();
    expect(restarted.recordingId).not.toBe(started.recordingId);
    await fixture.service.cancel();
  });

  const outcomes: Array<{
    name: string;
    fake: "success" | "empty" | "timeout" | "failure";
    expected: DictationResultDto;
  }> = [
    { name: "success", fake: "success", expected: { outcome: "success", text: "private transcript" } },
    { name: "silence", fake: "empty", expected: { outcome: "empty" } },
    { name: "Voxtype timeout", fake: "timeout", expected: { outcome: "timeout" } },
    { name: "transcription failure", fake: "failure", expected: { outcome: "failure" } },
  ];

  for (const scenario of outcomes) {
    test(`maps ${scenario.name}, publishes state only, and removes every transcript artifact`, async () => {
      const fixture = makeFixture(scenario.fake, { text: "private transcript" });
      await fixture.service.start();

      expect(await fixture.service.stop()).toEqual(scenario.expected);
      expect(fixture.service.state()).toEqual({ state: "idle" });
      const stopArgs = commands(fixture)[1];
      expect(stopArgs?.slice(0, 4)).toEqual(["record", "stop", "--wait", "--json"]);
      expect(stopArgs?.at(-2)).toBe("--wait-file");
      expect(runtimeArtifacts(fixture)).toEqual([]);
      expect(fixture.events.map((event) => event.payload)).toEqual([
        { state: "recording" },
        { state: "transcribing" },
        { state: "idle" },
      ]);
      expect(JSON.stringify(fixture.events)).not.toContain("private transcript");
    });
  }

  test("bounds a stuck stop command and removes its runtime target", async () => {
    const fixture = makeFixture("hang", { timeoutMs: 25 });
    await fixture.service.start();

    expect(await fixture.service.stop()).toEqual({ outcome: "timeout" });
    expect(fixture.service.state()).toEqual({ state: "idle" });
    expect(runtimeArtifacts(fixture)).toEqual([]);
  });

  test("cancel terminates an outstanding wait, returns cancelled from stop, and cleans files", async () => {
    const fixture = makeFixture("hang", { timeoutMs: 2_000 });
    const started = await fixture.service.start();
    const transcriptPath = path.join(fixture.root, `${started.recordingId}.txt`);
    writeFileSync(transcriptPath, "must be discarded");
    writeFileSync(`${transcriptPath}.done`, "must be discarded");

    const stopped = fixture.service.stop();
    expect(await fixture.service.cancel()).toEqual({ state: "idle" });
    expect(await stopped).toEqual({ outcome: "cancelled" });
    expect(commands(fixture).some((args) => args[0] === "record" && args[1] === "cancel")).toBe(true);
    expect(runtimeArtifacts(fixture)).toEqual([]);
  });

  test("shutdown cancels an owned recording and removes runtime files", async () => {
    const fixture = makeFixture();
    const started = await fixture.service.start();
    const transcriptPath = path.join(fixture.root, `${started.recordingId}.txt`);
    writeFileSync(transcriptPath, "must be discarded");
    writeFileSync(`${transcriptPath}.done`, "must be discarded");

    await fixture.service.shutdown();

    expect(fixture.service.state()).toEqual({ state: "idle" });
    expect(commands(fixture).at(-1)?.slice(0, 2)).toEqual(["record", "cancel"]);
    expect(runtimeArtifacts(fixture)).toEqual([]);
  });
});

describe("dictation route helper", () => {
  test("serves state and command routes with conflict isolation", async () => {
    const fixture = makeFixture("empty");
    const get = await handleDictationRequest(new Request("http://localhost/api/dictation"), fixture.service, "/api/dictation");
    expect(await jsonBody(get)).toEqual({ state: "idle" });

    const start = await handleDictationRequest(
      new Request("http://localhost/api/dictation/start", { method: "POST" }),
      fixture.service,
      "/api/dictation/start",
    );
    expect((await jsonBody(start)) as object).toMatchObject({ state: "recording" });

    const conflict = await handleDictationRequest(
      new Request("http://localhost/api/dictation/start", { method: "POST" }),
      fixture.service,
      "/api/dictation/start",
    );
    expect(conflict?.status).toBe(409);
    expect(await jsonBody(conflict)).toEqual({ error: "dictation is already active" });

    const stop = await handleDictationRequest(
      new Request("http://localhost/api/dictation/stop", { method: "POST" }),
      fixture.service,
      "/api/dictation/stop",
    );
    expect(await jsonBody(stop)).toEqual({ outcome: "empty" });

    await handleDictationRequest(
      new Request("http://localhost/api/dictation/start", { method: "POST" }),
      fixture.service,
      "/api/dictation/start",
    );
    const cancel = await handleDictationRequest(
      new Request("http://localhost/api/dictation/cancel", { method: "POST" }),
      fixture.service,
      "/api/dictation/cancel",
    );
    expect(await jsonBody(cancel)).toEqual({ state: "idle" });

    expect(await handleDictationRequest(new Request("http://localhost/not-dictation"), fixture.service, "/not-dictation")).toBeUndefined();
  });
});
