import { describe, expect, test } from "bun:test";
import {
  H264AccessUnitParser,
  h264Timestamp,
  parseH264ReceiveOffer,
  startH264Encoder,
} from "../../apps/daemon/src/modules/computer/h264Encoder.ts";

const start = [0, 0, 0, 1];
const nal = (type: number, payload = 0): number[] => [...start, type, payload];

describe("H.264 Screen Projection framing", () => {
  test("selects a Baseline packetized H.264 receive direction from the browser offer", () => {
    const offer = [
      "v=0",
      "m=video 9 UDP/TLS/RTP/SAVPF 104 96",
      "a=mid:0",
      "a=recvonly",
      "a=rtpmap:104 H264/90000",
      "a=fmtp:104 level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f",
      "a=rtpmap:96 VP8/90000",
      "",
    ].join("\r\n");

    expect(parseH264ReceiveOffer(offer)).toEqual({ mid: "0", payloadType: 104, profileLevelId: "42e01f" });
  });

  test("rejects an offer without a Baseline H.264 receive direction", () => {
    const sendOnly = [
      "v=0",
      "m=video 9 UDP/TLS/RTP/SAVPF 104",
      "a=sendonly",
      "a=rtpmap:104 H264/90000",
      "a=fmtp:104 packetization-mode=1;profile-level-id=42e01f",
      "",
    ].join("\r\n");
    expect(() => parseH264ReceiveOffer(sendOnly)).toThrow("receive video direction");
  });

  test("splits Annex-B access units across process chunks and retains headers with a keyframe", () => {
    // libx264 writes its initial SPS/PPS preamble before the first AUD. Those
    // headers belong to the following IDR access unit and must not be discarded.
    const keyframe = Buffer.from([
      ...nal(7, 1),
      ...nal(8, 2),
      ...nal(9),
      ...nal(5, 3),
    ]);
    const delta = Buffer.from([...nal(9), ...nal(1, 4)]);
    const bytes = Buffer.concat([keyframe, delta]);
    const parser = new H264AccessUnitParser();

    expect(parser.push(bytes.subarray(0, keyframe.byteLength - 2))).toEqual([]);
    const emitted = parser.push(bytes.subarray(keyframe.byteLength - 2));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.keyframe).toBeTrue();
    expect(emitted[0]?.bytes).toEqual(keyframe);
    expect(parser.finish()).toEqual([{ bytes: delta, keyframe: false }]);
  });

  test("rejects an IDR access unit without repeated SPS and PPS codec headers", () => {
    const parser = new H264AccessUnitParser();
    const incompleteKeyframe = Buffer.from([...nal(9), ...nal(5, 3), ...nal(9), ...nal(1, 4)]);
    expect(() => parser.push(incompleteKeyframe)).toThrow("codec headers");
  });


  test("emits the first Baseline access unit promptly from raw capture frames", async () => {
    const rgba = Buffer.alloc(2 * 1 * 4);
    const first = Promise.withResolvers<{ keyframe: boolean; byteLength: number }>();
    const encoder = startH264Encoder({
      width: 2,
      height: 1,
      frameRate: 15,
      onAccessUnit: (unit) => first.resolve({ keyframe: unit.keyframe, byteLength: unit.bytes.byteLength }),
    });
    try {
      await encoder.writeFrame(rgba);
      await encoder.writeFrame(rgba);
      await encoder.writeFrame(rgba);
      const accessUnit = await Promise.race([
      // This is a real ffmpeg process; fake timers cannot advance its OS pipe.
        first.promise,
        encoder.done.then(() => {
          throw new Error("ffmpeg exited before emitting an access unit");
        }),
        Bun.sleep(1_000).then(() => {
          throw new Error("ffmpeg did not emit a capture access unit promptly");
        }),
      ]);
      expect(accessUnit.keyframe).toBeTrue();
      expect(accessUnit.byteLength).toBeGreaterThan(0);
    } finally {
      await encoder.close();
    }
  });


  test("uses a distinct supervised command prefix for each requested keyframe generation", async () => {
    const rgba = Buffer.alloc(2 * 1 * 4);
    const first = Promise.withResolvers<void>();
    const recovered = Promise.withResolvers<void>();
    let recoveryRequested = false;
    const env = Bun.which("env");
    if (env === null) throw new Error("env is required by the encoder generation test");
    const commandPrefixes: string[][] = [];
    const encoder = startH264Encoder({
      width: 2,
      height: 1,
      frameRate: 15,
      commandPrefix: (generation) => {
        const prefix = [env, `ENCODER_GENERATION=${generation}`];
        commandPrefixes.push(prefix);
        return prefix;
      },
      onAccessUnit: (unit) => {
        first.resolve();
        if (recoveryRequested && unit.keyframe) recovered.resolve();
      },
    });
    try {
      for (let index = 0; index < 3; index += 1) {
        encoder.writeFrame(rgba);
        await Bun.sleep(10);
      }
      await Promise.race([
        first.promise,
        Bun.sleep(1_000).then(() => {
          throw new Error("ffmpeg did not emit its immediate keyframe");
        }),
      ]);
      recoveryRequested = true;
      encoder.requestKeyframe();
      for (let index = 0; index < 3; index += 1) {
        encoder.writeFrame(rgba);
        await Bun.sleep(10);
      }
      await Promise.race([
        recovered.promise,
        Bun.sleep(2_000).then(() => {
          throw new Error("ffmpeg did not emit a requested recovery keyframe");
        }),
      ]);
      expect(commandPrefixes.map((prefix) => prefix.at(-1)))
        .toEqual(["ENCODER_GENERATION=1", "ENCODER_GENERATION=2"]);
    } finally {
      await encoder.close();
    }
  });

  test("suppresses a supervised write failure only when restart teardown is already closing", async () => {
    const shell = Bun.which("sh");
    const placeholder = Bun.which("true");
    if (shell === null || placeholder === null) {
      throw new Error("sh and true are required by the encoder teardown test");
    }
    const secondGenerationStarted = Promise.withResolvers<void>();
    const frame = Buffer.alloc(1024 * 1024 * 4);
    const encoder = startH264Encoder({
      width: 1024,
      height: 1024,
      frameRate: 15,
      binary: placeholder,
      commandPrefix: (generation) => {
        if (generation === 2) secondGenerationStarted.resolve();
        return [
          shell,
          "-c",
          generation === 1 ? "cat >/dev/null" : "sleep 0.05",
          `encoder-generation-${generation}`,
        ];
      },
      onAccessUnit: () => {},
    });
    const failures: unknown[] = [];
    const completion = encoder.done.catch((error) => {
      failures.push(error);
    });
    encoder.requestKeyframe();
    encoder.writeFrame(frame);
    await secondGenerationStarted.promise;

    await Promise.all([encoder.close(), completion]);
    expect(failures).toEqual([]);
  });

  test("rejects lifetime when the active supervised encoder exits", async () => {
    const shell = Bun.which("sh");
    const placeholder = Bun.which("true");
    if (shell === null || placeholder === null) {
      throw new Error("sh and true are required by the encoder active-exit test");
    }
    const encoder = startH264Encoder({
      width: 1024,
      height: 1024,
      frameRate: 15,
      binary: placeholder,
      commandPrefix: () => [shell, "-c", "sleep 0.05; exit 17", "active-encoder"],
      onAccessUnit: () => {},
    });
    const activeFailure = expect(encoder.done).rejects.toBeInstanceOf(Error);

    await activeFailure;
    await encoder.close();
  });
  test("advances RTP timestamps on the 90 kHz video clock", () => {
    expect([0, 1, 2, 15].map((sequence) => h264Timestamp(sequence, 15)))
      .toEqual([0, 6_000, 12_000, 90_000]);
  });
});
