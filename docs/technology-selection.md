# Active technology selection

> Accepted stack for the user-created-Bot workspace. Historical dashboard, Role/Routine, and Agent-as-Bot assumptions are intentionally excluded.

## Stack

```text
Runtime:               Bun + TypeScript
Daemon:                Bun.serve + SQLite (single writer)
Agent integrations:    isolated Bun workers around official SDK/protocol surfaces
Web UI:                React 19 + Vite
Design system:         Astryx through an omarchy-bot semantic adapter
Styling:               Astryx tokens with product-owned layout styles
Frontend data:         TanStack Router + Query + Virtual where needed
Desktop integration:   systemd user service + localhost API
Computer backend:      computer-use-linux behind computer-worker
Bot Screen runtime:   one pure-headless Cage + persistent Bot Desktop per Bot
Screen Projection:    low-frequency PNG preview + WebRTC H.264 Web Control
Voice input:           Voxtype through the localhost daemon
Persistence:           SQLite + daemon-managed local media
```

## Runtime boundary

The daemon owns product state, SQLite, the REST/WebSocket API, process supervision, notifications, dictation, attachments, and Computer coordination. Agent workers isolate vendor SDKs, native processes, crashes, and version changes. Workers never open product SQLite or import web code.

Workers start on demand by Agent, not by visible Bot. Several user-created Bots may share one Agent worker/runtime while retaining independent native sessions.

The production daemon runs as a systemd user service with a fixed Bun runtime and absolute paths. Omarchy Shell integration may launch or summarize the product, but it does not own the daemon lifecycle.

Bot Screens do not inherit the user's Wayland display. The daemon provisions Cage directly with private runtime directories and headless outputs; no runtime selector or fallback compositor is supported. The HTTP PNG snapshot remains a read-only recovery path and never substitutes an interactive live transport.

## Agent integration rule

Use the richest official interface for each Agent. Every installed version must pass the inventory and conformance policy in [`agents-integration.md`](agents-integration.md). Never fall back silently to PTY scraping, one-shot headless output, or an omarchy-bot permission shim.

## Web UI

Use React 19 because Astryx and the stable TanStack React adapters cover the required accessible conversation interactions. Streaming updates are buffered, transcript rows subscribe selectively, and long histories may use TanStack Virtual. Computer frames do not flow through ordinary React message state.

### Astryx policy

Use Astryx primitives discovered through its CLI. Feature code consumes product-semantic wrappers rather than duplicating SideNav, Sheet/Dialog, ChatComposer, ChatMessageList, Avatar, selectable cards, focus management, or accessibility behavior.

Do not introduce a second component system. Product-specific composition may use React and Astryx tokens, but should not copy shadcn or another registry.

Required update checks include:

- type and build compatibility;
- keyboard and focus behavior;
- axe/screen-reader smoke tests;
- light/dark visual regression;
- streaming and reduced-motion behavior.

## State ownership

```text
TanStack Query
  REST snapshots, point reads, mutations, reconnect reconciliation

Ordered event projection
  WebSocket cursor, Bot/Thread/activity/computer state, streaming deltas

Window-local state
  Composer drafts, staged attachments, focus, open Sheets
```

Token deltas update the projection directly and do not trigger query refetches.

## Persistence and privacy

- SQLite is written only by the daemon.
- Managed attachments and avatar uploads stay under the local product data directory.
- Voxtype audio is handled by Voxtype; omarchy-bot retains only the resulting draft text.
- The current API binds to `127.0.0.1`.
- Uploaded images are re-encoded; Agent-generated Avatar Recipes are validated data, never executable SVG.

## Rejected choices

- Browser speech recognition/audio upload: Voxtype is the local speech-to-text provider.
- Multiple design systems: Astryx is the sole component system.
- TanStack Start: the Bun daemon already owns the server/API.
- Public network listener or desktop runtime inside the browser: out of scope for the current local product.

## Primary references

- Accepted workspace: [`workspace-redesign.md`](workspace-redesign.md)
- Agent inventory: [`agents-integration.md`](agents-integration.md)
- Astryx: <https://astryx.atmeta.com/> and <https://github.com/facebook/astryx>
- React: <https://react.dev/>
- TanStack: <https://tanstack.com/>
- Bun: <https://bun.sh/docs>
- Voxtype integration: [`research/voxtype-composer-integration.md`](research/voxtype-composer-integration.md)
- Computer coordination: [`research/multi-bot-computer-control.md`](research/multi-bot-computer-control.md)
