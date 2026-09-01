# Application Structure

> This structure keeps the local Web MVP, nine multi-role Agent Bots, shared Omarchy Computer, and post-MVP Tauri remote client on one domain model without coupling the UI to Agent-specific protocols.

## 1. Architectural rules

1. `omarchy-bot.service` is the only owner of product state.
2. One Agent runtime maps to one Bot; a Bot can have many roles and native sessions.
3. Vendor SDKs and protocols run behind isolated Agent workers.
4. The Web UI and Tauri UI use the same API client and frontend code.
5. Tauri is a remote client shell, not a second daemon and not an Agent host.
6. SQLite has one writer: the daemon. Workers and clients never open it.
7. Agents never receive direct access to the raw desktop-input backend; all Computer actions pass through ComputerBroker.
8. Commands, durable state, event streams, and binary media use separate contracts.
9. Remote access is an API transport concern, not part of Agent adapters.
10. Public contracts are versioned before the MVP so remote reconnect does not require a redesign.
11. The installable Omarchy Shell plugin is the product entry point, not the daemon lifecycle owner; runtime and frontend choices are detailed in [technology-selection.md](./technology-selection.md).

## 2. Proposed repository layout

Use a Bun TypeScript workspace for the daemon, Agent workers, React Web UI and shared contracts. Every locked Agent SDK version must pass Bun conformance; Copilot uses an explicitly resolved native platform executable instead of SDK default discovery. The installable Shell plugin uses QML/Qt Quick. The Tauri Rust crate is added after the MVP but its boundary is reserved now.

```text
omarchy-bot/
├── apps/
│   ├── shell-plugin/             # installed Omarchy product entry
│   │   ├── manifest.json
│   │   ├── BarWidget.qml
│   │   ├── Panel.qml
│   │   └── Service.qml
│   ├── daemon/
│   │   └── src/
│   │       ├── bootstrap/
│   │       ├── modules/
│   │       │   ├── bots/
│   │       │   ├── roles/
│   │       │   ├── threads/
│   │       │   ├── tasks/
│   │       │   ├── routines/
│   │       │   ├── memory/
│   │       │   ├── handoffs/
│   │       │   ├── permissions/
│   │       │   ├── computer/
│   │       │   ├── devices/
│   │       │   └── events/
│   │       ├── api/
│   │       ├── persistence/
│   │       └── supervision/
│   ├── web/
│   │   └── src/
│   │       ├── app/
│   │       ├── features/
│   │       ├── components/
│   │       └── routes/
│   └── desktop/                 # post-MVP
│       ├── src/                 # thin wrapper around the Web UI
│       └── src-tauri/
├── workers/
│   ├── pi/
│   ├── omp/
│   ├── codex/
│   ├── claude/
│   ├── grok/
│   ├── opencode/
│   ├── gemini/
│   ├── copilot/
│   ├── crush/
│   └── computer/
├── packages/
│   ├── domain/
│   ├── ui/                       # product-semantic Astryx adapter
│   ├── protocol/
│   ├── agent-contract/
│   ├── api-client/
│   └── testkit/
├── tests/
│   ├── conformance/
│   ├── integration/
│   └── e2e/
├── docs/
├── package.json                  # Bun workspaces
├── bun.lock
└── tsconfig.base.json
```

Do not create a package for every daemon module initially. Modules stay inside `apps/daemon` until they have a genuine second consumer. This avoids a monorepo full of artificial abstractions.

## 3. Dependency boundaries

```text
packages/domain
  ↑                 ↑
packages/protocol   packages/agent-contract
  ↑                 ↑              ↑
packages/api-client workers/*      apps/daemon
  ↑
apps/web ← packages/ui
  ↑
apps/desktop

apps/shell-plugin -- small localhost HTTP/IPC surface --> apps/daemon
```

Rules:

