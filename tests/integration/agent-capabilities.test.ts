import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { AgentCapabilityInventory } from "../../packages/agent-contract/src/index.ts";
import type { AgentDto, AttachmentDto } from "../../packages/protocol/src/index.ts";
import { api, apiStatus, makeBot, startDaemon, waitThreadIdle, type Harness } from "./helpers/harness.ts";

async function stage(
  h: Harness,
  botId: string,
  file: Blob,
  name: string,
  draftToken: string,
): Promise<{ status: number; body: AttachmentDto | { error: string } }> {
  const form = new FormData();
  form.set("file", file, name);
  const response = await fetch(`${h.baseUrl}/api/attachments/stage`, {
    method: "POST",
    headers: {
      "x-bot-id": botId,
      "x-attachment-draft-token": draftToken,
      "x-command-id": crypto.randomUUID(),
    },
    body: form,
  });
  return {
    status: response.status,
    body: (await response.json()) as AttachmentDto | { error: string },
  };
}

const PI_CONFORMANCE_FILE = "pi-fake-pi-1.json";

function setProbeControl(h: Harness, control: Record<string, unknown> = {}): void {
  writeFileSync(
    path.join(h.home, "conformance", PI_CONFORMANCE_FILE),
    JSON.stringify({ ok: true, image: "verified", ...control }),
  );
}

async function piAgent(h: Harness): Promise<AgentDto> {
  const agents = await api<AgentDto[]>(h, "GET", "/api/agents");
  const pi = agents.find((agent) => agent.id === "pi");
  if (pi === undefined) throw new Error("missing pi agent");
  return pi;
}

function diagnosticFamily(payload: unknown): string | undefined {
  if (payload === null || typeof payload !== "object" || !("family" in payload)) return undefined;
  return typeof payload.family === "string" ? payload.family : undefined;
}

