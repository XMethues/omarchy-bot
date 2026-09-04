import { SCREEN_H264_CLOCK_RATE, SCREEN_H264_PROFILE } from "@omarchy-bot/protocol";

const H264_AUD_NAL_TYPE = 9;
const H264_IDR_NAL_TYPE = 5;
const H264_SPS_NAL_TYPE = 7;
const H264_PPS_NAL_TYPE = 8;
const MAX_ACCESS_UNIT_BYTES = 8 * 1024 * 1024;
const ENCODER_WRITE_TIMEOUT_MS = 1_000;

export interface H264OfferCodec {
  mid: string;
  payloadType: number;
  profileLevelId: typeof SCREEN_H264_PROFILE;
}

export interface H264AccessUnit {
  bytes: Buffer;
  keyframe: boolean;
}

export interface H264EncoderWriteResult {
  /** True when this capture superseded an older frame that had not reached ffmpeg. */
  replacedPendingFrame: boolean;
}

export interface H264EncoderProcess {
  writeFrame(bytes: Uint8Array): H264EncoderWriteResult;
  requestKeyframe(): void;
  readonly done: Promise<void>;
  close(): Promise<void>;
}

interface H264EncoderOptions {
  width: number;
  height: number;
  frameRate: number;
  binary?: string;
  commandPrefix?: (generation: number) => readonly string[];
  launcherEnvironment?: Record<string, string>;
  onAccessUnit(accessUnit: H264AccessUnit): void;
}

function videoSection(sdp: string): string | undefined {
  const normalized = sdp.replaceAll("\r\n", "\n");
  return normalized.split(/(?=^m=)/m).find((section) => section.startsWith("m=video "));
}

/** Selects the browser's Baseline H.264 payload and rejects offers that cannot receive it. */
export function parseH264ReceiveOffer(sdp: string): H264OfferCodec {
  const section = videoSection(sdp);
  if (section === undefined || !/^a=(?:recvonly|sendrecv)$/m.test(section)) {
    throw new Error("Expanded Web Control requires an H.264 receive video direction");
  }
  const mid = section.match(/^a=mid:(\S+)$/m)?.[1];
  if (mid === undefined) throw new Error("Expanded Web Control offer is missing its video media identity");
  const codecs = new Map<number, string>();
  for (const match of section.matchAll(/^a=rtpmap:(\d+)\s+([^/\s]+)\/90000(?:\/\d+)?$/gim)) {
    codecs.set(Number(match[1]), match[2]!.toLowerCase());
  }
  for (const match of section.matchAll(/^a=fmtp:(\d+)\s+(.+)$/gim)) {
    const payloadType = Number(match[1]);
    if (codecs.get(payloadType) !== "h264") continue;
    const parameters = new Map(
      match[2]!.split(";").map((entry) => {
        const [name, value = ""] = entry.trim().split("=", 2);
        return [name!.toLowerCase(), value.toLowerCase()] as const;
      }),
    );
    if (
      parameters.get("packetization-mode") === "1"
      && parameters.get("profile-level-id") === SCREEN_H264_PROFILE
    ) return { mid, payloadType, profileLevelId: SCREEN_H264_PROFILE };
  }
  throw new Error("Expanded Web Control requires browser-compatible H.264 Baseline video");
}


function startCodeLength(bytes: Buffer, offset: number): number {
  if (bytes[offset] !== 0 || bytes[offset + 1] !== 0) return 0;
  if (bytes[offset + 2] === 1) return 3;
  return bytes[offset + 2] === 0 && bytes[offset + 3] === 1 ? 4 : 0;
}

function nalUnits(bytes: Buffer): Array<{ offset: number; type: number }> {
  const units: Array<{ offset: number; type: number }> = [];
  for (let offset = 0; offset < bytes.byteLength - 3; offset += 1) {
    const prefix = startCodeLength(bytes, offset);
    if (prefix === 0 || offset + prefix >= bytes.byteLength) continue;
    units.push({ offset, type: bytes[offset + prefix]! & 0x1f });
    offset += prefix - 1;
  }
  return units;
}

function accessUnit(bytes: Buffer): H264AccessUnit {
  const types = new Set(nalUnits(bytes).map((unit) => unit.type));
  const keyframe = types.has(H264_IDR_NAL_TYPE);
  if (keyframe && (!types.has(H264_SPS_NAL_TYPE) || !types.has(H264_PPS_NAL_TYPE))) {
    throw new Error("H.264 keyframe did not include codec headers");
  }
  return { bytes, keyframe };
}

