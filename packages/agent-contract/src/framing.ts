/** Internal daemon↔worker protocol. LF-delimited JSON over stdio. v1. */
export const PROTOCOL_VERSION = 1;
export const HEARTBEAT_MS = 10_000;
export const MAX_MESSAGE_BYTES = 4 * 1024 * 1024; // blobs go via artifact refs, never inline

export { type Hello } from "./shared.ts";
import type { Hello } from "./shared.ts";
export interface Heartbeat {
  type: "heartbeat";
}

export async function readJsonl(readable: ReadableStream<Uint8Array>, onMessage: (msg: unknown) => void, onClose?: () => void): Promise<void> {
  const reader = readable.getReader();
  let buf = "";
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      if (line.length > MAX_MESSAGE_BYTES) {
        onMessage({ type: "error", message: "frame exceeds MAX_MESSAGE_BYTES", retryable: false });
        continue;
      }
      try {
        onMessage(JSON.parse(line));
      } catch {
        onMessage({ type: "error", message: "unparseable frame", retryable: false });
      }
    }
  }
  onClose?.();
}

export function writeJsonl(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

export function stderr(msg: string): void {
  process.stderr.write(`[worker] ${msg}\n`);
}
