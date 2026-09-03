import { randomUUID } from "node:crypto";
import {
  HEARTBEAT_MS,
  readJsonl,
  type AgentComputerToolOutput,
  type AgentComputerToolRequest,
} from "@omarchy-bot/agent-contract";
import { stderr } from "@omarchy-bot/agent-contract";

export interface WorkerClientOptions {
  name: string;
  script: string;
  args?: string[];
  /** Real desktop env (computer worker) or sanitized env (agent workers). */
  env?: Record<string, string>;
  onEvent: (event: any) => void;
  onExit?: (code: number | null) => void;
  onRequest?: (
    request: AgentComputerToolRequest,
    signal: AbortSignal,
  ) => Promise<AgentComputerToolOutput>;
}

interface Pending {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * One supervised local child process speaking LF-JSONL over stdio.
 * Request/response correlation, heartbeat watchdog, bounded restart backoff.
 */
export class WorkerClient {
  #proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | undefined = undefined;
  #pending = new Map<string, Pending>();
  #incoming = new Map<string, AbortController>();
  #hello: { v: number; worker: string; pid: number } | undefined;
  #lastMessageAt = 0;
  #stopping = false;
  #watchdog?: ReturnType<typeof setInterval>;

  constructor(private readonly opts: WorkerClientOptions) {}

  get hello(): WorkerClientOptions["name"] | undefined {
    return this.#hello?.worker;
  }
  get alive(): boolean {
    return this.#proc !== undefined && this.#proc.exitCode === null;
  }

  async start(timeoutMs = 15_000): Promise<void> {
    this.#stopping = false;
    const proc = Bun.spawn({
      cmd: [process.execPath, this.opts.script, ...(this.opts.args ?? [])],
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: this.opts.env ?? {},
      onExit: (proc, exitCode) => {
        clearInterval(this.#watchdog);
        for (const [, p] of this.#pending) {
          clearTimeout(p.timer);
          p.reject(new Error(`${this.opts.name} worker exited (${exitCode})`));
        }
        this.#pending.clear();
        for (const controller of this.#incoming.values()) controller.abort("worker exited");
        this.#incoming.clear();
        this.#proc = undefined;
        this.#hello = undefined;
        if (!this.#stopping) this.opts.onExit?.(exitCode);
      },
    });
    this.#proc = proc;

    void readJsonl(
      proc.stdout as unknown as ReadableStream<Uint8Array>,
      (msg) => this.#onMessage(msg),
      () => {},
    );
    void this.#drainStderr(proc.stderr as unknown as ReadableStream<Uint8Array>);

    // Handshake: first frame must be hello.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`${this.opts.name} worker handshake timeout`)), timeoutMs);
      const check = setInterval(() => {
        if (this.#hello) {
          clearInterval(check);
          clearTimeout(t);
          resolve();
        } else if (!this.alive) {
          clearInterval(check);
          clearTimeout(t);
          reject(new Error(`${this.opts.name} worker died during handshake`));
        }
      }, 25);
      this.#lastMessageAt = Date.now();
      this.#watchdog = setInterval(() => {
        if (Date.now() - this.#lastMessageAt > HEARTBEAT_MS * 2.5) {
          stderr(`${this.opts.name} heartbeat missed; killing`);
          this.#proc?.kill();
        }
      }, HEARTBEAT_MS);
    });
  }

  async #drainStderr(readable: ReadableStream<Uint8Array>): Promise<void> {
    const reader = readable.getReader();
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        const text = dec.decode(value);
        for (const line of text.split("\n")) if (line.trim()) stderr(`${this.opts.name}: ${line}`);
      }
    } catch {
      /* worker died */
    }
  }

  #onMessage(raw: unknown): void {
    this.#lastMessageAt = Date.now();
    const msg = raw as any;
    if (msg?.type === "hello") {
      this.#hello = msg;
      return;
    }
    if (msg?.type === "heartbeat") return;
    if (msg?.type === "computer.request") {
      void this.#handleComputerRequest(msg as AgentComputerToolRequest);
      return;
    }
    if (msg?.type === "computer.cancel" && typeof msg.requestId === "string") {
      this.#incoming.get(msg.requestId)?.abort("tool call cancelled");
      return;
    }
    if (msg?.type === "event") {
      this.opts.onEvent(msg.event);
      return;
    }
    if (msg?.requestId && this.#pending.has(msg.requestId)) {
      const p = this.#pending.get(msg.requestId)!;
      this.#pending.delete(msg.requestId);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.payload);
      else p.reject(new Error(String(msg.error)));
    }
  }

  async #handleComputerRequest(request: AgentComputerToolRequest): Promise<void> {
    const controller = new AbortController();
    this.#incoming.set(request.requestId, controller);
    try {
      if (this.opts.onRequest === undefined) {
        throw new Error(`${this.opts.name} cannot route computer tools`);
      }
      const payload = await this.opts.onRequest(request, controller.signal);
      if (controller.signal.aborted) throw new Error("computer tool call cancelled");
      if (this.alive) {
        this.write({ type: "computer.result", requestId: request.requestId, ok: true, payload });
      }
    } catch (error) {
      if (this.alive) {
        const message = error instanceof Error ? error.message : String(error);
        this.write({ type: "computer.result", requestId: request.requestId, ok: false, error: message });
      }
    } finally {
      if (this.#incoming.get(request.requestId) === controller) {
        this.#incoming.delete(request.requestId);
      }
    }
  }

  /** Send a command and await its result. Mutating worker commands are never auto-retried. */
  async request(cmd: Record<string, unknown>, timeoutMs: number): Promise<any> {
    if (!this.alive) throw new Error(`${this.opts.name} worker not running`);
    const requestId = (cmd.requestId as string) ?? randomUUID();
    const p = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(requestId);
        reject(new Error(`${this.opts.name} request ${cmd.type} timed out`));
      }, timeoutMs);
      this.#pending.set(requestId, { resolve, reject, timer });
    });
    this.write({ ...cmd, requestId });
    return p;
  }

  write(obj: unknown): void {
    const stdin = (this.#proc as unknown as { stdin?: { write: (s: string) => void; flush?: () => void } } | undefined)?.stdin;
    if (!stdin) throw new Error(`${this.opts.name} worker not running`);
    stdin.write(JSON.stringify(obj) + "\n");
  }

  async stop(graceMs = 3000): Promise<void> {
    this.#stopping = true;
    if (this.alive) {
      try {
        this.write({ type: "shutdown", requestId: randomUUID() });
      } catch {
        /* already gone */
      }
      const deadline = Date.now() + graceMs;
      while (this.alive && Date.now() < deadline) await Bun.sleep(50);
      this.#proc?.kill();
    }
  }
}

/** Agent workers get a sanitized desktop env; only computer-worker gets the real one. */
export function sanitizedEnv(): Record<string, string> {
  const keep = ["PATH", "HOME", "USER", "SHELL", "LANG", "LC_ALL", "TERM", "TMPDIR", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "OMARCHY_BOT_HOME", "NO_COLOR"];
  const env: Record<string, string> = {};
  for (const k of keep) {
    const v = process.env[k];
    if (v !== undefined) env[k] = v;
  }
  return env;
}