/** Incrementally splits Annex-B output at access-unit delimiters. */
export class H264AccessUnitParser {
  #pending = Buffer.alloc(0);

  push(chunk: Uint8Array): H264AccessUnit[] {
    if (chunk.byteLength === 0) return [];
    if (this.#pending.byteLength + chunk.byteLength > MAX_ACCESS_UNIT_BYTES) {
      this.#pending = Buffer.alloc(0);
      throw new Error("H.264 encoder produced an oversized access unit");
    }
    const incoming = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    this.#pending = this.#pending.byteLength === 0
      ? Buffer.from(incoming)
      : Buffer.concat([this.#pending, incoming], this.#pending.byteLength + incoming.byteLength);
    return this.#drain(false);
  }

  finish(): H264AccessUnit[] {
    return this.#drain(true);
  }

  #drain(finishing: boolean): H264AccessUnit[] {
    const emitted: H264AccessUnit[] = [];
    while (this.#pending.byteLength > 0) {
      const delimiters = nalUnits(this.#pending)
        .filter((unit) => unit.type === H264_AUD_NAL_TYPE)
        .map((unit) => unit.offset);
      if (delimiters.length === 0) {
        if (finishing) this.#pending = Buffer.alloc(0);
        return emitted;
      }
      if (delimiters.length === 1 && !finishing) return emitted;
      const end = delimiters[1] ?? this.#pending.byteLength;
      emitted.push(accessUnit(Buffer.from(this.#pending.subarray(0, end))));
      this.#pending = this.#pending.subarray(end);
    }
    return emitted;
  }
}

export function h264Timestamp(sequence: number, frameRate: number): number {
  return Math.round(sequence * SCREEN_H264_CLOCK_RATE / frameRate) >>> 0;
}

/** Starts one long-lived raw RGBA encoder for an expanded projection session. */
export function startH264Encoder(options: H264EncoderOptions): H264EncoderProcess {
  if (!Number.isSafeInteger(options.width) || options.width <= 0
    || !Number.isSafeInteger(options.height) || options.height <= 0) {
    throw new Error("H.264 encoder requires positive integer geometry");
  }
  const binary = options.binary ?? process.env.OMARCHY_BOT_FFMPEG_BIN ?? "ffmpeg";
  const executable = Bun.which(binary);
  if (executable === null) throw new Error("Expanded Web Control requires ffmpeg with libx264");
  const keyframeInterval = options.frameRate * 2;
  const lifetime = Promise.withResolvers<void>();
  let closing = false;
  let failed = false;
  let closePromise: Promise<void> | undefined;
  let pendingFrame: Uint8Array | undefined;
  let pump: Promise<void> | undefined;
  let keyframeRequested = false;
  let generationSequence = 0;

  interface EncoderGeneration {
    id: number;
    process: Bun.Subprocess;
    writer: WritableStreamDefaultWriter<Uint8Array>;
    done: Promise<void>;
    stopping: boolean;
  }

  let current: EncoderGeneration | undefined;

  const fail = (cause: unknown): void => {
    if (closing || failed) return;
    failed = true;
    lifetime.reject(cause instanceof Error ? cause : new Error(String(cause)));
  };

  const spawnGeneration = (): EncoderGeneration => {
    const id = ++generationSequence;
    const input = new TransformStream<Uint8Array, Uint8Array>();
    const writer = input.writable.getWriter();
    const processHandle = Bun.spawn({
      cmd: [
        ...(options.commandPrefix?.(id) ?? []),
        executable,
        "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo", "-pixel_format", "rgba",
        "-video_size", `${options.width}x${options.height}`, "-framerate", String(options.frameRate), "-i", "pipe:0",
        "-an", "-c:v", "libx264", "-preset", "ultrafast", "-tune", "zerolatency",
        "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2,format=yuv420p",
        "-profile:v", "baseline",
        "-x264-params", `repeat-headers=1:aud=1:keyint=${keyframeInterval}:min-keyint=${keyframeInterval}:scenecut=0`,
        "-f", "h264", "pipe:1",
      ],
      stdin: input.readable,
      stdout: "pipe",
      stderr: "pipe",
      ...(options.launcherEnvironment === undefined ? {} : { env: options.launcherEnvironment }),
    });
    const parser = new H264AccessUnitParser();
    const generation = {
      id,
      process: processHandle,
      writer,
      done: Promise.resolve(),
      stopping: false,
    } satisfies EncoderGeneration;
    const stderr = new Response(processHandle.stderr).text();
    const output = (async () => {
      for await (const chunk of processHandle.stdout) {
        for (const unit of parser.push(chunk)) {
          if (current?.id === generation.id && !generation.stopping) options.onAccessUnit(unit);
        }
      }
      for (const unit of parser.finish()) {
        if (current?.id === generation.id && !generation.stopping) options.onAccessUnit(unit);
      }
    })();
    generation.done = Promise.all([processHandle.exited, output, stderr]).then(([status, , errorOutput]) => {
      if (!generation.stopping && !closing) {
        throw new Error(
          status === 0
            ? "H.264 encoder exited unexpectedly"
            : `H.264 encoder exited with status ${status}${errorOutput.trim() === "" ? "" : `: ${errorOutput.trim()}`}`,
        );
      }
    });
    void generation.done.catch(fail);
    return generation;
  };

  const stopGeneration = async (generation: EncoderGeneration): Promise<void> => {
    if (!generation.stopping) {
      generation.stopping = true;
      await generation.writer.close().catch(() => {});
    }
    await Promise.race([
      generation.done.catch(() => {}),
      Bun.sleep(1_000).then(() => {
        if (generation.process.exitCode === null) generation.process.kill("SIGTERM");
      }),
    ]);
    if (generation.process.exitCode === null) await generation.process.exited;
    await generation.done.catch(() => {});
  };

  const drain = async (): Promise<void> => {
    while (!closing && !failed && pendingFrame !== undefined) {
      const frame = pendingFrame;
      pendingFrame = undefined;
      if (keyframeRequested) {
        keyframeRequested = false;
        const generation = current;
        current = undefined;
        if (generation !== undefined) await stopGeneration(generation);
        if (closing || failed) return;
        current = spawnGeneration();
      }
      const generation = current;
      if (generation === undefined) throw new Error("H.264 encoder is unavailable");
      if (closing || failed || generation.stopping) return;
      if (generation.process.exitCode !== null) {
        throw new Error("H.264 encoder exited while accepting a frame");
      }
      try {
        await Promise.race([
          generation.writer.write(frame),
          Bun.sleep(ENCODER_WRITE_TIMEOUT_MS).then(() => {
            throw new Error("H.264 encoder exceeded its frame latency bound");
          }),
        ]);
      } catch (error) {
        if (closing || generation.stopping) return;
        throw error;
      }
      if (closing || generation.stopping) return;
      if (generation.process.exitCode !== null) {
        throw new Error("H.264 encoder exited while accepting a frame");
      }
    }
  };

  const scheduleDrain = (): void => {
    if (pump !== undefined || closing || failed) return;
    const active = drain();
    pump = active;
    void active.catch(fail).finally(() => {
      if (pump === active) pump = undefined;
      if (pendingFrame !== undefined && !closing && !failed) scheduleDrain();
    });
  };

  current = spawnGeneration();

  return {
    done: lifetime.promise,
    writeFrame(bytes): H264EncoderWriteResult {
      if (bytes.byteLength !== options.width * options.height * 4) {
        throw new Error("H.264 encoder received invalid RGBA frame geometry");
      }
      if (closing || failed || current?.process.exitCode !== null) throw new Error("H.264 encoder is closed");
      const replacedPendingFrame = pendingFrame !== undefined;
      pendingFrame = bytes;
      scheduleDrain();
      return { replacedPendingFrame };
    },
    requestKeyframe(): void {
      if (!closing && !failed) keyframeRequested = true;
    },
    close(): Promise<void> {
      if (closePromise !== undefined) return closePromise;
      closing = true;
      pendingFrame = undefined;
      closePromise = (async () => {
        await pump?.catch(() => {});
        const generation = current;
        current = undefined;
        if (generation !== undefined) await stopGeneration(generation);
        if (!failed) lifetime.resolve();
        await lifetime.promise.catch(() => {});
      })();
      return closePromise;
    },
  };
}
