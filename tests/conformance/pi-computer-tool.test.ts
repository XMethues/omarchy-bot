import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentComputerToolContext } from "../../packages/agent-contract/src/index.ts";
import { isSurfaceId } from "../../packages/domain/src/ids.ts";
import { createComputerTool } from "../../workers/pi/src/computer-tool.ts";

const surfaceIdValue = "surf_0123456789abcdef0123456789abcdef";
if (!isSurfaceId(surfaceIdValue)) throw new Error("invalid conformance Surface fixture");
const surfaceId = surfaceIdValue;

const binding = {
  botId: "bot_0123456789abcdef0123456789abcdef",
  turnId: "turn_0123456789abcdef0123456789abcdef",
  workerSessionId: "worker-session-1",
  surfaceId,
};

describe("Pi SDK Omarchy computer tool", () => {
  test("passes the SDK tool-call id with the immutable daemon turn binding", async () => {
    const calls: Array<{ context: AgentComputerToolContext; action: unknown }> = [];
    const tool = createComputerTool(
      () => binding,
      {
        request: async (context, action) => {
          calls.push({ context, action });
          return { text: "owned screen observed" };
        },
      },
    );

    const result = await tool.execute(
      "sdk-tool-call-7",
      { action: "observe", args: {} },
      undefined,
      undefined,
      undefined as never,
    );

    expect(tool.name).toBe("computer");
    expect(tool.executionMode).toBe("sequential");
    expect(calls).toEqual([{
      context: { ...binding, toolCallId: "sdk-tool-call-7" },
      action: { name: "observe", args: {} },
    }]);
    expect(result.content).toEqual([{ type: "text", text: "owned screen observed" }]);
  });

  test("keeps the native tool execution pending until Takeover returns a fresh observation", async () => {
    const requested = Promise.withResolvers<void>();
    const returned = Promise.withResolvers<{
      text: string;
      imageRef: string;
      windowList: Array<{ title: string; focused: boolean }>;
    }>();
    let completionCount = 0;
    const tool = createComputerTool(
      () => binding,
      {
        request: async () => {
          requested.resolve();
          return returned.promise;
        },
      },
    );

    const execution = tool.execute(
      "takeover-tool-call",
      { action: "click", args: { x: 10, y: 20 } },
      undefined,
      undefined,
      undefined as never,
    ).then((result) => {
      completionCount += 1;
      return result;
    });
    await requested.promise;
    expect(completionCount).toBe(0);

    returned.resolve({
      text: "fresh desktop observation",
      imageRef: "fresh-snapshot",
      windowList: [{ title: "Verification", focused: true }],
    });
    const result = await execution;
    expect(completionCount).toBe(1);
    expect(result.content).toEqual([{
      type: "text",
      text: [
        "fresh desktop observation",
        "Bot Screen snapshot artifact: fresh-snapshot",
        'Windows: [{\"title\":\"Verification\",\"focused\":true}]',
      ].join("\n"),
    }]);
    expect(result.details).toEqual({
      text: "fresh desktop observation",
      imageRef: "fresh-snapshot",
      windowList: [{ title: "Verification", focused: true }],
    });
  });

  test("returns a Broker-owned screenshot as Pi image content without exposing its path", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pi-computer-tool-"));
    const imagePath = path.join(dir, "screen.png");
    writeFileSync(imagePath, new Uint8Array([1, 2, 3]));
    try {
      const tool = createComputerTool(
        () => binding,
        {
          request: async () => ({
            imageRef: "artifact-7",
            imageFile: { mediaType: "image/png", path: imagePath },
          }),
        },
      );

      const result = await tool.execute(
        "screenshot-call",
        { action: "screenshot" },
        undefined,
        undefined,
        undefined as never,
      );

      expect(result.content).toEqual([
        { type: "text", text: "Bot Screen snapshot artifact: artifact-7" },
        { type: "image", data: "AQID", mimeType: "image/png" },
      ]);
      expect(result.details).toEqual({ imageRef: "artifact-7" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("fails before bridge dispatch without an active binding or after cancellation", async () => {
    let active = false;
    let dispatches = 0;
    const tool = createComputerTool(
      () => active ? binding : undefined,
      {
        request: async () => {
          dispatches += 1;
          return {};
        },
      },
    );

    await expect(tool.execute(
      "unbound-call",
      { action: "observe" },
      undefined,
      undefined,
      undefined as never,
    )).rejects.toThrow("no active Omarchy turn binding");

    active = true;
    const controller = new AbortController();
    controller.abort();
    await expect(tool.execute(
      "cancelled-call",
      { action: "click", args: { x: 1, y: 1 } },
      controller.signal,
      undefined,
      undefined as never,
    )).rejects.toThrow();
    expect(dispatches).toBe(0);
  });
});