- `domain` contains pure types and state-transition rules; no database, HTTP, UI or vendor imports.
- `protocol` defines public REST/WebSocket/media schemas and generates OpenAPI/JSON Schema.
- `agent-contract` defines the internal daemon↔worker protocol only.
- `api-client` is generated or checked against `protocol`; Web and Tauri frontend use it.
- `ui` is the only package allowed to import Astryx. Astryx packages track the npm `latest` channel as one compatibility group; feature code consumes omarchy-bot semantic components instead of Astryx directly. shadcn and other component suites are not dependencies.
- `workers/*` may import their vendor SDK and `agent-contract`, but not daemon modules, SQLite or UI code.
- `web` never imports daemon internals or vendor SDKs.
- `shell-plugin` is QML and consumes only the daemon's small localhost status/launch surface; it never imports JavaScript packages, opens SQLite or owns Agent processes.
- Tauri Rust never opens SQLite or starts Agent processes. It handles native windowing, secure credentials, updater and optional tunnel integration.
- `daemon` does not import Web or Tauri code.

Enforce these rules with TypeScript project references, package exports and an import-boundary lint test.

## 4. Process topology

```text
omarchy-shell
  └── QML shell-plugin → status, Action needed, notifications, open Web UI

omarchy-bot.service                         authoritative process
  ├── Bun TypeScript daemon
  ├── SQLite single writer
  ├── REST / WebSocket / media endpoints
  ├── orchestration and scheduler
  ├── AgentSupervisor
  │     ├── pi-worker (Bun SDK)
  │     ├── omp-worker (Bun SDK)
  │     ├── codex-worker → codex app-server
  │     ├── claude-worker (Bun SDK)
  │     ├── grok-worker → ACP + x.ai
  │     ├── opencode-worker → local server
  │     ├── gemini-worker → ACP
  │     ├── copilot-worker (Bun SDK) → native platform runtime
  │     └── crush-worker → local server
  └── ComputerBroker
        └── computer-worker → native desktop backend
```

The daemon should not import Pi, OMP, Claude, Copilot or OpenCode SDKs directly. Separate workers provide:

- crash containment;
- incompatible dependency isolation;
- vendor SDK/runtime isolation;
- independent version probes;
- bounded stderr/stdout handling;
- the ability to restart one Bot without taking down all threads and routines.

A worker is not a microservice. It is a supervised local child process with one narrow protocol.

## 5. Internal Agent worker contract

The daemon sends commands:

```ts
type AgentCommand =
  | { type: "probe"; requestId: string }
  | { type: "session.open"; requestId: string; actor: ActorRef; options: OpenOptions }
  | { type: "session.resume"; requestId: string; actor: ActorRef; nativeSessionId: string }
  | { type: "message.send"; requestId: string; sessionId: string; message: UserMessage }
  | { type: "permission.respond"; requestId: string; permissionId: string; decision: Decision }
  | { type: "turn.abort"; requestId: string; sessionId: string }
  | { type: "session.history"; requestId: string; sessionId: string }
  | { type: "session.close"; requestId: string; sessionId: string };
```

The worker emits normalized events plus a local-only native envelope:

```ts
type AgentWorkerEvent =
  | NormalizedAgentEvent
  | {
      type: "native";
      agentId: AgentId;
      capability: string;
      payload: unknown;
      sensitivity: "public" | "diagnostic" | "secret";
    };
```

Transport requirements:

- framed JSON or strict LF JSONL over private stdio/Unix socket;
- protocol version in the handshake;
- request IDs on every command;
- session, role, task, run and turn correlation IDs;
- explicit ack and explicit final event;
- bounded messages with attachment/artifact references instead of inline blobs;
- stderr separated from protocol output;
- heartbeat and graceful shutdown deadline;
- unknown fields preserved, unknown commands rejected clearly.

Native `diagnostic` and `secret` events never go directly to Web/Tauri clients. The daemon applies an allowlist/redaction projection first.

## 6. Domain ownership

