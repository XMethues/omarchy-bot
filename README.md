# Omarchy Bot

An Omarchy plugin for local AI teammates. Omarchy Bot is intentionally and deeply coupled to Omarchy: its Shell lifecycle, desktop services, application environment, Agent installations, and Bot Screen runtime are Omarchy contracts. It is not a general-purpose Linux application.

## Product model

- A **Bot** is a user-created teammate with a name, Job/Instructions, and avatar.
- An **Agent** is an execution backend such as Pi, Claude, Codex, or Grok.
- A Bot references one immutable Agent; several Bots may use the same Agent.
- Every Agent adapter preserves its native behavior and maintains a tested capability inventory. Omarchy Bot does not add a separate Agent permission policy or capability allowlist.
- Each Bot has its own Screen identity; a lightweight desktop session is provisioned on demand. The Computer Broker coordinates Agent and human input per Screen, so switching the viewed Bot does not interrupt other Bots' desktop work.
- Bots share work files rather than plugin source. The accepted Shared Workspace default and the boundary between plugin desktop infrastructure and native application behavior are defined in the [product model](docs/workspace-redesign.md#shared-workspace-and-plugin-boundary).

The accepted product specification is [`docs/workspace-redesign.md`](docs/workspace-redesign.md). Domain vocabulary is routed through [`CONTEXT-MAP.md`](CONTEXT-MAP.md).

The current Web frontend will be reused for a future Tauri desktop client. [ADR 0010](docs/adr/0010-reuse-web-client-in-tauri.md) defines the shared-client contract; Agents and Bot desktops continue running on the Omarchy side. Tauri delivery is not yet implemented.

## Status

The application now uses private Sway Bot Desktop Sessions, view-only RFB over WebSockets, and the existing Computer Broker input path. Automated and real two-Bot conformance are recorded in [.scratch/sway-bot-desktop-runtime/completion-report.md](.scratch/sway-bot-desktop-runtime/completion-report.md). Hands-on Host Session acceptance remains pending; automated process/socket checks do not prove the user’s bar, shortcuts, or physical input experience. The [product model](docs/workspace-redesign.md) remains the authority for broader workspace work.

The current vertical slice uses Pi and includes a Bun daemon, React web client, SQLite persistence, worker protocol, and computer worker. Other Agents become selectable only after their adapter and versioned conformance inventory pass.

## Repository

```text
apps/web/                 React conversation workspace
apps/daemon/              localhost API, persistence, orchestration
workers/pi/               Pi SDK adapter
workers/computer/         Bot Screen computer backend
packages/domain/          domain types and state transitions
packages/protocol/        REST/WebSocket schemas
packages/agent-contract/  daemon ↔ Agent worker protocol
packages/api-client/      typed client
tests/                    integration and Agent conformance tests
docs/                     accepted design, ADRs, research, inventories
```

The daemon is the only SQLite writer. Agent SDKs and native protocols run behind isolated workers. The browser talks only to the localhost daemon.

## Installation

Install and enable Omarchy Bot through Omarchy's official plugin manager:

```bash
omarchy plugin add https://github.com/XMethues/omarchy-bot.git --enable
```

The repository root is the plugin contract. Omarchy Shell loads `plugin/Service.qml`. The launcher resolves Bun from PATH, then mise, then a checksum-verified official Bun 1.4.2 download under `OMARCHY_BOT_HOME`. For the current Git SHA it downloads the HTTPS release asset `omarchy-bot-runtime-<sha>-x86_64.tar.zst` and its SHA-256 sidecar, verifies and atomically prepares `$XDG_DATA_HOME/omarchy-bot/app/<sha>/` (or `$OMARCHY_BOT_HOME/app/<sha>/`). The runtime contains the built web client, native helpers, application source, and production dependencies; a published runtime does not run an install or compiler on first enable.

CI publishes assets under `https://github.com/XMethues/omarchy-bot/releases/download/runtime-<sha>/`. Source-build fallback is reserved for a confirmed missing artifact, such as a local/unpublished SHA. Network, server, and integrity failures stop startup rather than silently compiling. The checkout stays clean and fast-forwardable; no host packages or Omarchy files are changed.

Startup output goes to `$XDG_STATE_HOME/omarchy-bot/plugin-launch.log` (default `~/.local/state/omarchy-bot/plugin-launch.log`), and the service invokes `notify-send` on failure. A private supervisor lifeline requests graceful daemon cleanup even when Quickshell destroys the plugin process; the startup lock remains held until cleanup finishes.

Omarchy Bot supports Omarchy on x86_64 only. Other Linux distributions, standalone service installation, and generic Linux release archives are outside the supported product contract.

## Development

Requirements:

- Bun 1.4+
- `grim` and `tar` with zstd archive support for Bot Screens
- Wayland development headers, `wayland-scanner`, a C compiler, and `pkg-config` for the capture/input helpers
- `computer-use-linux` for real desktop control
- a configured Pi installation for real Pi conformance
- Voxtype for Composer dictation

Sway is the internal compositor because each Bot needs an independent, pure-headless Wayland Screen; it is not a portability layer for other Linux distributions. On the first Bot Screen, the plugin uses an installed `sway`/`wlr-randr`/`wayvnc` set when available, otherwise it downloads the pinned Arch packages appropriate to Omarchy, verifies every SHA-256 digest, and publishes them under `OMARCHY_BOT_HOME`. Explicit development overrides remain authoritative.

```bash
bun install
bun run dev
```

Open <http://127.0.0.1:7322>.

## Bot-to-Bot mail

Bot mail is local, asynchronous, 1:1 text delivery. Create two Bots, select the
target once, and copy its stable `bot_…` ID from the `bot` query parameter in
the browser URL. Then ask the source Bot to use the native tool exactly once:

```text
Use send_bot_message with targetBotId "bot_0123456789abcdef0123456789abcdef"
and text "Review the release checklist." Then conclude without waiting.
```

A successful Tool Call acknowledges only that the delivery was durably queued;
it does not return the target’s eventual output. The target receives a new
target-owned Thread, gains ordinary unread attention, and runs later with its
own current Instructions and only the sender attribution plus delivered text.
The source Thread, Native Session, memory, attachments, and filesystem paths
remain private. Open the target’s unread Thread to inspect its normal ordered
response and History. To reply, the target makes a separate
`send_bot_message` call addressed to the original source Bot ID.

For access from another machine on a trusted LAN, opt in to non-loopback listeners:

```bash
OMARCHY_BOT_HOST=0.0.0.0 bun run dev
```

Each Bot Screen is a pure-headless Sway compositor with private endpoints and a retained Bot Desktop Session; it does not attach to the Host Session. Projection protocol v3 uses one WebSocket for PNG preview and Broker-authorized control/input, and a separate bidirectional RFB WebSocket consumed by bundled noVNC 1.7 in view-only mode. WayVNC remote input is disabled. `/api/computer/snapshot` remains a read-only fallback; closing a viewer does not stop Sway or its applications.

Conservative admission policy defaults to at most four 1080p Screens and permits up to eight with the 720p profile. These limits are not a measured Sway performance approval; historical Cage measurements are archived and no longer authorize production startup:

```bash
OMARCHY_BOT_SCREEN_PROFILE=720p OMARCHY_BOT_SCREEN_CAPACITY=8 bun run dev
```

An eight-Screen 1080p configuration is rejected before any excess Screen is provisioned.

Projection uses the same HTTP(S) listener and WebSockets; there is no separate WebRTC/UDP listener. When opting into LAN access, open `http://<host-lan-ip>:7322` for development, or the configured production daemon address. Non-loopback access exposes an unauthenticated control API, Screen observation, and desktop input. Private Wayland sockets are not remote authentication; do not expose this listener on an untrusted network.

Useful checks:

```bash
bun run typecheck
bun test
bun run build
bun test tests/conformance/pi.test.ts  # real model calls
```

## Local data

Product data is stored under `~/.local/share/omarchy-bot/`; runtime state is under `~/.local/state/omarchy-bot/` and `$XDG_RUNTIME_DIR` where appropriate. Managed attachments, avatar uploads, and Voxtype transcript handoff remain local.

The daemon and Vite bind to `127.0.0.1` by default. Setting `OMARCHY_BOT_HOST` opts both listeners into another address, including `0.0.0.0` for trusted-LAN access. Agent runtimes and raw desktop input sockets remain private implementation details.

## Design sources

- [`docs/workspace-redesign.md`](docs/workspace-redesign.md) — accepted product and interaction specification
- [`docs/agents-integration.md`](docs/agents-integration.md) — Agent adapter and capability inventory
- [`docs/technology-selection.md`](docs/technology-selection.md) — active runtime and frontend choices
- [`docs/research/`](docs/research/) — focused primary-source research
- [`docs/adr/`](docs/adr/) and [`docs/contexts/`](docs/contexts/) — system-wide and context-specific decisions
