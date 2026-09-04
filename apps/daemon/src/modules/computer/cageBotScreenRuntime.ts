import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import sharp from "sharp";
import type { ComputerAction, SurfaceId } from "@omarchy-bot/domain";
import type { ComputerInputAuthority } from "@omarchy-bot/agent-contract";
import type { SurfaceComputerWorker, Supervisor } from "../../supervision/supervisor.ts";
import { ensureCaptureHelper } from "../../../native/capture-helper/build.ts";
import { ensureInputHelper } from "../../../native/pointer-helper/build.ts";
import { ensureBotDesktop } from "../../../native/bot-desktop/build.ts";
import { ApplicationUnits } from "../../supervision/applicationUnits.ts";
import {
  BotScreenInputRejectedError,
  type BotScreenActionResult,
  type BotScreenCapture,
  type BotScreenCaptureFrame,
  type BotScreenCaptureStream,
  type BotScreenInputEvent,
  type BotScreenProvision,
  type BotScreenRuntime,
  type BotScreenRuntimeOutcome,
  type BotScreenRuntimeAdapter,
} from "./botScreenManager.ts";

export interface CageAdapterOptions {
  runtimeRoot: string;
  profileRoot: string;
  hostRuntimeDir?: string;
  cageBin?: string;
  wlrRandrBin?: string;
  grimBin?: string;
  inputHelperBin?: string;
  captureHelperBin?: string;
  ffmpegBin?: string;
  botDesktopBin?: string;
  computerWorkers: Pick<Supervisor, "startComputerWorker">;
}

type CageProcess = Bun.Subprocess<"ignore", "pipe", "pipe">;

interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

const INPUT_RPC_TIMEOUT_MS = 1_000;
type PointerProcess = Bun.Subprocess<"pipe", "pipe", "pipe">;
const CAPTURE_RPC_TIMEOUT_MS = 5_000;
type CaptureProcess = Bun.Subprocess<"pipe", "pipe", "pipe">;

function executable(name: string | undefined, fallback: string): string | undefined {
  const candidate = name ?? fallback;
  if (candidate.includes("/")) return existsSync(candidate) ? candidate : undefined;
  return Bun.which(candidate) ?? undefined;
}

