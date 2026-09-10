<div align="center">

# Omarchy Bot

**Your AI teammates. Your work files. Built for Omarchy.**

Create named Bots, work together in Threads, and see their desktop work in Bot Screens.

[![Platform: Omarchy x86_64](https://img.shields.io/badge/Omarchy-x86__64-183D32?style=flat-square)](#installation)
[![Runtime: Bun 1.4+](https://img.shields.io/badge/Bun-1.4%2B-183D32?style=flat-square)](#development)
[![License: MIT](https://img.shields.io/badge/License-MIT-183D32?style=flat-square)](LICENSE)

[Install](#installation) · [Develop](#development) · [How it works](#product-model) · [Design docs](#design-sources)

</div>

---

Omarchy Bot is an Omarchy plugin for local AI teammates, not a general-purpose Linux application. It integrates with Omarchy's Shell lifecycle, desktop services, application environment, and installed Agents.

| Work with teammates | Keep the context |
| :--- | :--- |
| **Give each Bot an identity** | A name, Job/Instructions, and an uploaded or generated avatar. Multiple Bots can use the same Agent. |
| **Follow the work in Threads** | Responses, Thinking, and Tool Calls retain their original order. Per-Bot display settings control what you see, not what is retained. |
| **Watch and take over desktop work** | Each Bot has a routed Screen inside one private Bot Computer, separate from your Host Session. |
| **Share files and application state** | Bots use a Shared Workspace and a shared Bot Computer profile, including browser state. |
| **Hand work to another Bot** | Durable, asynchronous 1:1 mail creates a target-owned Thread without forwarding the source conversation. |

> [!IMPORTANT]
> **Current support:** Omarchy on **x86_64**, with **Pi** as the current Agent backend. Other Agents require an adapter and a passing versioned conformance inventory before becoming selectable. The Tauri desktop client is planned, not shipped.

## Installation

Install and enable through Omarchy's official plugin manager:

```bash
omarchy plugin add https://github.com/XMethues/omarchy-bot.git --enable
```

Published runtimes include the built web client, native helpers, application source, and production dependencies. First enable uses a SHA-256-verified release artifact instead of running an install or compiler.

<details>
<summary><strong>Runtime delivery and startup diagnostics</strong></summary>

The repository root is the plugin contract; Omarchy Shell loads `plugin/Service.qml`.

- **Bun resolution:** PATH, then mise, then a checksum-verified official Bun 1.4.2 download under `OMARCHY_BOT_HOME`.
- **Release artifacts:** `omarchy-bot-runtime-<sha>-x86_64.tar.zst` and its SHA-256 sidecar, published under `https://github.com/XMethues/omarchy-bot/releases/download/runtime-<sha>/`.
- **Runtime location:** `$XDG_DATA_HOME/omarchy-bot/app/<sha>/`, or `$OMARCHY_BOT_HOME/app/<sha>/` when overridden. Preparation is atomic and keeps the checkout clean and fast-forwardable.
- **Source fallback:** only for a confirmed missing artifact, such as a local or unpublished SHA. Network, server, and integrity failures stop startup rather than silently compiling.
- **Failure handling:** `notify-send` reports startup failures. A private supervisor lifeline requests graceful daemon cleanup when Quickshell destroys the plugin process; the startup lock remains held until cleanup finishes.

Startup log:

```text
~/.local/state/omarchy-bot/plugin-launch.log
```

Set `XDG_STATE_HOME` to relocate the log. No host packages or Omarchy files are changed. Standalone service installation, other Linux distributions, and generic Linux release archives are outside the supported product contract.

</details>

## Product model

**A Bot is a teammate. An Agent is its execution backend.** Each Bot references one immutable Agent; several Bots may use the same Agent. Adapters preserve native capabilities and approval behavior, rather than adding a separate permission policy or capability allowlist.

```text
                         Bot Client · Web
                                |
                       Localhost Bun daemon
                      /         |          \
                 Threads     Agent workers  Computer Broker
                 SQLite         Pi                |
                                      One private Bot Computer
                                      Shared Sway + app profile
                                         /               \
                                    Bot A Screen     Bot B Screen

               Shared Workspace · common work files for all Bots
```

- **One Bot Computer, multiple Bot Screens.** Each active Screen owns an output and workspace in a shared, pure-headless Sway runtime. Screens do not own separate compositors, browser profiles, or input seats.
- **Coordinated desktop input.** The runtime serializes actions across Screens. Human Web Control holds the shared input seat until control is returned; background applications can continue running.
- **Viewing is not execution.** Closing a viewer does not stop the Screen's applications. WayVNC supplies on-demand, view-only RFB projection; Computer Broker remains the input authority.
- **Work files outlive a Bot.** Deleting a Bot removes its plugin-owned data and targeted Screen runtime/workspace, not Shared Workspace files, Agent-owned Native Sessions, or the shared Bot Computer profile.

The accepted [product specification](docs/workspace-redesign.md), [shared Bot Computer decision](docs/adr/0009-share-work-files-isolate-bot-screens.md), and [domain context map](CONTEXT-MAP.md) define the boundaries.

## Status

The current implementation includes a Bun daemon, React web client, SQLite persistence, isolated Agent workers, and the computer worker. Shared Sway runtime, routed Screens, shared application state, and selected-view projection are implemented.

**Host Session acceptance remains open.** Automated real-Sway conformance covers two routed Screens, shared profile/runtime markers, Agent control, projection, URL reuse, deletion/reprovision, and host environment isolation. It does not prove the user's top bar, shortcuts, or ordinary physical-input experience. See the [runtime decision and evidence](docs/contexts/computer-control/adr/0009-adopt-sway-bot-desktops.md).

The future Tauri client will reuse the Web frontend while execution stays on Omarchy. [ADR 0010](docs/adr/0010-reuse-web-client-in-tauri.md) defines that contract; Tauri packaging and WebView compatibility are not implemented or verified by the current client.

## Development

From a local checkout:

```bash
bun install
bun run dev
```

Open **<http://127.0.0.1:7322>**. The daemon listens on `127.0.0.1:7321`; Vite proxies `/api` and WebSockets to it.

### Official website

The public product site lives in `apps/site`, separate from the local Bot Client.
The public pages make no daemon connections or model calls. Product screenshots
use illustrative data. The same Vercel project includes server-side plugin OAuth
and Skills catalog routes; these require publisher configuration before use.

```bash
bun run site:dev   # http://127.0.0.1:7330
bun run site:build # apps/site/dist
```

For Vercel, import the repository and set **Root Directory** to `apps/site`.
Enable access to source files outside that directory for the Bun workspace
installation. `apps/site/vercel.json` sets the install command, build command,
static output directory, and response headers. Deployment requires a signed-in
Vercel account; the repository does not contain deployment credentials.
The production hostname supplied by Vercel generates canonical and social-image
URLs; set `SITE_URL` to the final HTTPS origin when using a custom domain.
Vite previews the public pages only; OAuth and catalog functions run on Vercel.

### Global plugins

Open **Plugins** above **Settings** in the Bot Client sidebar. It opens a large
dialog on desktop and a tall sheet on mobile without navigating away from the
current conversation or discarding its draft.
Managed MCP servers, Skills, and connected service accounts apply globally to all
Bots. Changes take effect at the next Turn; running Turns retain their configuration
and installed Skill revision. Provider-side access revocation can still interrupt
a running call.

- **MCP:** stdio subprocesses and remote Streamable HTTP, with legacy SSE fallback.
  Environment variables and HTTP headers are write-only in the Client.
- **Skills:** search the formal skills.sh catalog, inspect, install, enable, and
  remove. Enabled Skills update automatically every six hours. Installations
  include companion files, not only `SKILL.md`. Pi discovers managed Skills
  alongside native Skills; type `/` in the composer to select one.
- **Services:** separate service cards share a provider account pool, support
  multiple accounts, and request the supported provider group at first consent.
  Google Drive, Gmail, and Calendar are separate cards, as are Microsoft mail,
  calendar, and OneDrive. Provider endpoints and registration notes are maintained
  in `packages/protocol/src/pluginProviders.ts`.

Native Agent configuration is read-only. Managed configuration and OAuth tokens
are stored locally under the daemon's plugin data directory: directories use
mode `0700` and configuration uses `0600`. **Tokens are not encrypted at rest.**
The publisher exchanges codes and refresh tokens but does not persist accounts.
Installed Skills and stdio MCP servers are trusted local code, not a sandbox.
Only Pi currently implements the managed-plugin Agent contract.

The composer uses Astryx's native slash-trigger menu. The pinned
`@astryxdesign/core@0.5.2` patch removes the unsupported `aria-multiline` attribute
when that input is a combobox; Bun applies it during installation, and runtime
archives include the patch. Reassess it when upgrading Astryx.

#### Publisher deployment

Deploy `apps/site` to a stable HTTPS origin, then configure that origin in
**Plugins → Setup**. Set these server-side environment variables in Vercel:

- `PLUGIN_CLOUD_URL` or `SITE_URL`: the deployed HTTPS origin.
- `OAUTH_STATE_SECRET`: a random secret of at least 32 bytes.
- `OAUTH_<PROVIDER>_CLIENT_ID` and `OAUTH_<PROVIDER>_CLIENT_SECRET` for each
  registered provider (uppercase provider ID, such as `GOOGLE` or `MICROSOFT`).
  Notion uses its public Client ID Metadata Document instead of a client secret.
- Enable Vercel OIDC for the formal skills.sh API. OIDC credentials and OAuth
  client secrets stay on the publisher; do not distribute them to Clients.

Register `<origin>/api/plugins/oauth/callback` as each app's OAuth redirect URI.
Notion's metadata document is `<origin>/api/plugins/oauth/client/notion`.
Provider registration is not interchangeable: Google needs the relevant Workspace
APIs and scope review; Microsoft needs delegated Graph permissions and the desired
personal/organization account audience; Asana and HubSpot require their MCP app
configuration. Register the required GitHub, Linear, Dropbox, Intercom, and Miro
apps and permissions as described by each provider's linked setup notes.
Google's public verification also requires a verified domain, accurate homepage
and privacy disclosures, and review of restricted data sent to model providers;
keeping tokens local does not by itself establish a security-assessment exemption.
Intercom's Australian region is not supported by its MCP service.

No production registrations, provider credentials, or live connected accounts are
included. The repository's fixture-backed OAuth checks do not establish live
provider compatibility or completed app reviews. Deploy and authorize real
accounts before presenting these connectors as publicly available.

### Requirements

| Dependency | Used for |
| :--- | :--- |
| **Bun 1.4+** | Workspace dependencies, daemon, and development commands |
| **Configured Pi installation** | Real Agent execution and Pi conformance |
| **`grim`, `tar` with zstd support** | Bot Screen capture and runtime archives |
| **Wayland headers, `wayland-scanner`, C compiler, `pkg-config`** | Native capture/input helpers |
| **`computer-use-linux`** | Real desktop control |
| **Voxtype** | Composer dictation |

Sway is an internal desktop runtime, not a portability layer. On first graphical use, the plugin uses an installed `sway` / `wlr-randr` / `wayvnc` set when available. Otherwise, it downloads pinned Arch packages appropriate to Omarchy, verifies their SHA-256 digests, and prepares them under `OMARCHY_BOT_HOME`. Explicit development overrides remain authoritative.

### Useful checks

```bash
bun run typecheck
bun test
bun run build
```

Real Pi conformance makes model calls and requires a configured Agent:

```bash
bun test tests/conformance/pi.test.ts
```

## Bot-to-Bot mail

Create two Bots. Select the target and copy its stable `bot_…` ID from the `bot` query parameter in the browser URL. Ask the source Bot to call its native tool once:

```text
Use send_bot_message with targetBotId "bot_0123456789abcdef0123456789abcdef"
and text "Review the release checklist." Then conclude without waiting.
```

**Send → durable queue → target-owned Thread → target response.**

A successful Tool Call acknowledges the queued delivery, not the target's eventual output. The target gains ordinary unread attention and runs later with its own current Instructions, the sender attribution, and the delivered text.

Mail does not forward the source Thread, Native Session, memory, attachments, or filesystem paths. This is a message boundary, not filesystem isolation: Bots still share work files. Open the target's unread Thread to inspect its response and History. Replies use a separate `send_bot_message` call addressed to the original source Bot ID.

## Local data

| Data | Default location or ownership |
| :--- | :--- |
| Product data, managed attachments, avatar uploads | `~/.local/share/omarchy-bot/` |
| Persistent runtime state and launch logs | `~/.local/state/omarchy-bot/` |
| Transient sockets and Voxtype transcript handoff | `$XDG_RUNTIME_DIR`, where appropriate |
| Shared Workspace | User work files, separate from plugin source and conversation data |
| Native Sessions | Owned by the selected Agent, not erased by Bot deletion |

“Local” describes the application and its storage, not a promise of offline inference. Model connectivity depends on the configured Agent and provider.

> [!WARNING]
> **The control API has no application authentication.** Keep the default loopback binding unless you deliberately need trusted-LAN access. Anyone who can reach a non-loopback listener can access the control API, observe Screens, and send desktop input. Private Wayland sockets are neither remote authentication nor an adversarial security sandbox.

<details>
<summary><strong>Trusted-LAN access</strong></summary>

Opt both the daemon and Vite into non-loopback listeners:

```bash
OMARCHY_BOT_HOST=0.0.0.0 bun run dev
```

Open `http://<host-lan-ip>:7322` for development, or the configured production daemon address. Do not expose this listener to an untrusted network. HTTPS/WSS encrypts transport but does not establish application peer identity.

Projection protocol v3 uses one WebSocket for PNG preview and Broker-authorized control/input, plus a separate bidirectional RFB WebSocket consumed by bundled noVNC 1.7 in view-only mode. WayVNC remote input and clipboard are disabled. `/api/computer/snapshot` remains a read-only fallback. There is no separate WebRTC/UDP listener.

See the [transport security decision](docs/adr/0004-defer-web-control-transport-security.md).

</details>

<details>
<summary><strong>Screen capacity and resolution</strong></summary>

The conservative admission policy defaults to at most **four 1080p Screens** and permits up to **eight with the 720p profile**:

```bash
OMARCHY_BOT_SCREEN_PROFILE=720p OMARCHY_BOT_SCREEN_CAPACITY=8 bun run dev
```

Eight Screens at 1080p are rejected before any excess Screen is provisioned. These are configuration limits, not a measured Sway performance approval. Historical Cage measurements do not authorize current production performance or Host Session safety claims.

</details>

## Repository

```text
apps/
  web/                     React conversation workspace
  daemon/                  Local API, persistence, orchestration
workers/
  pi/                      Pi SDK adapter
  computer/                Bot Screen computer backend
packages/
  domain/                  Domain types and state transitions
  protocol/                REST and WebSocket schemas
  agent-contract/          Daemon / Agent worker protocol
  api-client/              Typed client
plugin/                    Omarchy Shell service and runtime launcher
scripts/                   Plugin runtime packaging
tests/                     Unit, integration, E2E, and conformance checks
docs/                      Product design, ADRs, research, inventories
```

The daemon is the only SQLite writer. Agent SDKs and native protocols run behind isolated workers. The browser talks only to the daemon.

## Design sources

| Start here | What it defines |
| :--- | :--- |
| [Product and interaction specification](docs/workspace-redesign.md) | Accepted product behavior and ownership boundaries |
| [Agent integration](docs/agents-integration.md) | Adapter contracts and capability inventories |
| [Technology selection](docs/technology-selection.md) | Runtime and frontend choices |
| [Context map](CONTEXT-MAP.md) | Domain vocabulary and documentation routing |
| [Architecture decisions](docs/adr/) · [Domain contexts](docs/contexts/) | System-wide and context-specific decisions |
| [Research](docs/research/) | Focused primary-source investigations |

## License

[MIT](LICENSE) · Copyright © 2026 ColinShen