describe("agent capability inventory", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startDaemon();
  });

  afterAll(async () => {
    await h.stop();
    rmSync(h.home, { recursive: true, force: true });
  });

  test("probe inventory is the only source for REST attachment acceptance", async () => {
    const worker = await h.svc.supervisor.agentWorker("pi");
    const initialProbe = await worker.request({ type: "probe" }, 30_000) as {
      capabilities: AgentCapabilityInventory;
    };
    expect(initialProbe.capabilities).toEqual({
      version: 1,
      steering: true,
      abort: true,
      sessionDeletion: true,
      nativeThreadActions: ["resume", "history", "close"],
      attachments: { text: true, image: true },
      nativeEventFamilies: ["message", "tool", "turn", "error", "native"],
    });

    const botId = await makeBot(h, "Capability Bot");
    const draftToken = crypto.randomUUID();
    const textUpload = await stage(h, botId, new Blob(["supported text"]), "notes.txt", draftToken);
    const pngBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    const imageUpload = await stage(h, botId, new Blob([pngBytes]), "pixel.png", draftToken);
    expect(textUpload.status).toBe(201);
    expect(imageUpload.status).toBe(201);

    writeFileSync(
      path.join(h.home, "conformance", "pi-fake-pi-1.json"),
      JSON.stringify({ ok: true, image: "provider-unsupported" }),
    );
    await h.svc.agents.recheck("pi");

    const reprobe = await worker.request({ type: "probe" }, 30_000) as {
      capabilities: AgentCapabilityInventory;
    };
    expect(reprobe.capabilities.attachments).toEqual({ text: true, image: false });

    const rejected = await apiStatus(h, "POST", `/api/bots/${botId}/messages`, {
      text: "attachment-echo",
      attachmentIds: [(textUpload.body as AttachmentDto).id, (imageUpload.body as AttachmentDto).id],
      attachmentDraftToken: draftToken,
    });
    expect(rejected).toEqual({
      status: 400,
      body: { error: "pi cannot consume attachment media type image/png (pixel.png)" },
    });
    expect(
      (
        await fetch(`${h.baseUrl}/api/attachments/staged/${(textUpload.body as AttachmentDto).id}`, {
          headers: { "x-attachment-draft-token": draftToken },
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await fetch(`${h.baseUrl}/api/attachments/staged/${(imageUpload.body as AttachmentDto).id}`, {
          headers: { "x-attachment-draft-token": draftToken },
        })
      ).status,
    ).toBe(200);

    const rejectedStage = await stage(h, botId, new Blob([pngBytes]), "second.png", draftToken);
    expect(rejectedStage).toEqual({
      status: 400,
      body: { error: "pi cannot consume attachment media type image/png (second.png)" },
    });

    const sent = await api<{ threadId: string }>(h, "POST", `/api/bots/${botId}/messages`, {
      text: "attachment-echo",
      attachmentIds: [(textUpload.body as AttachmentDto).id],
      attachmentDraftToken: draftToken,
    });
    await waitThreadIdle(h, sent.threadId);
    expect(
      (
        await fetch(`${h.baseUrl}/api/attachments/staged/${(textUpload.body as AttachmentDto).id}`, {
          headers: { "x-attachment-draft-token": draftToken },
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await fetch(`${h.baseUrl}/api/attachments/staged/${(imageUpload.body as AttachmentDto).id}`, {
          headers: { "x-attachment-draft-token": draftToken },
        })
      ).status,
    ).toBe(200);
  });

  test("valid to invalid and offline rechecks clear the published policy", async () => {
    setProbeControl(h);
    const ready = await h.svc.agents.recheck("pi");
    expect(ready.status).toBe("ready");
    expect(ready.capabilities?.steering).toBeTrue();
    expect(h.svc.agents.capabilityInventory("pi")?.steering).toBeTrue();

    try {
      setProbeControl(h, { fakeProbe: "invalid" });
      const invalid = await h.svc.agents.recheck("pi");
      expect(invalid.status).toBe("incompatible");
      expect(invalid.capabilities).toBeUndefined();
      expect(h.svc.agents.capabilityInventory("pi")).toBeUndefined();
      expect((await piAgent(h)).capabilities).toBeUndefined();

      setProbeControl(h, { fakeProbe: "offline" });
      const offline = await h.svc.agents.recheck("pi");
      expect(offline.status).toBe("offline");
      expect(offline.capabilities).toBeUndefined();
      expect(h.svc.agents.capabilityInventory("pi")).toBeUndefined();
      expect((await piAgent(h)).capabilities).toBeUndefined();
    } finally {
      setProbeControl(h);
      await h.svc.agents.recheck("pi");
    }
  });

  test("drops undeclared normalized and native event families with payload-safe diagnostics", async () => {
    setProbeControl(h, {
      fakeCapabilities: {
        nativeEventFamilies: ["message", "turn", "error"],
      },
    });
    await h.svc.agents.recheck("pi");
    try {
      const botId = await makeBot(h, "Event policy Bot");
      const cursor = h.svc.events.replay(0, h.svc.events.oldestCursor()).events.at(-1)?.cursor ?? 0;
      const sent = await api<{ threadId: string }>(h, "POST", `/api/bots/${botId}/messages`, {
        text: "undeclared-events",
      });
      await waitThreadIdle(h, sent.threadId);

      const transcript = await api<Array<{ kind: string; text?: string; payload?: unknown }>>(
        h,
        "GET",
        `/api/threads/${sent.threadId}/messages`,
      );
      expect(transcript.some((message) => message.kind === "tool")).toBeFalse();
      expect(transcript.some((message) => message.kind === "event" && message.payload !== undefined)).toBeFalse();
      expect(transcript.some((message) => message.text === "declared message")).toBeTrue();

      const diagnostics = h.svc.events
        .replay(cursor, h.svc.events.oldestCursor())
        .events.filter((event) => event.type === "agent.event_rejected");
      expect(diagnostics.map((event) => diagnosticFamily(event.payload)).sort()).toEqual(["native", "tool"]);
      expect(JSON.stringify(diagnostics)).not.toContain("must-not-leak");
    } finally {
      setProbeControl(h);
      await h.svc.agents.recheck("pi");
    }
  });

  test("redacts non-public native payloads from transcript and event replay", async () => {
    setProbeControl(h);
    await h.svc.agents.recheck("pi");
    const botId = await makeBot(h, "Native privacy Bot");
    const cursor = h.svc.events.replay(0, h.svc.events.oldestCursor()).events.at(-1)?.cursor ?? 0;
    const sent = await api<{ threadId: string }>(h, "POST", `/api/bots/${botId}/messages`, {
      text: "undeclared-events",
    });
    await waitThreadIdle(h, sent.threadId);

    const transcript = await api<Array<{ kind: string; payload?: unknown }>>(
      h,
      "GET",
      `/api/threads/${sent.threadId}/messages`,
    );
    const nativeMessage = transcript.find((message) =>
      message.kind === "event" &&
      (message.payload as { capability?: string } | undefined)?.capability === "fake.secret-progress"
    );
    expect(nativeMessage?.payload).toEqual({
      capability: "fake.secret-progress",
      sensitivity: "secret",
      redacted: true,
    });

    const nativeEvent = h.svc.events
      .replay(cursor, h.svc.events.oldestCursor())
      .events.find((event) => event.type === "agent.native");
    expect(nativeEvent?.payload).toMatchObject({
      capability: "fake.secret-progress",
      sensitivity: "secret",
      redacted: true,
    });
    expect(JSON.stringify(nativeEvent)).not.toContain("must-not-leak");
  });

  test("serializes simultaneous timeouts for independent sessions on one Agent", async () => {
    const previousTimeout = h.svc.cfg.turnTimeoutMs;
    setProbeControl(h);
    await h.svc.agents.recheck("pi");
    h.svc.cfg.turnTimeoutMs = 25;
    try {
      const [firstBot, secondBot] = await Promise.all([
        makeBot(h, "First timeout Bot"),
        makeBot(h, "Second timeout Bot"),
      ]);
      const [first, second] = await Promise.all([
        api<{ threadId: string }>(h, "POST", `/api/bots/${firstBot}/messages`, { text: "hang" }),
        api<{ threadId: string }>(h, "POST", `/api/bots/${secondBot}/messages`, { text: "hang" }),
      ]);

      await Promise.all([
        waitThreadIdle(h, first.threadId, 10_000),
        waitThreadIdle(h, second.threadId, 10_000),
      ]);
      expect((await piAgent(h)).status).toBe("ready");
    } finally {
      h.svc.cfg.turnTimeoutMs = previousTimeout;
    }
  });

  test("quarantines an unabortable timed-out worker before releasing its Thread", async () => {
    const previousTimeout = h.svc.cfg.turnTimeoutMs;
    setProbeControl(h, { fakeCapabilities: { abort: false } });
    await h.svc.agents.recheck("pi");
    h.svc.cfg.turnTimeoutMs = 25;
    try {
      const botId = await makeBot(h, "Timeout quarantine Bot");
      const sent = await api<{ threadId: string }>(h, "POST", `/api/bots/${botId}/messages`, {
        text: "hang",
      });
      await waitThreadIdle(h, sent.threadId, 10_000);

      const thread = await api<{ activeTurn?: unknown }>(h, "GET", `/api/threads/${sent.threadId}`);
      expect(thread.activeTurn).toBeUndefined();
      const pi = await piAgent(h);
      expect(pi.status).toBe("offline");
      expect(pi.capabilities).toBeUndefined();
      const transcript = await api<Array<{ text?: string }>>(h, "GET", `/api/threads/${sent.threadId}/messages`);
      expect(transcript.some((message) => message.text?.includes("timed out after") === true)).toBeTrue();
    } finally {
      h.svc.cfg.turnTimeoutMs = previousTimeout;
      setProbeControl(h);
      await h.svc.agents.recheck("pi");
    }
  });
});
