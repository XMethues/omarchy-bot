# Omarchy Bot Context Map

Read every context whose concepts or code paths intersect the work. Cross-context changes also require the system ADRs in `docs/adr/`.

| Context | Domain document | Context ADRs | Use when working on |
| --- | --- | --- | --- |
| Workspace | `docs/contexts/workspace/CONTEXT.md` | `docs/contexts/workspace/adr/` | Bot identity and lifecycle, profiles and avatars, Threads, Composer drafts, steering, conversation UI, attachments, notifications |
| Agent Integration | `docs/contexts/agent-integration/CONTEXT.md` | `docs/contexts/agent-integration/adr/` | Agent registry, adapters, worker protocol, native sessions/events, readiness, conformance, capability inventory |
| Computer Control | `docs/contexts/computer-control/CONTEXT.md` | `docs/contexts/computer-control/adr/` | shared-screen arbitration, observation and input, takeover, Computer Sheet, computer worker, emergency stop |

## Code routing

These paths are hints, not ownership walls. Follow the concepts when a change crosses paths.

- `apps/web/`, Bot/Thread/attachment modules in `apps/daemon/`, and product DTOs usually require **Workspace**.
- `workers/*` except `workers/computer/`, Agent supervision, Agent contracts, readiness, and conformance require **Agent Integration**.
- `workers/computer/`, the daemon Computer Broker, and Computer domain/protocol types require **Computer Control**.
- `packages/domain/`, `packages/protocol/`, `packages/api-client/`, daemon bootstrap, persistence, and integration tests often cross two or three contexts.

## System-wide decisions

`docs/adr/` contains decisions spanning context boundaries. Read it for changes to Bot–Agent identity, persistence relationships, public protocol boundaries, or other cross-context behavior.
