import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { AGENT_COMPUTER_TOOL } from "@omarchy-bot/agent-contract";
import { createComputerTool } from "./computer-tool.ts";

test("fresh and resumed Native Sessions receive the computer session map without starting a desktop", async () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "omarchy-pi-computer-context-"));
  let session: AgentSession | undefined;
  let dispatches = 0;
  try {
    const faux = fauxProvider({ models: [{ id: "computer-context-model" }], tokensPerSecond: 10_000 });
    faux.setResponses([fauxAssistantMessage([fauxText("Conversation retained.")])]);
    const modelRuntime = await ModelRuntime.create({
      authPath: path.join(cwd, "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    modelRuntime.registerNativeProvider(faux.provider);
    let nativeSessionId: string | undefined;

    for (const resumed of [false, true]) {
      const loader = new DefaultResourceLoader({ cwd, agentDir: cwd });
      await loader.reload();
      const tool = createComputerTool(() => undefined, {
        request: async () => {
          dispatches += 1;
          throw new Error("Loading conversation context must not provision a desktop");
        },
      });
      if (resumed && nativeSessionId === undefined) throw new Error("Native Session was not persisted");
      const manager = nativeSessionId === undefined
        ? SessionManager.create(cwd, path.join(cwd, "sessions"))
        : SessionManager.open(nativeSessionId);
      ({ session } = await createAgentSession({
        cwd,
        agentDir: cwd,
        model: faux.getModel(),
        modelRuntime,
        resourceLoader: loader,
        sessionManager: manager,
        customTools: [tool],
      }));

      expect(tool.name).toBe(AGENT_COMPUTER_TOOL.name);
      expect(tool.description).toBe(AGENT_COMPUTER_TOOL.description);
      expect(tool.promptSnippet).toBe(AGENT_COMPUTER_TOOL.systemPrompt.summary);
      expect(tool.promptGuidelines).toEqual([...AGENT_COMPUTER_TOOL.systemPrompt.guidelines]);
      expect(session.systemPrompt).toContain(AGENT_COMPUTER_TOOL.systemPrompt.summary);
      for (const guideline of AGENT_COMPUTER_TOOL.systemPrompt.guidelines) {
        expect(session.systemPrompt).toContain(guideline);
      }
      if (!resumed) {
        await session.prompt("Keep this conversation while its desktop can change.");
        nativeSessionId = session.sessionFile;
        expect(nativeSessionId).toBeDefined();
      } else {
        expect(session.messages.some((message) => message.role === "assistant")).toBeTrue();
      }
      session.dispose();
      session = undefined;
    }
    expect(dispatches).toBe(0);
  } finally {
    session?.dispose();
    rmSync(cwd, { recursive: true, force: true });
  }
});
