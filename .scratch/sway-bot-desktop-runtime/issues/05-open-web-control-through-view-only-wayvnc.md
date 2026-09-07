# 05: Open Web Control through view-only WayVNC

**Parent:** [#8](https://github.com/XMethues/omarchy-bot/issues/8)

**What to build:** Replace expanded H.264 viewing for a single Sway Bot Screen with a daemon-carried, view-only WayVNC RFB projection while preserving the existing Computer Broker-authorized keyboard, pointer, scroll, paste, and Takeover behavior.

**Blocked by:** 01: Make Screen Projection transport replaceable without changing Cage behavior; 03: Control Sway through native IPC and private input.

**Status:** resolved

- [x] Expanding Computer Preview starts one private WayVNC instance and displays the intended Sway output through an embedded, pinned browser RFB client.
- [x] WayVNC binds only to an application-owned owner-only Unix socket; no private socket path or VNC TCP listener is exposed to the Bot Client.
- [x] WayVNC remote input and clipboard are disabled, and the browser RFB client is configured view-only.
- [x] An attempted keyboard or pointer mutation sent as RFB data cannot change the Bot Screen.
- [x] Pointer, button, wheel, physical key, and paste events sent through the valid Broker-authorized control channel do change only the intended Bot Screen.
- [x] Existing controller epochs, ordering, motion coalescing, coordinate scaling, held-input tracking, Takeover, and release barriers remain authoritative.
- [x] Preview-only mode uses low-frequency direct PNG capture and does not start WayVNC.
- [x] Projection creation returns versioned Surface, runtime, geometry, preview, view, control, and fallback information without leaking runtime internals.
- [x] Unsupported or failed RFB projection falls back to an explicitly read-only snapshot while the Sway Bot Desktop Session remains healthy.
- [x] Public browser and daemon tests exercise the complete preview-to-expanded-to-control flow.

## Historical answer

This records the initial intermediate implementation. Current transport and browser behavior are superseded by ticket 12: projection v3 uses WebSockets and real noVNC 1.7, with no WebRTC/H.264 path. Current acceptance is in the conformance and completion reports.

Sway `acquireExpandedView` now starts an injected WayVNC only when an expanded lease is acquired. The process binds an owner-only Unix socket `<generationDir>/wayvnc.sock` (mode 0600) with `--unix-socket --disable-input`, attaches to the private Wayland env and `HEADLESS-1`, and is supervised as a `wayvnc` application-unit role. Pinned wayvnc 0.10.1 has no `--disable-paste`; `--disable-input` also disables clipboard management. The lease `send`/`receive` is a daemon-side Unix-socket bridge; `close()` stops only WayVNC and removes that socket. Unexpected WayVNC exit fails the lease, not the Bot Screen.

`ScreenProjectionService` uses that lease only when `source.expandedProjection === "rfb"` (Sway sets it; Cage/Fake omit it and keep H.264 + `openCaptureStream`). Preview on RFB sources uses 1 Hz `capture()` PNG and never starts WayVNC. Expanded RFB completes existing WebRTC signaling for control/input/preview, adds `screen.view.v3`, skips ffmpeg, and advertises optional `capabilities.expandedView` on protocol v2. Failed acquire/lease death marks `rfb-failed` with `snapshotFallback: true` and leaves `screens.status` `ready`.

The Computer Surface reuses the expanded dialog: H.264 still renders `<video data-testid="computer-expanded-video">`; RFB mounts pinned `@novnc/novnc@1.6.0` into `data-testid="computer-expanded-view"` with `viewOnly = true`. Broker pointer/keyboard/paste stay on the dialog chrome.

**Browser e2e gap:** the existing Playwright Computer Surface harness fakes H.264 via `canvas.captureStream` and cannot inject a Sway/WayVNC tree without a real compositor. Daemon projection tests plus `apps/web/src/lib/screenProjection.test.ts` cover preview → expanded RFB → Broker input. No host Sway/WayVNC was launched.

**Tests (all passed) + `bun run typecheck`:**
- `expanded view starts one owner-only WayVNC unix socket and close leaves Sway ready`
- `RFB pointer bytes on the expanded-view lease do not move the Bot Screen`
- `Fake H.264 projection answers omit expandedView`
- `Sway preview keeps PNG capture and does not start WayVNC`
- `Sway expanded Web Control starts WayVNC and relays RFB bytes without leaking the socket`
- `failed RFB projection falls back to a snapshot while Sway stays ready`
- `Broker-authorized input still reaches Sway after expanded RFB is up`
- `RFB expandedView exposes view-only bytes and does not require H.264 video`
- `H.264 answers keep the video path and omit expandedView`
- plus existing `screen-projection`, `bot-screen-sway-runtime`, `bot-screen-sway-control`, and `bot-screen-lifecycle` files

**Leftover risk:** ticket 06 still has to share one WayVNC across viewers; each expanded session currently starts its own instance. Ticket 08 still supplies the real binary. Production remains Cage until ticket 10.
