import { stderr } from "@omarchy-bot/agent-contract";

/**
 * Minimal MCP client (2024-11-05, newline-delimited JSON-RPC over stdio) for
 * the @agent-sh/computer-use-linux server (ADR-0001). Just enough surface for
 * the computer worker: initialize, tools/list, tools/call, shutdown.
 */
export interface McpContent {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface McpCallResult {
  isError: boolean;
  content: McpContent[];
  structured?: unknown;
}

export class McpClient {
  #proc: Bun.Subprocess<"pipe", "pipe", "pipe">;
  #nextId = 1;
  #pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  #readerDone = false;
  #drain: Promise<void>;

  constructor(command: string[], env?: Record<string, string>) {
    this.#proc = Bun.spawn(command, {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      ...(env !== undefined ? { env } : {}),
    });
    this.#drain = this.#readLoop();
    void this.#drainStderr();
  }

  async #readLoop(): Promise<void> {
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of this.#proc.stdout) {
      buf += dec.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
          if (typeof msg.id === "number" && this.#pending.has(msg.id)) {
            const p = this.#pending.get(msg.id)!;
            this.#pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message ?? "mcp error"));
            else p.resolve(msg.result);
          }
        } catch {
          stderr(`mcp: unparseable frame`);
        }
      }
    }
    this.#readerDone = true;
    for (const [, p] of this.#pending) p.reject(new Error("mcp server closed"));
    this.#pending.clear();
  }

  async #drainStderr(): Promise<void> {
    const dec = new TextDecoder();
    try {
      for await (const chunk of this.#proc.stderr) {
        const text = dec.decode(chunk).trim();
        if (text) stderr(`mcp-server: ${text.split("\n").at(-1)}`);
      }
    } catch {
      /* stderr closed */
    }
  }

  #request(method: string, params?: unknown): Promise<unknown> {
    if (this.#readerDone) return Promise.reject(new Error("mcp server closed"));
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, ...(params !== undefined ? { params } : {}) }) + "\n");
      this.#proc.stdin.flush();
    });
  }

  async initialize(): Promise<unknown> {
    const result = await this.#request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "omarchy-bot-computer-worker", version: "0.1.0" },
    });
    this.#proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    this.#proc.stdin.flush();
    return result;
  }

  async listTools(): Promise<string[]> {
    const result = (await this.#request("tools/list")) as { tools?: { name: string }[] };
    return (result.tools ?? []).map((t) => t.name);
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    const result = (await this.#request("tools/call", { name, arguments: args })) as {
      isError?: boolean;
      content?: McpContent[];
      structuredContent?: unknown;
    };
    return {
      isError: result.isError === true,
      content: result.content ?? [],
      structured: result.structuredContent,
    };
  }

  async close(): Promise<void> {
    try {
      this.#proc.stdin.end();
    } catch {
      /* already closed */
    }
    this.#proc.kill();
    await this.#proc.exited;
  }
}