async function command(argv: string[], env: Record<string, string>): Promise<CommandResult> {
  const child = Bun.spawn(argv, { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { status, stdout, stderr };
}
async function requireH264Encoder(
  binary: string | undefined,
  commandPrefix: readonly string[] = [],
  launcherEnvironment?: Record<string, string>,
): Promise<void> {
  const ffmpeg = executable(binary, "ffmpeg");
  if (ffmpeg === undefined) throw new Error("Cage Bot Screen requires ffmpeg with libx264");
  const child = Bun.spawn([...commandPrefix, ffmpeg, "-hide_banner", "-encoders"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ...(launcherEnvironment === undefined ? {} : { env: launcherEnvironment }),
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (status !== 0 || !/\blibx264\b/.test(stdout)) {
    throw new Error(
      `Cage Bot Screen requires ffmpeg with libx264${
        stderr.trim() === "" ? "" : `: ${stderr.trim()}`
      }`,
    );
  }
}


async function terminateCapture(child: CaptureProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  const stopped = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(1_000).then(() => false),
  ]);
  if (stopped) return;
  child.kill("SIGKILL");
  await child.exited;
}

class WaylandVirtualInput {
  readonly exited: Promise<Error>;
  #responses: ProcessLineReader;
  #requestSequence = 0;
  #operations: Promise<void> = Promise.resolve();
  #stopped = false;
  #context: string;
  #terminalError: Error | undefined;

  private constructor(
    private readonly process: PointerProcess,
    provision: BotScreenProvision,
  ) {
    this.#responses = new ProcessLineReader(
      process.stdout,
      "Bot Screen input helper closed its protocol stream",
    );
    this.#context = `${provision.surfaceId} ${provision.generation} ${provision.geometryGeneration}`;
    this.exited = process.exited.then((status) => new Error(`Bot Screen input helper exited with status ${status}`));
  }

  static async start(
    binary: string,
    outputName: string,
    launcherEnvironment: Record<string, string>,
    provision: BotScreenProvision,
    commandPrefix: string[],
  ): Promise<WaylandVirtualInput> {
    const process = Bun.spawn([
      ...commandPrefix,
      binary,
      outputName,
      provision.surfaceId,
      String(provision.generation),
      String(provision.geometryGeneration),
      String(provision.logicalWidth),
      String(provision.logicalHeight),
    ], {
      env: launcherEnvironment,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const input = new WaylandVirtualInput(process, provision);
    const ready = await Promise.race([
      input.#responses.next(),
      process.exited.then(async (status) => {
        const stderr = await new Response(process.stderr).text();
        throw new Error(
          `Bot Screen input helper exited with status ${status}${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`,
        );
      }),
      Bun.sleep(5_000).then(() => {
        throw new Error("Bot Screen input helper did not become ready");
      }),
    ]);
    if (ready !== "READY") {
      process.kill("SIGTERM");
      throw new Error("Bot Screen input helper returned an invalid readiness response");
    }
    return input;
  }

  setInputAuthority(controllerEpoch: number): Promise<void> {
    const requestSequence = ++this.#requestSequence;
    return this.#command(
      `authority ${requestSequence} ${this.#context} ${controllerEpoch}`,
      requestSequence,
    );
  }

  input(event: BotScreenInputEvent): Promise<void> {
    const requestSequence = ++this.#requestSequence;
    const envelope = `${event.surfaceId} ${event.runtimeGeneration} ${event.geometryGeneration} ${event.controllerEpoch} ${event.sequence}`;
    if (event.type === "motion") {
      return this.#command(`motion ${requestSequence} ${envelope} ${event.x} ${event.y}`, requestSequence);
    }
    if (event.type === "button") {
      const button = event.button === "left" ? 272 : event.button === "right" ? 273 : 274;
      return this.#command(
        `button ${requestSequence} ${envelope} ${event.x} ${event.y} ${button} ${
          event.state === "pressed" ? 1 : 0
        }`,
        requestSequence,
      );
    }
    if (event.type === "scroll") {
      return this.#command(
        `scroll ${requestSequence} ${envelope} ${event.x} ${event.y} ${event.deltaX} ${event.deltaY}`,
        requestSequence,
      );
    }
    if (event.type === "key") {
      return this.#command(
        `key ${requestSequence} ${envelope} ${event.keyCode} ${event.state === "pressed" ? 1 : 0}`,
        requestSequence,
      );
    }
    return this.#command(
      `paste ${requestSequence} ${envelope} ${Buffer.from(event.text, "utf8").toString("base64")}`,
      requestSequence,
    );
  }

  release(controllerEpoch?: number): Promise<void> {
    const requestSequence = ++this.#requestSequence;
    return this.#command(
      `release ${requestSequence} ${this.#context} ${controllerEpoch ?? 0}`,
      requestSequence,
    );
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    if (this.#terminalError === undefined) await this.release().catch(() => {});
    this.#stopped = true;
    this.process.stdin.end();
    const exited = await Promise.race([
      this.process.exited.then(() => true),
      Bun.sleep(1_000).then(() => false),
    ]);
    if (exited) return;
    this.process.kill("SIGTERM");
    const terminated = await Promise.race([
      this.process.exited.then(() => true),
      Bun.sleep(1_000).then(() => false),
    ]);
    if (terminated) return;
    this.process.kill("SIGKILL");
    await this.process.exited;
  }


  #command(line: string, requestSequence: number): Promise<void> {
    const operation = this.#operations.then(async () => {
      if (this.#terminalError !== undefined) throw this.#terminalError;
      if (this.#stopped || this.process.exitCode !== null) throw new Error("Bot Screen input helper is not running");
      let timeout: Timer | undefined;
      let response: string;
      try {
        const exchange = (async () => {
          this.process.stdin.write(`${line}\n`);
          await this.process.stdin.flush();
          return this.#responses.next();
        })();
        response = await Promise.race([
          exchange,
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(() => {
              const error = new Error("Bot Screen input helper RPC timed out");
              this.#terminalError = error;
              this.process.kill("SIGTERM");
              reject(error);
            }, INPUT_RPC_TIMEOUT_MS);
            timeout.unref?.();
          }),
        ]);
      } catch (cause) {
        const error = this.#terminalError
          ?? (cause instanceof Error ? cause : new Error(String(cause)));
        this.#terminalError = error;
        this.process.kill("SIGTERM");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
      if (response === `OK ${requestSequence}`) return;
      const rejectionPrefix = `ERR ${requestSequence} `;
      if (response.startsWith(rejectionPrefix)) {
        throw new BotScreenInputRejectedError(response.slice(rejectionPrefix.length));
      }
      const error = new Error("Bot Screen input helper returned an invalid protocol response");
      this.#terminalError = error;
      this.process.kill("SIGTERM");
      throw error;
    });
    this.#operations = operation.catch(() => {});
    return operation;
  }

}

