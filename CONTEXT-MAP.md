# Omarchy Bot Context Map

Read every context whose concepts or code paths intersect the work. Cross-context changes also require the system ADRs in `docs/adr/`.

| Context | Domain document | Context ADRs | Use when working on |
| --- | --- | --- | --- |
| Workspace | `docs/contexts/workspace/CONTEXT.md` | `docs/contexts/workspace/adr/` | Bot Client and Web/Tauri evolution, Bot identity and lifecycle, Shared Workspace and work-file ownership, profiles and avatars, Threads, Composer drafts, steering, conversation UI, attachments, notifications |
| Agent Integration | `docs/contexts/agent-integration/CONTEXT.md` | `docs/contexts/agent-integration/adr/` | Agent registry, adapters, worker protocol, Native Sessions versus desktop sessions, working-directory selection, readiness, conformance, capability inventory |
| Computer Control | `docs/contexts/computer-control/CONTEXT.md` | `docs/contexts/computer-control/adr/` | Host Session protection, Bot Screens and desktop sessions, Screen Projection, per-Screen input coordination, Takeover, Computer Surface, computer worker |

## Code routing

These paths are hints, not ownership walls. Follow the concepts when a change crosses paths.

- `apps/web/`, Bot/Thread/attachment modules in `apps/daemon/`, and product DTOs usually require **Workspace**.
- `workers/*` except `workers/computer/`, Agent supervision, Agent contracts, readiness, and conformance require **Agent Integration**.
- `workers/computer/`, the daemon Computer Broker, and Computer domain/protocol types require **Computer Control**.
- `packages/domain/`, `packages/protocol/`, `packages/api-client/`, daemon bootstrap, persistence, and integration tests often cross two or three contexts.

## System-wide decisions

`docs/adr/` contains decisions spanning context boundaries. Read it for changes to Bot–Agent identity, persistence relationships, public protocol boundaries, or other cross-context behavior.

For shared work files, desktop/session sharing, application-state ownership, Changes UI, or resource-cost claims, read [ADR 0009](docs/adr/0009-share-work-files-isolate-bot-screens.md) and [the product boundary](docs/workspace-redesign.md#shared-workspace-and-plugin-boundary). They distinguish the accepted model from implementation gaps; historical specs and measurements do not override them.

For frontend reuse, client-shell integration, Tauri planning, or client-versus-execution responsibilities, read [ADR 0010](docs/adr/0010-reuse-web-client-in-tauri.md). Tauri is an accepted future client, not a replacement execution host or a second business-logic implementation. Reuse the current Web UI and daemon-facing behavior; keep execution on Omarchy; do not add native scaffolding now; do not treat Chromium tests as WebView proof.

## Vocabulary

Glossaries define terms. Product rules and acceptance live in [the product boundary](docs/workspace-redesign.md#shared-workspace-and-plugin-boundary), [ADR 0009](docs/adr/0009-share-work-files-isolate-bot-screens.md), [ADR 0010](docs/adr/0010-reuse-web-client-in-tauri.md), and [the current implementation specification](.scratch/shared-workspace-desktop-boundary/spec.md).

| Term | Glossary |
| --- | --- |
| Bot, Bot Client, Thread, Shared Workspace | `docs/contexts/workspace/CONTEXT.md` |
| Agent, Native Session | `docs/contexts/agent-integration/CONTEXT.md` |
| Host Session, Bot Screen, Bot Desktop Session, Screen Projection | `docs/contexts/computer-control/CONTEXT.md` |

## Current and historical documentation

Current authority is the product boundary, ADR 0009, ADR 0010, Computer ADR 0008, the three glossaries, and [the Shared Workspace / Bot Desktop implementation specification](.scratch/shared-workspace-desktop-boundary/spec.md). That specification records pending runtime work; documentation consolidation does not mark those items done.

Older specifications, tickets, and research notes are historical unless they agree with the documents above. [The requirement map](.scratch/shared-workspace-desktop-boundary/requirement-map.md) lists each mixed or superseded document, where its still-valid requirements live, and which measurements remain evidence only. Do not implement Changes, a single shared input seat, nested Hyprland, or per-Bot browser/profile/login policy from those older sources. Four-stream capacity results are not current Host Session or normal-use-cost acceptance.
