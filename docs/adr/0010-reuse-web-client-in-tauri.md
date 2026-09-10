# Reuse the Web client in a future Tauri desktop client

Status: accepted on 2026-09-05; the desktop client is future delivery, not implemented by this decision.

The current Web frontend is the foundation of the future Tauri desktop client, rather than a disposable prototype or a second product to rewrite. Conversation UI, Bot selection, Computer Surface behavior, and daemon-facing contracts remain shared; Tauri supplies a client shell, while Agents, Native Sessions, the Bot Computer, routed Bot Screens, and desktop input execution remain on the Omarchy side. This avoids duplicating business behavior or moving host desktop responsibilities into the viewer.

The current [implementation specification](../../.scratch/shared-workspace-desktop-boundary/spec.md) preserves this client/execution separation but does not ship Tauri packaging, native capabilities, remote pairing, auto-update, or platform support promises. Future Tauri delivery must verify its actual WebView projection and input behavior; existing Chromium tests do not prove noVNC/RFB compatibility. This agreement does not change current network or Omarchy plugin lifecycle contracts.

Reach this decision from [CONTEXT-MAP](../../CONTEXT-MAP.md#system-wide-decisions). Do not add native scaffolding or claim WebView compatibility as part of the current correction.