class CaptureProtocolReader {
  #chunks: Uint8Array[] = [];
  #decoder = new TextDecoder();
  #offset = 0;

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async readLine(): Promise<string> {
    const bytes: number[] = [];
    for (;;) {
      const byte = await this.#readByte();
      if (byte === 0x0a) return this.#decoder.decode(Uint8Array.from(bytes));
      bytes.push(byte);
      if (bytes.length > 128) throw new Error("Bot Screen capture helper returned an oversized frame header");
    }
  }

  async readBytes(length: number): Promise<Uint8Array> {
    const bytes = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      await this.#ensureChunk();
      const chunk = this.#chunks[0]!;
      const available = chunk.byteLength - this.#offset;
      const count = Math.min(available, length - written);
      bytes.set(chunk.subarray(this.#offset, this.#offset + count), written);
      written += count;
      this.#offset += count;
      if (this.#offset === chunk.byteLength) {
        this.#chunks.shift();
        this.#offset = 0;
      }
    }
    return bytes;
  }

  async #readByte(): Promise<number> {
    await this.#ensureChunk();
    const chunk = this.#chunks[0]!;
    const byte = chunk[this.#offset]!;
    this.#offset += 1;
    if (this.#offset === chunk.byteLength) {
      this.#chunks.shift();
      this.#offset = 0;
    }
    return byte;
  }

  async #ensureChunk(): Promise<void> {
    while (this.#chunks.length === 0) {
      const chunk = await this.reader.read();
      if (chunk.done) throw new Error("Bot Screen capture helper closed its protocol stream");
      if (chunk.value.byteLength > 0) this.#chunks.push(chunk.value);
    }
  }
}

class WaylandCaptureStream implements BotScreenCaptureStream {
  #captureInFlight = false;
  #stopped = false;
  #terminalError: Error | undefined;

  private constructor(
    private readonly process: CaptureProcess,
    private readonly protocol: CaptureProtocolReader,
    private readonly stderrOutput: Promise<string>,
    private readonly expectedWidth: number,
    private readonly expectedHeight: number,
  ) {}

