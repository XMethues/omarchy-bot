# Sway two-Bot conformance and cost report

Status: complete
Cutover: go
Generated: 2026-09-07T16:49:44.024Z

This is ticket 09 evidence. Historical Cage, Sway, and Xvnc rows are **not** used for numeric comparison: workload and accounting are not matched to those artifacts.

## Command

```
OMARCHY_BOT_REAL_SWAY=1 bun test tests/integration/bot-screen-sway-conformance.test.ts
```

## Environment

- kernel: Linux 7.1.9-arch1-2 x64
- gpu: ["01:00.0 VGA compatible controller [0300]: NVIDIA Corporation TU102 [GeForce RTX 2080 Ti] [10de:1e04] (rev a1)","0c:00.0 VGA compatible controller [0300]: Advanced Micro Devices, Inc. [AMD/ATI] Raphael [1002:164e] (rev c2)"]
- hostname: omarchy
- hostHyprlandRunning: true
- hostCompositorPid: 1470
- hostWAYLAND_DISPLAY: wayland-1
- hostSWAYSOCK: null
- grim: /usr/bin/grim
- browser: /usr/bin/brave
- terminal: /usr/bin/alacritty
- compare: /usr/bin/compare

## Artifact versions

- SWAY_RUNTIME_RELEASE: sway-1.12-wayvnc-0.10.1-wlroots-0.20.2-x86_64
- supplyRoot: /tmp/omarchy-bot-sway-runtime-supply
- swayBin: /tmp/omarchy-bot-sway-runtime-supply/sway-1.12-wayvnc-0.10.1-wlroots-0.20.2-x86_64/bin/sway
- swaymsgBin: /tmp/omarchy-bot-sway-runtime-supply/sway-1.12-wayvnc-0.10.1-wlroots-0.20.2-x86_64/bin/swaymsg
- wayvncBin: /tmp/omarchy-bot-sway-runtime-supply/sway-1.12-wayvnc-0.10.1-wlroots-0.20.2-x86_64/bin/wayvnc
- wlrRandrBin: /tmp/omarchy-bot-sway-runtime-supply/sway-1.12-wayvnc-0.10.1-wlroots-0.20.2-x86_64/bin/wlr-randr
- swayWrapperSha256: a1a7bb925b5c59df106855ff1621569dc7ae9bfa7681010e256ff88cbaf8036f
- wayvncWrapperSha256: 7ccedc635a23fbb917cea4713bd51ac00e8a1d1cc6c1be8daf055e6643c81a9a
- swayVersion: sway version 1.12

## Host isolation

- Unchanged: true

## Correctness

- [x] two-real-sway-sessions: both Screens ready in 104.82ms, 102.82ms
- [x] distinct-apps-and-private-state: distinct pixels=true; private markers=true; A windows=Bot Desktop|BOT-A-TERM|BOT-A; B windows=Bot Desktop|BOT-B-TERM|BOT-B; markers=/tmp/omarchy-bot-sway-home-a8JIo2/screens/surf_912035d2bc2c4e728c386d53a7c60fa4/config|/tmp/omarchy-bot-sway-home-a8JIo2/r/surf_912035d2bc2c4e728c386d53a7c60fa4/1|wayland-1 || /tmp/omarchy-bot-sway-home-a8JIo2/screens/surf_11e761d566e140658e3463f5c1407a56/config|/tmp/omarchy-bot-sway-home-a8JIo2/r/surf_11e761d566e140658e3463f5c1407a56/1|wayland-1
- [x] agent-without-viewer: observe/list/focus/click/scroll/chord passed; sibling focus and title preserved; exact browser and terminal Unicode=你好, world
- [x] preview-no-wayvnc: preview sequence=1 bytes=34966; wayvnc processes=0
- [x] rfb-view-only-and-broker: RFB negotiated=true bytes=3686464; RFB mutation rejected=true; Broker mutated=true; titles=BOT-A click:1 -> BOT-A click:1 -> BOT-A click:2
- [x] multiple-viewers: second viewer negotiated=true; wayvnc processes=1; first viewer preserved=true
- [x] bot-switching: Bot B RFB negotiated=true; Bot A and Bot B screenshots stayed distinct
- [x] component-failure-fallback: projection failure=rfb-bridge-failed; snapshotFallback=true; desktop=ready; wayvncPid=1041838
- [x] real-browser-projection: actual noVNC painted Bot A and Broker-driven marker change; first paint 353.13ms, input-to-paint 94.19ms
- [x] background-and-unsaved: same window/generation and exact unsaved field retained; counter 18 -> 20
- [x] agent-open-url: open_url displayed the requested local page in Bot A without adding a Bot B window
- [x] delete-reprovision-cleanup: deleted A; sibling ready=true; replacement ready; runtime gone=true
- [x] complete-cleanup: no leftover surface-scoped processes
- [x] host-session-isolation: host compositor PID 1470 and WAYLAND_DISPLAY/SWAYSOCK unchanged

