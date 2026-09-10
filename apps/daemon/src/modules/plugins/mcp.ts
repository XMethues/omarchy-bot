import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { McpTransport } from "@omarchy-bot/protocol";

export interface McpConnection {
  client: Client;
  close(): Promise<void>;
}

export async function connectMcp(configuration: McpTransport, cwd: string, authenticatedFetch?: FetchLike): Promise<McpConnection> {
  let transport: StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport;
  let client = new Client({ name: "omarchy-bot", version: "0.1.0" }, { capabilities: {} });
  if (configuration.type === "stdio") {
    transport = new StdioClientTransport({
      command: configuration.command, args: configuration.args,
      env: { ...getDefaultEnvironment(), ...configuration.env }, cwd,
      // Untrusted MCP stderr can contain credentials. Do not put it in daemon logs.
      stderr: "ignore",
    });
  } else {
    const endpoint = new URL(configuration.url);
    const guardedFetch: FetchLike = async (input, init) => {
      const target = new URL(input);
      if (target.origin !== endpoint.origin) throw new Error("MCP transport attempted a cross-origin authenticated request");
      return (authenticatedFetch ?? fetch)(input, { ...init, redirect: "error" });
    };
    transport = new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: configuration.headers ?? {} }, fetch: guardedFetch,
    });
    try {
      // SDK 1.30's optional sessionId declaration omits undefined, unlike its real pre-initialize getter.
      await client.connect(transport as Transport, { timeout: 20_000 });
    } catch (error) {
      await client.close().catch(() => undefined);
      if (!(error instanceof StreamableHTTPError) || ![404, 405, 415].includes(error.code ?? 0)) throw error;
      client = new Client({ name: "omarchy-bot", version: "0.1.0" }, { capabilities: {} });
      transport = new SSEClientTransport(endpoint, { requestInit: { headers: configuration.headers ?? {} }, fetch: guardedFetch });
      try { await client.connect(transport, { timeout: 20_000 }); }
      catch (fallbackError) { await client.close().catch(() => undefined); throw fallbackError; }
    }
    return {
      client,
      async close() {
        try { if (transport instanceof StreamableHTTPClientTransport) await transport.terminateSession(); }
        finally { await client.close(); }
      },
    };
  }
  try { await client.connect(transport, { timeout: 20_000 }); }
  catch (error) { await client.close().catch(() => undefined); throw error; }
  return { client, close: () => client.close() };
}
