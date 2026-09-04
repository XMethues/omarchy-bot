# Omarchy Bot

A local AI teammate workspace for Omarchy. Users create named Bots, choose any supported Agent backend, and work with them through persistent conversations, rich input, native Agent capabilities, and contextual access to the shared Omarchy computer.

## Product model

- A **Bot** is a user-created teammate with a name, Job/Instructions, and avatar.
- An **Agent** is an execution backend such as Pi, Claude, Codex, or Grok.
- A Bot references one immutable Agent; several Bots may use the same Agent.
- Every Agent adapter preserves its native behavior and maintains a tested capability inventory. Omarchy Bot does not add a separate Agent permission policy or capability allowlist.
- All Bots currently share one physical Omarchy screen. An internal Computer Broker serializes desktop input without exposing lease mechanics in the normal UI.

The accepted product specification is [`docs/workspace-redesign.md`](docs/workspace-redesign.md). Domain vocabulary is routed through [`CONTEXT-MAP.md`](CONTEXT-MAP.md).

## Status

The repository implements the accepted user-created-Bot workspace and its contracted public model.

The current vertical slice uses Pi and includes a Bun daemon, React web client, SQLite persistence, worker protocol, and computer worker. Other Agents become selectable only after their adapter and versioned conformance inventory pass.

## Repository

```text
apps/web/                 React conversation workspace
apps/daemon/              localhost API, persistence, orchestration
workers/pi/               Pi SDK adapter
workers/computer/         shared Omarchy computer backend
packages/domain/          domain types and state transitions
packages/protocol/        REST/WebSocket schemas
packages/agent-contract/  daemon ↔ Agent worker protocol
packages/api-client/      typed client
tests/                    integration and Agent conformance tests
docs/                     accepted design, ADRs, research, inventories
```

The daemon is the only SQLite writer. Agent SDKs and native protocols run behind isolated workers. The browser talks only to the localhost daemon.

## Development

Requirements:

- Bun 1.4+
- a configured Pi installation for real Pi conformance
- `computer-use-linux` for real desktop control
- Voxtype for Composer dictation

```bash
bun install
bun run dev
```

Open <http://127.0.0.1:7322>.

For access from another machine on a trusted LAN, opt in to non-loopback listeners:

```bash
OMARCHY_BOT_HOST=0.0.0.0 bun run dev
```

Screen Projection uses multiplexed WebRTC on `7323/UDP` by default. If a host firewall is active, allow that port only from the trusted LAN:

```bash
sudo ufw allow from <lan-cidr> to any port 7323 proto udp
```

Set `OMARCHY_BOT_SCREEN_WEBRTC_PORT` to use a different UDP port.

Then open `http://<host-lan-ip>:7322`. This exposes the unauthenticated control API and desktop input on the network; do not use it on an untrusted network.

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