## Resource scenarios

### zeroGraphicalUse

- Ran: true
- Sway infra PSS: 0 MiB / SwapPSS 0 MiB / CPU 0%
- WayVNC/projection PSS: 0 MiB / CPU 0%
- Apps+Agent PSS: 0 MiB / CPU 0%
- Daemon+harness PSS: 95.67 MiB / CPU 2.66% (daemon and test harness share this process; daemon bucket is the combined measurement)
- Whole-scenario PSS: 95.67 MiB / SwapPSS 0 MiB / CPU 2.66%
- Host /proc/net/dev delta: {"rxBytes":2542645,"txBytes":3847843}
- Bots not yet created; daemon/harness only.

### retainedUnviewedDesktops

- Ran: true
- Latency: {"coldRequestToReadyMs":{"samples":[104.82,102.82],"min":102.82,"p50":102.82,"p95":104.82,"max":104.82}}
- Sway infra PSS: 29.98 MiB / SwapPSS 0 MiB / CPU 0%
- WayVNC/projection PSS: 0 MiB / CPU 0%
- Apps+Agent PSS: 14.46 MiB / CPU 0%
- Daemon+harness PSS: 96.08 MiB / CPU 3.33% (daemon and test harness share this process; daemon bucket is the combined measurement)
- Whole-scenario PSS: 140.52 MiB / SwapPSS 0 MiB / CPU 3.33%
- Host /proc/net/dev delta: {"rxBytes":6035859,"txBytes":6027785}
- Two Sway sessions ready, no Computer Preview or expanded viewer.

### previewOnly

- Ran: true
- Latency: {"firstPreviewMs":{"samples":[30.39],"min":30.39,"p50":30.39,"p95":30.39,"max":30.39}}
- Sway infra PSS: 36.18 MiB / SwapPSS 0 MiB / CPU 0%
- WayVNC/projection PSS: 0 MiB / CPU 0%
- Apps+Agent PSS: 330.7 MiB / CPU 5%
- Daemon+harness PSS: 101.16 MiB / CPU 64.96% (daemon and test harness share this process; daemon bucket is the combined measurement)
- Whole-scenario PSS: 717 MiB / SwapPSS 0 MiB / CPU 69.96%
- Host /proc/net/dev delta: {"rxBytes":64328,"txBytes":9622}
- Compact preview PNG delivered on the control WebSocket; WayVNC stayed down.

### oneExpandedProjection

- Ran: true
- Latency: {"firstExpandedMs":{"samples":[102.99],"min":102.99,"p50":102.99,"p95":102.99,"max":102.99}}
- Sway infra PSS: 43.68 MiB / SwapPSS 0 MiB / CPU 0%
- WayVNC/projection PSS: 25.18 MiB / CPU 0%
- Apps+Agent PSS: 332.89 MiB / CPU 1.34%
- Daemon+harness PSS: 113.19 MiB / CPU 9.33% (daemon and test harness share this process; daemon bucket is the combined measurement)
- Whole-scenario PSS: 770.77 MiB / SwapPSS 0 MiB / CPU 13.34%
- Host /proc/net/dev delta: {"rxBytes":3286152,"txBytes":50121}
- Bot A negotiated bidirectional RFB, Bot B retained unviewed.

### backgroundWork

- Ran: true
- Sway infra PSS: 43.71 MiB / SwapPSS 0 MiB / CPU 0%
- WayVNC/projection PSS: 0 MiB / CPU 0%
- Apps+Agent PSS: 333.67 MiB / CPU 3.34%
- Daemon+harness PSS: 113.79 MiB / CPU 9.99% (daemon and test harness share this process; daemon bucket is the combined measurement)
- Whole-scenario PSS: 755.42 MiB / SwapPSS 0 MiB / CPU 17.33%
- Host /proc/net/dev delta: {"rxBytes":4886778,"txBytes":60983}
- Bot B received Agent input while both desktops stayed alive.

