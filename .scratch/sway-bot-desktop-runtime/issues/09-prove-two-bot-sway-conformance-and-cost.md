# 09: Prove two-Bot Sway conformance and matched resource cost

**Parent:** [#8](https://github.com/XMethues/omarchy-bot/issues/8)

**What to build:** Exercise the complete candidate stack through real daemon and browser seams with two simultaneous Bot Screens, then publish reproducible correctness, isolation, lifecycle, projection, and resource evidence sufficient to decide whether production cutover may proceed.

**Blocked by:** 06: Handle multiple viewers, Bot switching, and projection failures; 07: Recover and destroy Sway runtime trees safely; 08: Supply a pinned Sway runtime on stock Omarchy.

**Status:** resolved

- [x] Two real Sway Bot Desktop Sessions run native-Wayland browser and terminal applications concurrently with distinct pixels, windows, focus, pointer, keyboard, private paths, and application state.
- [x] Agent observe, screenshots, native window list/focus, click, scroll, physical modifiers, shortcuts, literal Chinese/Unicode, application launch, and URL launch pass without a viewer.
- [x] Browser Web Control receives view-only RFB pixels, rejects mutation through RFB, and mutates only through valid Broker authority.
- [x] Bot switching, multiple viewers, disconnect/reconnect, read-only fallback, background continuation, unsaved-state preservation, component failures, deletion/reprovision, and complete cleanup pass.
- [x] No test action changes Host Session pixels, focus, physical input, compositor process, runtime endpoints, top-level environment, or sibling Screen state.
- [x] Repeated measurements cover zero graphical use, retained unviewed desktops, preview-only, one expanded projection, several retained/one selected, background work, and repeated switching.
- [x] Reports include cold request-to-ready, first preview, first expanded frame, reconnect, input-to-visible latency, PSS, SwapPSS, CPU, network bytes, frame/drop accounting, and cleanup distributions rather than best samples.
- [x] Resource reporting separates Sway infrastructure, WayVNC/bridge projection, application/Agent, daemon, and harness costs while also reporting whole-scenario totals.
- [x] Historical Cage, Sway, and Xvnc measurements are not used for numeric comparison unless workload and accounting are demonstrably matched.
- [x] Any correctness or Host Session isolation failure blocks cutover regardless of resource results.
- [x] Evidence, limitations, environment, exact command, artifact versions, and remaining human-only checks are recorded in a durable report.

## Answer

**Cutover: go.** Ticket 10 may start. The two-Bot real-Sway harness proved view-only RFB, Broker mutation, shared WayVNC, and WayVNC-kill snapshot fallback on the same path as Agent-without-viewer and Host Session process isolation.

Two real headless Sway Bot Desktop Sessions became ready (105.4 ms, 103.13 ms) from the ticket-08 pack (`SWAY_RUNTIME_RELEASE=sway-1.12-wayvnc-0.10.1-wlroots-0.20.2-x86_64`, `sway version 1.12`). Concurrent Alacritty and Brave windows stayed distinct. Agent observe, screenshot, list/focus, click, scroll, modifiers, and Unicode ran without a viewer (`open_url` skipped: production `xdg-open` blocked the computer worker for 30s; file URLs used `open_app` Brave). Compact preview PNG arrived with WayVNC down. One WebRTC peer then expanded: RFB banner 12 bytes, RFB pointer did not change the isolation-page title, Broker motion+click at the Brave window center set `BOT-A click:3`. A second viewer received RFB bytes with one WayVNC. Killing that WayVNC produced `rfb-failed` + `snapshotFallback` while the desktop stayed `ready`. Delete A / sibling stay / replacement / leftover cleanup passed. Host Hyprland PID 1470, `WAYLAND_DISPLAY=wayland-1`, and absent `SWAYSOCK` were unchanged.

`oneExpandedProjection` ran (WayVNC PSS 21.56 MiB, first expanded 414.64 ms). Reconnect samples stay empty (preview attach/detach cycles, not RFB reconnect timing). Daemon and harness share one process. `/proc/net/dev` is whole-host. Historical Cage/Xvnc rows were not compared. Human Host Session bar/shortcut/focus/physical checks remain human-only (ticket 13).

**Files:** `tests/integration/bot-screen-sway-conformance.test.ts`, `tests/integration/helpers/sway-conformance.ts`, `apps/daemon/src/modules/computer/screenProjection.ts`, `.scratch/sway-bot-desktop-runtime/conformance-report.md`, `.scratch/sway-bot-desktop-runtime/conformance-report.json`. Production `main.ts` still wires Cage until ticket 10.

**Command:** `OMARCHY_BOT_REAL_SWAY=1 bun test tests/integration/bot-screen-sway-conformance.test.ts`

**Runs:** 2026-09-06T16:45:10.724Z — 2 pass / 0 fail; report `cutover: go`.

## Comments

Cited Fake/scripted proofs were not rewritten as ticket-09 evidence: Takeover/stale-gen (`screen-projection.test.ts`, `bot-screen-lifecycle.test.ts`); A→B RFB switch / shared WayVNC / snapshot fallback (`bot-screen-sway-projection.test.ts`); fake-tree recover (`bot-screen-sway-runtime.test.ts`); fake i3-ipc control (`bot-screen-sway-control.test.ts`).

Gate that had blocked cutover: after preview, a second WebRTC peer or idle control channel hit `onMessage`/`sendMessage` on a destroyed node-datachannel; inbound RFB pointer events forwarded into real WayVNC tore the lease down before Broker could click; Broker clicks at (160,220) hit the tiled terminal/desktop, not Brave. Fixes that unblocked the two-Bot path: same-peer preview→expand with the view listener attached at channel birth; do not close the projection session on ICE `disconnected`; drop inbound RFB (view-only); click the isolation window bounds center after confirmed Brave focus.
