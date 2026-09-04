import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxThinking,
  type FauxContentBlock,
} from "@earendil-works/pi-ai/providers/faux";
import { thinkingCapabilityForProbe } from "./thinking-capability.ts";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function createResolvedSession(
  reasoning: boolean,
  content: FauxContentBlock[],
): Promise<{ session: AgentSession; nativeEventTypes: string[] }> {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "omarchy-pi-thinking-"));
  tempDirs.push(cwd);
  const faux = fauxProvider({
    models: [{ id: reasoning ? "thinking-model" : "plain-model", reasoning }],
    tokensPerSecond: 10_000,
  });
  faux.setResponses([fauxAssistantMessage(content)]);
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(cwd, "auth.json"),
    modelsPath: null,
    refreshOnCreate: false,
  });
  modelRuntime.registerNativeProvider(faux.provider);
  const model = faux.getModel();
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    model,
    modelRuntime,
    sessionManager: SessionManager.inMemory(cwd),
    noTools: "all",
  });
  const nativeEventTypes: string[] = [];
  session.subscribe((event) => {
    if (event.type === "message_update") nativeEventTypes.push(event.assistantMessageEvent.type);
  });
  return { session, nativeEventTypes };
}

describe("Pi resolved-model Thinking capability", () => {
  test("reports unsupported without attempting native session resolution when authentication is absent", async () => {
    let attemptedResolution = false;
    const capability = await thinkingCapabilityForProbe(false, async () => {
      attemptedResolution = true;
      throw new Error("must not resolve a session without an authenticated model");
    });

    expect(capability).toEqual({ supported: false, streaming: false });
    expect(attemptedResolution).toBeFalse();
  });

  test("reports and streams Thinking for a resolved reasoning model", async () => {
    const { session, nativeEventTypes } = await createResolvedSession(true, [
      fauxThinking("Inspect inputs."),
      fauxText("Done."),
    ]);
    try {
      expect(await thinkingCapabilityForProbe(true, async () => session.model)).toEqual({
        supported: true,
        streaming: true,
      });
      await session.prompt("Check the input");
      expect(nativeEventTypes).toContain("thinking_start");
      expect(nativeEventTypes).toContain("thinking_delta");
      expect(nativeEventTypes).toContain("thinking_end");
    } finally {
      session.dispose();
    }
  });

  test("reports no Thinking and infers none for a resolved non-reasoning model", async () => {
    const { session, nativeEventTypes } = await createResolvedSession(false, [fauxText("Done.")]);
    try {
      expect(session.thinkingLevel).toBe("off");
      expect(await thinkingCapabilityForProbe(true, async () => session.model)).toEqual({
        supported: false,
        streaming: false,
      });
      await session.prompt("Check the input");
      expect(nativeEventTypes.filter((type) => type.startsWith("thinking_"))).toEqual([]);
    } finally {
      session.dispose();
    }
  });
});