| State | Authority |
|---|---|
| Bot installation/version/readiness | BotRegistry + AgentSupervisor |
| Role configuration | daemon/SQLite |
| Model conversation context | native Agent session |
| Role↔native session mapping | daemon/SQLite |
| Threads/channels/tasks/runs | daemon/SQLite |
| Routine schedule and deduplication | daemon/SQLite |
| Long-term role/Bot/workspace memory index | daemon/SQLite |
| Agent transcript | Agent-native storage |
| Computer lease and input queue | ComputerBroker in daemon |
| Current desktop state | observed Omarchy computer |
| Attachments/artifacts | daemon-owned files + SQLite metadata |
| Remote devices | DeviceService + OS/keyring-backed secrets |

Do not duplicate full native transcripts into the product database. Persist enough normalized events for UI recovery and audit, then reconcile against native history on resume.

## 7. Public API protocol

### 7.1 Commands

REST is used for commands and snapshots. Every mutating remote-safe command includes:

```ts
interface CommandHeaders {
  commandId: string;       // idempotency key
  expectedVersion?: number;
}
```

An HTTP `202` means accepted, not completed. Completion is delivered as an event.

Desktop-input commands are never automatically retried, even if the response is lost.

### 7.2 Events

```ts
interface EventEnvelope<T> {
  schemaVersion: number;
  eventId: string;
  cursor: number;
  occurredAt: string;
  aggregateType: "bot" | "role" | "thread" | "task" | "run" | "routine" | "computer";
  aggregateId: string;
  type: string;
  payload: T;
}
```

WebSocket clients reconnect with the last acknowledged cursor. The server either replays retained events or responds `snapshot_required`; clients must never guess missed state.

Use a separate endpoint for Computer frames so a slow image stream cannot block approvals and task state:

```text
/api/events                    control/state WebSocket
/api/computer/stream           binary frame stream
/api/attachments/:id           binary HTTP
/api/artifacts/:id             binary HTTP
```

MVP Computer streaming can use rate-limited JPEG/WebP snapshots. Keep the transport abstraction open for WebRTC or a more efficient delta/video stream after Tauri, without changing Computer lease semantics.

### 7.3 Contract generation

- TypeScript schemas are the source for REST/WebSocket validation.
- Generate OpenAPI/JSON Schema in CI.
- Tauri frontend consumes the same TypeScript `api-client`.
- Rust only needs generated types for the small Tauri command surface; it should not duplicate the product domain.
- Golden protocol fixtures detect accidental breaking changes.

## 8. Computer security boundary

Agents must not connect directly to `computer-use-linux`, ydotool, Wayland/X11 input sockets or Hyprland control sockets. The flow is:

```text
Agent tool call
  → omarchy-bot Computer proxy tool
  → PermissionService
  → ComputerBroker lease
  → computer-worker
  → Omarchy desktop
```

Implementation requirements:

- expose a gateway-owned MCP/custom-tool facade to each Agent;
- run Agent workers with sanitized desktop environment variables;
- when practical, contain workers so raw input devices and desktop sockets are unavailable;
- only `computer-worker` receives the real desktop environment and input backend access;
- ComputerBroker is the only component that can grant, renew or revoke a lease;
- record actor, run, action and approval for every input action;
- emergency stop kills pending input and revokes all leases.

Because all processes run under the same Linux user unless contained, environment sanitization alone is not a hard security boundary. The conformance and security plan must explicitly test bypass attempts; trusted arbitrary shell execution remains a documented risk until OS-level containment is enabled.

## 9. Daemon modules

Each module owns commands, state transitions, persistence repository and event projection for one concern:

```text
bots          installation, version, readiness, aggregate status
roles         persona/config/defaults and role-session mappings
threads       direct/channel membership and message index
tasks         Task/Run state machine and completion semantics
handoffs      role-to-role delegation and loop/budget limits
routines      schedule, claim, idempotency and missed-run policy
memory        role/Bot/workspace scopes and provenance
permissions   Agent and Computer approvals
computer      lease, observation, takeover and emergency stop
devices       post-MVP pairing, revocation and remote sessions
events        durable cursor, replay, snapshots and redaction
```