### repeatedSwitching

- Ran: true
- Latency: {"reconnectMs":{"samples":[30.21,30.23,30.19,30.2],"min":30.19,"p50":30.2,"p95":30.23,"max":30.23}}
- Sway infra PSS: 43.71 MiB / SwapPSS 0 MiB / CPU 8.11%
- WayVNC/projection PSS: 0 MiB / CPU 0%
- Apps+Agent PSS: 333.67 MiB / CPU 0%
- Daemon+harness PSS: 123.57 MiB / CPU 105.39% (daemon and test harness share this process; daemon bucket is the combined measurement)
- Whole-scenario PSS: 764.41 MiB / SwapPSS 0 MiB / CPU 113.5%
- Host /proc/net/dev delta: {"rxBytes":192607,"txBytes":184977}
- Four preview attach/detach cycles across the two Bots.

### severalRetainedOneSelected

- Ran: true
- Latency: {"inputToVisibleMs":{"samples":[103.59,204.92],"min":103.59,"p50":103.59,"p95":204.92,"max":204.92}}
- Sway infra PSS: 43.71 MiB / SwapPSS 0 MiB / CPU 0%
- WayVNC/projection PSS: 0 MiB / CPU 0%
- Apps+Agent PSS: 333.67 MiB / CPU 3.34%
- Daemon+harness PSS: 113.79 MiB / CPU 9.99% (daemon and test harness share this process; daemon bucket is the combined measurement)
- Whole-scenario PSS: 755.42 MiB / SwapPSS 0 MiB / CPU 17.33%
- Host /proc/net/dev delta: {"rxBytes":4886778,"txBytes":60983}
- Two retained Sway sessions; measurements taken while one had been expanded earlier.

### cleanup

- Ran: true
- Latency: {"cleanupMs":{"samples":[176.78,3146.81],"min":176.78,"p50":176.78,"p95":3146.81,"max":3146.81}}
- Delete/reprovision and final stop.

## Cited Fake / scripted proofs (not re-run here)

- Takeover, stale generation/epoch/sequence rejection, held-input release
  - tests/integration/screen-projection.test.ts, tests/integration/bot-screen-lifecycle.test.ts
  - Fake RFB / scripted Sway. Not re-run as fake-only ticket-09 proof.
- Bot A→B switch, shared WayVNC refcount, RFB-failed snapshot fallback, sibling isolation
  - tests/integration/bot-screen-sway-projection.test.ts
  - Scripted Sway + echo WayVNC. Ticket 09 re-proves the same seams on real Sway/WayVNC.
- Daemon restart reattach, invalid-tree reprovision, capacity reject, deletion vs Shared Workspace
  - tests/integration/bot-screen-lifecycle.test.ts, tests/integration/bot-screen-sway-runtime.test.ts
  - Scripted Sway binaries and persisted fake pids. Real deletion/reprovision is in this harness.
- Native window list/focus, observe, input authority, Unicode paste path
  - tests/integration/bot-screen-sway-control.test.ts
  - Fake i3-ipc tree. Live browser/terminal visibility is this harness.

## Limitations

- Daemon and test harness share one process; daemon cost is not a split.
- Host /proc/net/dev is whole-host interface counters, not WayVNC-unix attribution.
- RFB frame/drop accounting is message-byte presence on the view channel, not an H.264 encoder pipeline.
- Historical Cage/Xvnc numeric rows were not compared.
- Human-only: Original Omarchy top bar remains clickable and visually available during Bot desktop start, work, switching, failure, and cleanup
- Human-only: Existing Omarchy keyboard shortcuts continue to fire in the Host Session through the same lifecycle
- Human-only: Ordinary host focus and physical pointer/keyboard input stay independent of Bot-generated input
- Human-only: The user can switch Bots while using the host desktop and confirm selected pixels/input belong to the correct Bot
- Human-only: Sibling Bot screenshots or service existence do not prove host usability

## Remaining human-only Host Session checks

- Original Omarchy top bar remains clickable and visually available during Bot desktop start, work, switching, failure, and cleanup
- Existing Omarchy keyboard shortcuts continue to fire in the Host Session through the same lifecycle
- Ordinary host focus and physical pointer/keyboard input stay independent of Bot-generated input
- The user can switch Bots while using the host desktop and confirm selected pixels/input belong to the correct Bot
- Sibling Bot screenshots or service existence do not prove host usability

