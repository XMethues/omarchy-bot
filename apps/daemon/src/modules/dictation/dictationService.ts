import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { DictationDto, DictationResultDto } from "@omarchy-bot/protocol";

export interface DictationEventSink {
  append(aggregateType: "dictation", aggregateId: string, type: string, payload: unknown): unknown;
}

export interface DictationServiceOptions {
  timeoutMs?: number;
}

interface KillableProcess {
  kill(): void;
}

interface ActiveRecording {
  id: string;
  transcriptPath: string;
  cancelled: boolean;
  stopProcess?: KillableProcess | undefined;
}

interface CommandResult {
  exitCode: number | null;
  stdout: string;
  timedOut: boolean;
  spawnFailed: boolean;
}

type DictationState = DictationDto["state"];

const DEFAULT_TIMEOUT_MS = 30_000;
const UNAVAILABLE_ERROR = "Voxtype is unavailable.";

export class DictationConflictError extends Error {
  constructor() {
    super("dictation is already active");
    this.name = "DictationConflictError";
  }
}

/**
 * Owns one application recording through Voxtype's file-output integration.
 * It never reads or writes Voxtype configuration and never retains audio.
 */
export class DictationService {
  readonly #timeoutMs: number;
  #state: DictationState;
  #error: string | undefined;
  #active: ActiveRecording | undefined;

  constructor(
    private readonly dictationDir: string,
    private readonly voxtypeBin: string,
    private readonly events: DictationEventSink,
    options: DictationServiceOptions = {},
  ) {
    mkdirSync(dictationDir, { recursive: true, mode: 0o700 });
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#state = Bun.which(voxtypeBin) === null ? "unavailable" : "idle";
    if (this.#state === "unavailable") this.#error = UNAVAILABLE_ERROR;
  }

  state(): DictationDto {
    return {
      state: this.#state,
      ...(this.#active !== undefined && (this.#state === "recording" || this.#state === "transcribing")
        ? { recordingId: this.#active.id }
        : {}),
      ...(this.#error !== undefined ? { error: this.#error } : {}),
    };
  }

  async start(): Promise<DictationDto> {
    if (this.#state === "unavailable") return this.state();
    if (this.#active !== undefined) throw new DictationConflictError();

    const id = `rec_${randomUUID().replaceAll("-", "")}`;
    const transcriptPath = path.join(this.dictationDir, `${id}.txt`);
    const active: ActiveRecording = { id, transcriptPath, cancelled: false };
    this.#active = active;
    await this.#removeArtifacts(transcriptPath);

    const command = await this.#run([
      "record",
      "start",
      `--file=${transcriptPath}`,
      "--no-auto-submit",
      "--no-smart-auto-submit",
    ]);
    if (command.spawnFailed) {
      await this.#removeArtifacts(transcriptPath);
      this.#active = undefined;
      this.#transition("unavailable", UNAVAILABLE_ERROR);
      return this.state();
    }
    if (command.timedOut || command.exitCode !== 0) {
      await this.#removeArtifacts(transcriptPath);
      this.#active = undefined;
      this.#transition("idle", "Voxtype could not start recording.");
      return this.state();
    }

    this.#transition("recording");
    return this.state();
  }

  async stop(): Promise<DictationResultDto> {
    if (this.#state === "unavailable") return { outcome: "unavailable" };
    const active = this.#active;
    if (active === undefined) return { outcome: "cancelled" };

    this.#transition("transcribing");
    let unavailable = false;
    try {
      const command = await this.#run(
        ["record", "stop", "--wait", "--json", "--wait-file", active.transcriptPath],
        active,
      );
      if (active.cancelled) return { outcome: "cancelled" };
      if (command.spawnFailed) {
        unavailable = true;
        return { outcome: "unavailable" };
      }
      if (command.timedOut) return { outcome: "timeout" };

      const result = this.#parseStopResult(command.stdout);
      if (command.exitCode === 3) return { outcome: "empty" };
      if (command.exitCode === 4) return { outcome: "timeout" };
      if (result.status === "ok" && command.exitCode === 0 && typeof result.text === "string" && result.text.trim().length > 0) {
        return { outcome: "success", text: result.text };
      }
      if (result.status === "ok" && command.exitCode === 0) return { outcome: "empty" };
      return { outcome: "failure" };
    } finally {
      await this.#removeArtifacts(active.transcriptPath);
      this.#release(active, unavailable ? "unavailable" : "idle");
    }
  }

  async cancel(): Promise<DictationDto> {
    const active = this.#active;
    if (active === undefined) return this.state();

    active.cancelled = true;
    active.stopProcess?.kill();
    await this.#run(["record", "cancel"]);
    await this.#removeArtifacts(active.transcriptPath);
    this.#release(active);
    return this.state();
  }

  async shutdown(): Promise<void> {
    if (this.#active !== undefined) await this.cancel();
  }

  #transition(state: DictationState, error?: string): void {
    this.#state = state;
    this.#error = error;
    this.events.append("dictation", "dictation", "dictation.state.changed", { state });
  }

  #release(active: ActiveRecording, state: "idle" | "unavailable" = "idle"): void {
    if (this.#active !== active) return;
    this.#active = undefined;
    this.#transition(state, state === "unavailable" ? UNAVAILABLE_ERROR : undefined);
  }

  async #removeArtifacts(transcriptPath: string): Promise<void> {
    await Promise.all([rm(transcriptPath, { force: true }), rm(`${transcriptPath}.done`, { force: true })]);
  }

  #parseStopResult(stdout: string): { status?: string; text?: string } {
    try {
      const parsed: unknown = JSON.parse(stdout.trim());
      if (parsed === null || typeof parsed !== "object") return {};
      const status = "status" in parsed && typeof parsed.status === "string" ? parsed.status : undefined;
      const text = "text" in parsed && typeof parsed.text === "string" ? parsed.text : undefined;
      return {
        ...(status !== undefined ? { status } : {}),
        ...(text !== undefined ? { text } : {}),
      };
    } catch {
      return {};
    }
  }

  async #run(args: string[], active?: ActiveRecording): Promise<CommandResult> {
    let process: ReturnType<typeof Bun.spawn>;
    try {
      process = Bun.spawn({
        cmd: [this.voxtypeBin, ...args],
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
    } catch {
      return { exitCode: null, stdout: "", timedOut: false, spawnFailed: true };
    }

    if (active !== undefined) active.stopProcess = process;
    const stdout = new Response(process.stdout as ReadableStream<Uint8Array>).text();
    const stderr = new Response(process.stderr as ReadableStream<Uint8Array>).text();
    const timeout = Promise.withResolvers<"timeout">();
    const timer = setTimeout(() => timeout.resolve("timeout"), this.#timeoutMs);
    const winner = await Promise.race([
      process.exited.then((exitCode) => ({ kind: "exit" as const, exitCode })),
      timeout.promise.then(() => ({ kind: "timeout" as const })),
    ]);
    clearTimeout(timer);

    let timedOut = winner.kind === "timeout";
    if (timedOut) process.kill();
    const exitCode = winner.kind === "exit" ? winner.exitCode : await process.exited.catch(() => null);
    const output = await stdout.catch(() => "");
    await stderr.catch(() => "");
    if (active?.cancelled === true) timedOut = false;
    return { exitCode, stdout: output, timedOut, spawnFailed: false };
  }
}