  static async start(
    binary: string,
    outputName: string,
    environment: Record<string, string>,
    expectedWidth: number,
    expectedHeight: number,
    commandPrefix: readonly string[] = [],
  ): Promise<WaylandCaptureStream> {
    const process = Bun.spawn([...commandPrefix, binary, outputName], {
      env: environment,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const protocol = new CaptureProtocolReader(process.stdout.getReader());
    const stderrOutput = new Response(process.stderr).text();
    let ready: string;
    try {
      ready = await Promise.race([
        protocol.readLine(),
        process.exited.then(async (status) => {
          const stderr = await stderrOutput;
          throw new Error(
            `Bot Screen capture helper exited with status ${status}${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`,
          );
        }),
        Bun.sleep(5_000).then(() => {
          throw new Error("Bot Screen capture helper did not become ready");
        }),
      ]);
    } catch (error) {
      await terminateCapture(process);
      throw error;
    }
    if (ready !== "READY") {
      await terminateCapture(process);
      throw new Error("Bot Screen capture helper returned an invalid readiness response");
    }
    return new WaylandCaptureStream(process, protocol, stderrOutput, expectedWidth, expectedHeight);
  }

  async next(): Promise<BotScreenCaptureFrame> {
    if (this.#terminalError !== undefined) throw this.#terminalError;
    if (this.#stopped || this.process.exitCode !== null) throw new Error("Bot Screen capture stream is closed");
    if (this.#captureInFlight) throw new Error("Bot Screen capture stream already has a pending frame");
    this.#captureInFlight = true;
    let timeout: Timer | undefined;
    try {
      const capture = (async () => {
        this.process.stdin.write("capture\n");
        await this.process.stdin.flush();
        const header = (await this.protocol.readLine()).split(" ");
        if (header.length !== 4 || header[0] !== "FRAME") {
          throw new Error("Bot Screen capture helper returned an invalid frame header");
        }
        const width = Number(header[1]);
        const height = Number(header[2]);
        const byteLength = Number(header[3]);
        if (
          width !== this.expectedWidth
          || height !== this.expectedHeight
          || !Number.isSafeInteger(byteLength)
          || byteLength !== width * height * 4
        ) {
          throw new Error("Bot Screen capture helper returned unexpected frame geometry");
        }
        const capturedAt = new Date();
        const raw = await this.protocol.readBytes(byteLength);
        return {
          pixelFormat: "rgba" as const,
          width,
          height,
          bytes: raw,
          capturedAt,
        };
      })();
      return await Promise.race([
        capture,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("Bot Screen capture helper RPC timed out")), CAPTURE_RPC_TIMEOUT_MS);
          timeout.unref?.();
        }),
      ]);
    } catch (cause) {
      this.process.kill("SIGTERM");
      const stderr = await Promise.race([
        this.stderrOutput,
        Bun.sleep(100).then(() => ""),
      ]);
      const message = cause instanceof Error ? cause.message : String(cause);
      const error = new Error(`${message}${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`);
      this.#terminalError = error;
      throw error;
    } finally {
      clearTimeout(timeout);
      this.#captureInFlight = false;
    }
  }

  async close(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    if (this.process.exitCode !== null) return;
    if (this.#terminalError === undefined) {
      try {
        this.process.stdin.write("close\n");
        await this.process.stdin.flush();
      } catch {
        // The capture helper may have exited while teardown was writing its final request.
      }
    }
    this.process.stdin.end();
    const exited = await Promise.race([
      this.process.exited.then(() => true),
      Bun.sleep(1_000).then(() => false),
    ]);
    if (exited) return;
    this.process.kill("SIGTERM");
    const terminated = await Promise.race([
      this.process.exited.then(() => true),
      Bun.sleep(1_000).then(() => false),
    ]);
    if (terminated) return;
    this.process.kill("SIGKILL");
    await this.process.exited;
  }
}

function explicitEnvironment(input: {
  runtimeDir: string;
  waylandDisplay: string;
  configHome: string;
  stateHome: string;
  cacheHome: string;
}): Record<string, string> {
  const env: Record<string, string> = {
    HOME: process.env.HOME ?? path.dirname(input.configHome),
    LANG: process.env.LANG ?? "C.UTF-8",
    LOGNAME: process.env.LOGNAME ?? process.env.USER ?? "",
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    USER: process.env.USER ?? "",
    XDG_CACHE_HOME: input.cacheHome,
    XDG_CONFIG_HOME: input.configHome,
    XDG_RUNTIME_DIR: input.runtimeDir,
    XDG_SESSION_TYPE: "wayland",
    XDG_STATE_HOME: input.stateHome,
    WAYLAND_DISPLAY: input.waylandDisplay,
    GDK_BACKEND: "wayland",
    MOZ_ENABLE_WAYLAND: "1",
    QT_QPA_PLATFORM: "wayland",
  };
  for (const key of ["OMARCHY_COMPUTER_BIN", "OMARCHY_BOT_COMPUTER_BIN"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

function isSocket(candidate: string): boolean {
  try {
    return lstatSync(candidate).isSocket();
  } catch {
    return false;
  }
}

class ProcessLineReader {
  #reader: ReadableStreamDefaultReader<Uint8Array>;
  #decoder = new TextDecoder();
  #buffer = "";

  constructor(
    stream: ReadableStream<Uint8Array>,
    private readonly eofMessage = "Bot Desktop closed its readiness stream",
  ) {
    this.#reader = stream.getReader();
  }

  async next(): Promise<string> {
    for (;;) {
      const newline = this.#buffer.indexOf("\n");
      if (newline >= 0) {
        const line = this.#buffer.slice(0, newline);
        this.#buffer = this.#buffer.slice(newline + 1);
        return line;
      }
      const chunk = await this.#reader.read();
      if (chunk.done) throw new Error(this.eofMessage);
      this.#buffer += this.#decoder.decode(chunk.value, { stream: true });
    }
  }
}

async function terminateCageProcess(child: CageProcess): Promise<void> {
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  if (child.exitCode !== null) return;
  const stopped = await Promise.race([
    child.exited.then(() => true),
    Bun.sleep(3_000).then(() => false),
  ]);
  if (stopped) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
  await child.exited;
}

/**
 * Pure-headless Cage adapter. A dormant Cage child keeps compositor lifetime
 * independent from the separately supervised persistent Bot Desktop; real
 * applications remain descendants of the Surface-bound computer worker.
 */
export class CageBotScreenRuntimeAdapter implements BotScreenRuntimeAdapter {
  #units: ApplicationUnits;

  constructor(private readonly options: CageAdapterOptions) {
    this.#units = new ApplicationUnits(options.hostRuntimeDir);
  }

  async start(provision: BotScreenProvision): Promise<BotScreenRuntime> {
    await this.#units.stop(provision.surfaceId);
    if (!Number.isSafeInteger(provision.scale) || provision.scale < 1) {
      throw new Error("Cage Bot Screen scale must be a positive integer");
    }
    const encoderEnvironment = {
      HOME: process.env.HOME ?? "",
      LANG: process.env.LANG ?? "C.UTF-8",
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    };
    await requireH264Encoder(
      this.options.ffmpegBin,
      this.#units.command(provision.surfaceId, provision.generation, "encoder-preflight", encoderEnvironment),
      this.#units.enabled ? this.#units.launcherEnvironment(encoderEnvironment) : undefined,
    );
    await this.#units.stop(provision.surfaceId, provision.generation);
    const cage = executable(this.options.cageBin, "cage");
    const wlrRandr = executable(this.options.wlrRandrBin, "wlr-randr");
    const grim = executable(this.options.grimBin, "grim");
    if (cage === undefined || wlrRandr === undefined || grim === undefined) {
      throw new Error("Cage, wlr-randr, and grim are required for the Cage Bot Screen runtime");
    }
    const [inputHelper, captureHelper, botDesktop] = await Promise.all([
      this.options.inputHelperBin === undefined
        ? ensureInputHelper()
        : Promise.resolve(executable(this.options.inputHelperBin, this.options.inputHelperBin)),
      this.options.captureHelperBin === undefined
        ? ensureCaptureHelper()
        : Promise.resolve(executable(this.options.captureHelperBin, this.options.captureHelperBin)),
      this.options.botDesktopBin === undefined
        ? ensureBotDesktop()
        : Promise.resolve(executable(this.options.botDesktopBin, this.options.botDesktopBin)),
    ]);
    if (inputHelper === undefined || captureHelper === undefined || botDesktop === undefined) {
      throw new Error("Bot Desktop and the Bot Screen capture/input helpers are required for Cage");
    }

    const runtimeSurfaceDir = path.join(this.options.runtimeRoot, provision.surfaceId);
    const runtimeDir = path.join(runtimeSurfaceDir, String(provision.generation));
    const profileDir = path.join(this.options.profileRoot, provision.surfaceId);
    const configHome = path.join(profileDir, "config");
    const stateHome = path.join(profileDir, "state");
    const cacheHome = path.join(profileDir, "cache");
    rmSync(runtimeSurfaceDir, { recursive: true, force: true });
    for (const directory of [
      this.options.runtimeRoot,
      runtimeSurfaceDir,
      runtimeDir,
      profileDir,
      configHome,
      stateHome,
      cacheHome,
    ]) {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      chmodSync(directory, 0o700);
    }

    const bootstrapEnv = {
      ...explicitEnvironment({
        runtimeDir,
        waylandDisplay: "wayland-0",
        configHome,
        stateHome,
        cacheHome,
      }),
      WLR_BACKENDS: "headless",
      WLR_HEADLESS_OUTPUTS: "1",
      WLR_LIBINPUT_NO_DEVICES: "1",
      WLR_RENDERER_ALLOW_SOFTWARE: "1",
    };
    const cageProcess = Bun.spawn([
      ...this.#units.command(provision.surfaceId, provision.generation, "compositor", bootstrapEnv),
      cage,
      "-d",
      "--",
      botDesktop,
      "--host",
    ], {
      env: this.#units.launcherEnvironment(bootstrapEnv),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    });
    let desktopProcess: CageProcess | undefined;
    let computerWorker: SurfaceComputerWorker | undefined;
    let virtualInput: WaylandVirtualInput | undefined;
    try {
      const waylandSocket = await this.#discoverSocket(runtimeDir, cageProcess);
      const childEnv = explicitEnvironment({
        runtimeDir,
        waylandDisplay: waylandSocket,
        configHome,
        stateHome,
        cacheHome,
      });
      const outputName = "HEADLESS-1";
      const videoWidth = Math.round(provision.logicalWidth * provision.scale);
      const videoHeight = Math.round(provision.logicalHeight * provision.scale);
      const configured = await command([
        wlrRandr,
        "--output",
        outputName,
        "--on",
        "--custom-mode",
        `${videoWidth}x${videoHeight}@${provision.refreshRate}Hz`,
        "--pos",
        "0,0",
        "--transform",
        "normal",
        "--scale",
        String(provision.scale),
      ], childEnv);
      if (configured.status !== 0) {
        throw new Error(
          `Cage output configuration failed${configured.stderr.trim() === "" ? "" : `: ${configured.stderr.trim()}`}`,
        );
      }
      const startedDesktop = Bun.spawn([
        ...this.#units.command(provision.surfaceId, provision.generation, "application", childEnv),
        botDesktop,
        String(provision.logicalWidth),
        String(provision.logicalHeight),
        String(provision.scale),
      ], {
        env: this.#units.launcherEnvironment(childEnv),
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        detached: true,
      });
      desktopProcess = startedDesktop;
      const desktopReadiness = new ProcessLineReader(startedDesktop.stdout);
      await this.#waitForDesktop(
        desktopReadiness,
        startedDesktop,
        provision.logicalWidth,
        provision.logicalHeight,
      );
      await this.#capture(grim, childEnv, outputName, videoWidth, videoHeight);

      const startedVirtualInput = await WaylandVirtualInput.start(
        inputHelper,
        outputName,
        this.#units.launcherEnvironment(childEnv),
        provision,
        this.#units.command(provision.surfaceId, provision.generation, "input", childEnv),
      );
      virtualInput = startedVirtualInput;
      const startedComputerWorker = await this.options.computerWorkers.startComputerWorker({
        surfaceId: provision.surfaceId,
        runtimeGeneration: provision.generation,
        env: childEnv,
        wrapCommand: (targetEnvironment) => ({
          commandPrefix: this.#units.command(provision.surfaceId, provision.generation, "worker", targetEnvironment),
          launcherEnvironment: this.#units.launcherEnvironment(targetEnvironment),
        }),
      });
      computerWorker = startedComputerWorker;
      const outcome = Promise.race<BotScreenRuntimeOutcome>([
        cageProcess.exited.then((status) => ({
          type: "compositor-exited",
          error: new Error(`Cage compositor exited with status ${status}`),
        })),
        startedDesktop.exited.then((status) => ({
          type: "desktop-exited",
          error: new Error(`Bot Desktop exited with status ${status}`),
        })),
        startedComputerWorker.exited.then((error) => ({ type: "computer-worker-exited", error })),
        startedVirtualInput.exited.then((error) => ({ type: "input-helper-exited", error })),
      ]);

      let stopped = false;
      let cleanupComplete = false;
      let stopInFlight: Promise<void> | undefined;
      const captureStreams = new Set<BotScreenCaptureStream>();
      const captureStreamStarts = new Set<Promise<void>>();
      let captureStreamSequence = 0;
      const capture = async (): Promise<BotScreenCapture> => {
        if (stopped || cageProcess.exitCode !== null) throw new Error("Cage Bot Screen compositor is not running");
        if (startedDesktop.exitCode !== null) throw new Error("Bot Desktop is not running");
        return this.#capture(grim, childEnv, outputName, videoWidth, videoHeight);
      };
      const openCaptureStream = async (): Promise<BotScreenCaptureStream> => {
        if (stopped || cageProcess.exitCode !== null) throw new Error("Cage Bot Screen compositor is not running");
        if (startedDesktop.exitCode !== null) throw new Error("Bot Desktop is not running");
        const opening = Promise.withResolvers<void>();
        captureStreamStarts.add(opening.promise);
        try {
          const stream = await WaylandCaptureStream.start(
            captureHelper,
            outputName,
            this.#units.launcherEnvironment(childEnv),
            videoWidth,
            videoHeight,
            this.#units.command(
              provision.surfaceId,
              provision.generation,
              `capture-${++captureStreamSequence}`,
              childEnv,
            ),
          );
          if (stopped || cageProcess.exitCode !== null) {
            await stream.close();
            throw new Error("Cage Bot Screen compositor is not running");
          }
          let closed = false;
          let lease!: BotScreenCaptureStream;
          const close = async (): Promise<void> => {
            if (closed) return;
            closed = true;
            captureStreams.delete(lease);
            await stream.close();
          };
          lease = {
            next: async () => {
              try {
                return await stream.next();
              } catch (error) {
                await close().catch(() => {});
                throw error;
              }
            },
            close,
          };
          captureStreams.add(lease);
          return lease;
        } finally {
          opening.resolve();
          captureStreamStarts.delete(opening.promise);
        }
      };
      const act = async (
        action: ComputerAction,
        inputAuthority?: ComputerInputAuthority,
      ): Promise<BotScreenActionResult> => {
        if (action.name === "screenshot") return { image: await capture() };
        const result = await startedComputerWorker.act(action, inputAuthority);
        const workerImage = result.image === undefined
          ? undefined
          : {
              mediaType: result.image.mediaType,
              bytes: new Uint8Array(Buffer.from(result.image.base64, "base64")),
            };
        return {
          ...(result.text === undefined ? {} : { text: result.text }),
          ...(result.windowList === undefined ? {} : { windowList: result.windowList }),
          ...(workerImage === undefined && action.name === "observe"
            ? { image: await capture() }
            : workerImage === undefined ? {} : { image: workerImage }),
        };
      };
      return {
        readiness: {
          compositor: "ready",
          waylandSocket: "private",
          output: {
            geometryGeneration: provision.geometryGeneration,
            logicalWidth: provision.logicalWidth,
            logicalHeight: provision.logicalHeight,
            scale: provision.scale,
            refreshRate: provision.refreshRate,
          },
          desktopSurface: "ready",
          capture: "ready",
          input: "ready",
          computerWorker: "ready",
        },
        capture,
        openCaptureStream,
        act,
        setInputAuthority: (controllerEpoch) => startedVirtualInput.setInputAuthority(controllerEpoch),
        input: (event) => startedVirtualInput.input(event),
        releaseInput: (controllerEpoch) => startedVirtualInput.release(controllerEpoch),
        outcome,
        stop: async () => {
          stopped = true;
          if (cleanupComplete) return;
          if (stopInFlight !== undefined) return stopInFlight;
          const cleanup = (async (): Promise<void> => {
            await startedVirtualInput.stop().catch(() => {});
            await Promise.allSettled(captureStreamStarts);
            await Promise.allSettled([...captureStreams].map((stream) => stream.close()));
            await Promise.allSettled([
              startedComputerWorker.stop(),
              terminateCageProcess(startedDesktop),
              terminateCageProcess(cageProcess),
            ]);
            await this.#units.stop(provision.surfaceId, provision.generation);
            rmSync(runtimeSurfaceDir, { recursive: true, force: true });
          })();
          stopInFlight = cleanup;
          try {
            await cleanup;
            cleanupComplete = true;
          } finally {
            stopInFlight = undefined;
          }
        },
      };
    } catch (error) {
      await computerWorker?.stop().catch(() => {});
      await virtualInput?.stop().catch(() => {});
      if (desktopProcess !== undefined) await terminateCageProcess(desktopProcess).catch(() => {});
      await terminateCageProcess(cageProcess).catch(() => {});
      await this.#units.stop(provision.surfaceId, provision.generation);
      rmSync(runtimeSurfaceDir, { recursive: true, force: true });
      throw error;
    }
  }

  async reconcile(provision: BotScreenProvision): Promise<BotScreenRuntime | undefined> {
    await this.#units.stop(provision.surfaceId);
    rmSync(path.join(this.options.runtimeRoot, provision.surfaceId), { recursive: true, force: true });
    return undefined;
  }

  async destroy(surfaceId: SurfaceId): Promise<void> {
    await this.#units.stop(surfaceId);
    rmSync(path.join(this.options.runtimeRoot, surfaceId), { recursive: true, force: true });
    rmSync(path.join(this.options.profileRoot, surfaceId), { recursive: true, force: true });
  }

  async #discoverSocket(runtimeDir: string, cageProcess: CageProcess): Promise<string> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (cageProcess.exitCode !== null) {
        const stderr = await new Response(cageProcess.stderr).text();
        throw new Error(`Cage exited before readiness${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`);
      }
      const socket = readdirSync(runtimeDir).find((entry) =>
        /^wayland-\d+$/.test(entry) && isSocket(path.join(runtimeDir, entry))
      );
      if (socket !== undefined) return socket;
      await Bun.sleep(20);
    }
    throw new Error("Cage did not create its private Wayland socket");
  }

  async #waitForDesktop(
    readiness: ProcessLineReader,
    desktopProcess: CageProcess,
    width: number,
    height: number,
  ): Promise<void> {
    const expected = `READY ${width} ${height}`;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const line = await Promise.race([
        readiness.next(),
        desktopProcess.exited.then(() => {
          throw new Error("Bot Desktop exited during startup");
        }),
        Bun.sleep(Math.max(1, deadline - Date.now())).then(() => {
          throw new Error("Bot Desktop did not commit the configured output surface");
        }),
      ]);
      if (line === expected) return;
    }
    throw new Error("Bot Desktop did not commit the configured output surface");
  }

  async #capture(
    grim: string,
    environment: Record<string, string>,
    outputName: string,
    expectedWidth: number,
    expectedHeight: number,
  ): Promise<BotScreenCapture> {
    const shot = Bun.spawn([grim, "-o", outputName, "-"], {
      env: environment,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, bytes, stderr] = await Promise.all([
      shot.exited,
      new Response(shot.stdout).arrayBuffer(),
      new Response(shot.stderr).text(),
    ]);
    const image = new Uint8Array(bytes);
    if (status !== 0 || image.length < 8 || image[0] !== 0x89 || image[1] !== 0x50) {
      throw new Error(`Cage Bot Screen capture failed${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`);
    }
    const metadata = await sharp(image).metadata();
    if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
      throw new Error("Cage Bot Screen capture geometry does not match its configured output");
    }
    return { mediaType: "image/png", bytes: image };
  }
}