Cross-module work uses application commands/events, not direct table mutation. Keep it in one process and one SQLite transaction where atomicity is required; do not add a distributed message broker.

## 10. Web and Tauri UI sharing

`apps/web` contains the actual React 19 UI. It depends only on `api-client`, `domain` DTOs and `packages/ui`. Use a Vite SPA with latest-tracked Astryx behind the internal UI adapter, Tailwind CSS 4 through Astryx's token bridge, plus TanStack Router, Query, Virtual and Form; do not add shadcn, TanStack Start or TanStack DB to the MVP. Query owns REST snapshots and mutations, while a separate ordered projection store owns live WebSocket cursor events. The Bun decision, React/Solid comparison and Astryx adoption policy are in [technology-selection.md](./technology-selection.md).

Tauri adds a thin host bridge for:

- remote Omarchy endpoint profiles;
- device key generation and secure credential storage;
- pairing confirmation display;
- system tray and native notifications;
- signed auto-update;
- optional Tailscale/WireGuard launch/deep links;
- native window lifecycle.

The same feature components render in browser and Tauri. Host-specific behavior is behind a small interface:

```ts
interface ClientHost {
  kind: "web" | "tauri";
  loadCredential(endpointId: string): Promise<string | undefined>;
  saveCredential(endpointId: string, value: string): Promise<void>;
  notify(notification: ClientNotification): Promise<void>;
  openExternal(url: string): Promise<void>;
}
```

No feature component calls Tauri APIs directly.

## 11. Persistence layout

Use migrations from the first commit. Suggested tables:

```text
bots
roles
role_sessions
threads
thread_participants
messages
artifacts
tasks
runs
handoffs
routines
routine_runs
memories
permissions
computer_leases
remote_devices
events
schema_migrations
```

Important constraints:

- unique `(bot_id, role_id)`;
- unique active native session per `(role_id, thread_id)`;
- one active input lease globally;
- unique routine occurrence key `(routine_id, scheduled_at)`;
- one terminal state transition per Run;
- monotonic event cursor;
- foreign keys enabled;
- secrets are references to keyring/encrypted storage, not plaintext database columns.

## 12. Supervision and shutdown

Shutdown order:

1. stop accepting new commands;
2. stop scheduler claims;
3. revoke Computer leases and stop input;
4. resolve pending approvals as unavailable;
5. abort or checkpoint active Runs according to Agent capability;
6. close Agent sessions/workers;
7. flush events and SQLite WAL;
8. close WebSocket/HTTP listeners.

On startup, all persisted active leases become revoked, active Runs become `recovering`, and routines are reclaimed through occurrence IDs. Never restore a Bot as holding the Computer simply because the daemon previously crashed while it held a lease.

## 13. Testing layout

```text
tests/conformance/
  common-agent-suite
  per-agent capability inventory
  common-computer-suite

tests/integration/
  task-state-machine
  routine-deduplication
  handoff-loop-limits
  permission-fail-closed
  event-replay
  worker-crash-recovery

tests/e2e/
  local-web
  tauri-remote             # post-MVP
```

Provide two fakes:

- `fake-agent-worker`: deterministic messages, tools, permissions, crashes and malformed events;
- `fake-computer-worker`: deterministic frames, lease contention, user takeover and input failures.

Most orchestration tests should use these fakes; real model calls are reserved for versioned conformance and manual acceptance.

## 14. Build order

1. `domain`, `protocol`, `agent-contract`, fake workers;
2. daemon bootstrap, SQLite migrations and event cursor;
3. Task/Run and Computer lease state machines;
4. Pi worker and local Web vertical slice;
5. remaining Agent workers and conformance;
6. roles, routines, memory and handoffs;
7. harden local auth and protocol replay;
8. Tauri shell, device pairing and remote transport.

Do not start Tauri by copying the Web app into a separate codebase. The Tauri phase should add a host and transport configuration around the already-versioned client.
