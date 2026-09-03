# Agent adapters and native capability inventory

> Inventory date: 2026-09-02. Every implementation entry must be verified against the installed Agent version and its official interface before the Agent is enabled.

## Policy

An Agent is an execution backend; it is not a visible Bot. User-created Bots reference an Agent, and multiple Bots may use the same Agent.

Each adapter maintains a versioned **Agent Capability Inventory**. The inventory is descriptive evidence, not a permission manifest, feature allowlist, or reason to alter native Agent behavior. Omarchy Bot:

- chooses the richest official integration surface available;
- preserves native events and controls rather than reducing every Agent to the smallest common protocol;
- does not inject an independent `ask`/`trusted` policy or approval gate;
- treats Native Sessions as Agent-owned, so Bot deletion removes local mappings without invoking an Agent worker or deleting native data;
- marks an Agent unavailable when its installed version fails its adapter conformance suite.

## Adapter baseline

A usable conversation adapter must prove the operations required by its own official lifecycle:

- create and restore a conversation/session;
- send user content and stream output;
- preserve structured tool and native events;
- reach explicit completed, cancelled, and failed boundaries;
- cancel an active turn through the Agent's native mechanism;
- accept the attachment forms claimed by that adapter;
- close and recover without orphaning the worker.

Steer, fork, compact, rename, Thread delete, subagents, plans, usage, and other advanced operations are inventory entries, not fabricated common features. The UI surfaces them contextually when the active adapter reports tested support.

## Official integration surfaces

| Agent | Primary official surface | Adapter state | Notes |
| --- | --- | --- | --- |
| Pi | `@earendil-works/pi-coding-agent` TypeScript SDK | Implemented | Native sessions, streaming, tools, internal abort, history, attachments, and SDK steering are available. |
| OMP | `@oh-my-pi/pi-coding-agent` Bun SDK | Pending | Use the in-process SDK behind an isolated Bun worker; preserve extensions, skills, tools, and session events. |
| Codex | `codex app-server --stdio` | Pending | Use `thread/start|resume`, `turn/start|interrupt`, generated protocol types, and structured server events. |
| Claude Code | `@anthropic-ai/claude-agent-sdk` | Pending | Use `query()`, async multi-turn input, resume, interrupt, hooks, partial messages, and native tool decisions. |
| Grok Build | native ACP plus `x.ai/*` extensions | Pending | Basic ACP alone is incomplete. Preserve Grok session, steering, queue, fork, compact, subagent, workspace, and other advertised extensions by version. |
| OpenCode | `@opencode-ai/sdk` plus local server | Pending | Preserve server events and native session children, share, summarize, revert, commands, files, and LSP operations. |
| Gemini CLI | `gemini --acp` | Pending | Use ACP negotiation, session lifecycle, updates, elicitation, and native image/file support. |
| GitHub Copilot CLI | `@github/copilot-sdk` with explicit native runtime | Pending | Preserve sessions, steering/queueing, hooks, elicitation, subagents, usage, citations, and attachments. |
| Crush | official Unix-socket HTTP/SSE server | Pending | Keep the workspace SSE connection alive and correlate workspace, session, run, tool, question, and cancel events. |

`Pending` Agents remain visible but disabled in the Agent picker with setup/status guidance. Presence on `PATH` alone is not readiness.

## Capability inventory format

Every adapter owns a machine-readable record tied to the exact Agent version:

```ts
interface AgentCapabilityInventory {
  version: 1;
  steering: boolean;
  abort: boolean;
  nativeThreadActions: Array<
    "resume" | "history" | "close" | "rename" | "delete" | "fork" | "compact"
  >;
  attachments: {
    text: boolean;
    image: boolean;
    maxTextBytes?: number;
  };
  nativeEventFamilies: string[];
}
```

Rules:

1. A claimed operation or modality means the official interface was exercised by conformance, not merely documented.
2. `false` or an absent action is honest unavailability and must not trigger an emulated substitute.
3. Unknown native envelopes remain typed `native` events with sensitivity metadata and are reported as capability drift.
4. Upgrading the Agent invalidates the previous readiness record and inventory until conformance passes again.
5. Feature UI and daemon services read this inventory as the sole source for support decisions; it never approves or denies Agent tools.

## Worker boundary

Vendor SDKs and protocols run behind supervised local workers. The daemon/worker contract carries correlated commands and normalized events while preserving native envelopes:

```ts
type AgentCommand =
  | { type: "probe"; requestId: string }
  | { type: "session.open"; requestId: string; botId: string; threadId: string; options: OpenSessionOptions }
  | { type: "session.resume"; requestId: string; botId: string; threadId: string; nativeSessionId: string; options: OpenSessionOptions }
  | { type: "message.send"; requestId: string; sessionId: string; turnId: string; message: UserMessage }
  | { type: "message.steer"; requestId: string; sessionId: string; text: string }
  | { type: "turn.abort"; requestId: string; sessionId: string }
  | { type: "session.history"; requestId: string; sessionId: string }
  | { type: "session.close"; requestId: string; sessionId: string };
```

The exact accepted commands are versioned. An adapter may report an operation unavailable; it may not silently route it through a weaker headless or PTY transport.

Native events carry `agentId`, capability name, payload, and sensitivity. Secret or diagnostic payloads are never forwarded to the browser without an explicit safe projection.

## Adapter notes

### Pi

Use `createAgentSession`, `DefaultResourceLoader`, `SessionManager.create/open`, and the SDK event subscription. Load the user's native Pi resources. Use `session.steer(...)` for messages sent during active work and `session.abort()` only for explicit local operations that must terminate work, such as deleting an active Bot.

Pi Native Sessions are Agent-owned continuation state. Omarchy Bot does not advertise or invoke Native Session deletion; deleting a Bot leaves that native state intact.

### Codex

Initialize the app-server connection and generate types matching the probed binary. Treat `turn/completed` as authoritative. Preserve native approval requests as Agent-native interaction rather than routing them through a second omarchy-bot policy.

### Claude

Use async iterable input for multi-turn operation, `resume` for continuity, and `interrupt()` for cancellation. Preserve partial messages, hooks, tool events, and the Agent's own permission behavior.

### Grok

Implement ACP initialization, authentication, session lifecycle, prompts, cancellation, content/tool/plan updates, and negotiated capabilities. Inventory the installed version's `x.ai/*` operations, including session search/history/fork/rename/delete, interject/queue controls, compact/rewind, subagents, scheduler/background events, workspace operations, and usage. Do not claim any entry until its conformance case passes.

### OpenCode, Gemini, Copilot, Crush, and OMP

Implement against the primary surfaces in the table. Preserve each interface's richer native event stream. Record exact operations and evidence during adapter implementation instead of deciding behavior through speculative product fallbacks.

## Conformance

A versioned adapter suite verifies:

1. probe and authentication/readiness;
2. session creation and restoration;
3. streamed output and explicit terminal state;
4. structured tool/native event preservation;
5. native cancellation without late output;
6. claimed attachment types;
7. close/restart/recovery behavior;
8. every `native` capability inventory entry;
9. unknown-event drift handling;
10. Computer tool coordination where the Agent uses the shared desktop.

Only a passing record makes an installed Agent selectable.

## Primary sources

- Pi SDK 0.84.4 local docs: `docs/sdk.md`, `docs/rpc.md`
- OMP: <https://github.com/can1357/oh-my-pi/blob/master/docs/sdk.md>
- Codex app-server: <https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>
- Claude Agent SDK: <https://github.com/anthropics/claude-agent-sdk-typescript>
- Grok Build: <https://github.com/xai-org/grok-build>
- OpenCode SDK: <https://github.com/anomalyco/opencode>
- Gemini ACP: <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/acp-mode.md>
- Copilot SDK: <https://github.com/github/copilot-sdk>
- Crush: <https://github.com/charmbracelet/crush>
