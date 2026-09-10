# Sway two-Bot conformance and cost report

Status: complete
Cutover: go
Generated: 2026-09-08T15:22:25.883Z

This is ticket 09 evidence. Historical Cage, Sway, and Xvnc rows are **not** used for numeric comparison: workload and accounting are not matched to those artifacts.

## Command

```
OMARCHY_BOT_REAL_SWAY=1 bun test tests/integration/bot-screen-sway-conformance.test.ts
```

## Environment

- kernel: Linux 7.1.9-arch1-2 x64
- gpu: ["01:00.0 VGA compatible controller [0300]: NVIDIA Corporation TU102 [GeForce RTX 2080 Ti] [10de:1e04] (rev a1)","0c:00.0 VGA compatible controller [0300]: Advanced Micro Devices, Inc. [AMD/ATI] Raphael [1002:164e] (rev c2)"]
- hostname: [redacted]
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

- [x] two-real-sway-sessions: both Screens ready in 128.38ms, 82.15ms
- [x] distinct-apps-and-shared-state: distinct pixels=true; shared markers=true; A windows=BOT-A-TERM|BOT-A; B windows=BOT-B-TERM|BOT-B; markers=/tmp/omarchy-bot-sway-home-E9ZMDK/screens/computer/config|/tmp/omarchy-bot-sway-home-E9ZMDK/r/computer/1788880947642|wayland-1 || /tmp/omarchy-bot-sway-home-E9ZMDK/screens/computer/config|/tmp/omarchy-bot-sway-home-E9ZMDK/r/computer/1788880947642|wayland-1
- [x] agent-without-viewer: observe/list/focus/click/scroll/chord passed; sibling title preserved under the shared seat; exact browser and terminal Unicode=你好, world
- [x] preview-no-wayvnc: preview sequence=1 bytes=20450; wayvnc processes=0
- [x] rfb-view-only-and-broker: RFB negotiated=true bytes=3686464; RFB mutation rejected=true; Broker mutated=true; titles=BOT-A click:1 -> BOT-A click:1 -> BOT-A click:2
- [x] multiple-viewers: second viewer negotiated=true; wayvnc processes=1; first viewer preserved=true
- [x] bot-switching: Bot B RFB negotiated=true; Bot A and Bot B screenshots stayed distinct
- [x] component-failure-fallback: projection failure=rfb-bridge-failed; snapshotFallback=true; desktop=ready; wayvncPid=2173180
- [x] real-browser-projection: actual noVNC painted Bot A and Broker-driven marker change; first paint 359.35ms, input-to-paint 100.21ms
- [x] background-and-unsaved: same window/generation and exact unsaved field retained; counter 17 -> 19
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
- Daemon+harness PSS: 98.4 MiB / CPU 1.99% (daemon and test harness share this process; daemon bucket is the combined measurement)
- Whole-scenario PSS: 98.4 MiB / SwapPSS 0 MiB / CPU 1.99%
- Host /proc/net/dev delta: {"rxBytes":255191,"txBytes":9279}
- Bots not yet created; daemon/harness only.

### retainedUnviewedDesktops

- Ran: true
- Latency: {"coldRequestToReadyMs":{"samples":[128.38,82.15],"min":82.15,"p50":82.15,"p95":128.38,"max":128.38}}
- Sway infra PSS: 1.21 MiB / SwapPSS 0 MiB / CPU 0%
- WayVNC/projection PSS: 0 MiB / CPU 0%
- Apps+Agent PSS: 13.75 MiB / CPU 0%
- Daemon+harness PSS: 104 MiB / CPU 3.33% (daemon and test harness share this process; daemon bucket is the combined measurement)
- Whole-scenario PSS: 118.96 MiB / SwapPSS 0 MiB / CPU 3.33%
- Host /proc/net/dev delta: {"rxBytes":263365,"txBytes":15257}
- Two Sway sessions ready, no Computer Preview or expanded viewer.

### previewOnly

- Ran: true
- Latency: {"firstPreviewMs":{"samples":[30.37],"min":30.37,"p50":30.37,"p95":30.37,"max":30.37}}
- Sway infra PSS: 1.27 MiB / SwapPSS 0 MiB / CPU 0%
- WayVNC/projection PSS: 0 MiB / CPU 0%
- Apps+Agent PSS: 13.81 MiB / CPU 0%
- Daemon+harness PSS: 114.82 MiB / CPU 14.99% (daemon and test harness share this process; daemon bucket is the combined measurement)
- Whole-scenario PSS: 129.9 MiB / SwapPSS 0 MiB / CPU 14.99%
- Host /proc/net/dev delta: {"rxBytes":168289,"txBytes":11327}
- Compact preview PNG delivered on the control WebSocket; WayVNC stayed down.

### oneExpandedProjection

- Ran: true
- Latency: {"firstExpandedMs":{"samples":[103.68],"min":103.68,"p50":103.68,"p95":103.68,"max":103.68}}
- Sway infra PSS: 1.27 MiB / SwapPSS 0 MiB / CPU 0%
- WayVNC/projection PSS: 25.21 MiB / CPU 0%
- Apps+Agent PSS: 13.83 MiB / CPU 0%
- Daemon+harness PSS: 121.25 MiB / CPU 3.33% (daemon and test harness share this process; daemon bucket is the combined measurement)
- Whole-scenario PSS: 161.56 MiB / SwapPSS 0 MiB / CPU 3.33%
- Host /proc/net/dev delta: {"rxBytes":9869497,"txBytes":90875}
- Bot A negotiated bidirectional RFB, Bot B retained unviewed.

### backgroundWork

- Ran: true
- Sway infra PSS: 1.27 MiB / SwapPSS 0 MiB / CPU 0%
- WayVNC/projection PSS: 0 MiB / CPU 0%
- Apps+Agent PSS: 13.86 MiB / CPU 0%
- Daemon+harness PSS: 122.71 MiB / CPU 3.33% (daemon and test harness share this process; daemon bucket is the combined measurement)
- Whole-scenario PSS: 137.84 MiB / SwapPSS 0 MiB / CPU 3.33%
- Host /proc/net/dev delta: {"rxBytes":2680565,"txBytes":44705}
- Bot B received Agent input while both desktops stayed alive.

### repeatedSwitching

- Ran: true
- Latency: {"reconnectMs":{"samples":[30.26,30.31,30.23,30.2],"min":30.2,"p50":30.23,"p95":30.31,"max":30.31}}
- Sway infra PSS: 1.27 MiB / SwapPSS 0 MiB / CPU 0%
- WayVNC/projection PSS: 0 MiB / CPU 0%
- Apps+Agent PSS: 13.86 MiB / CPU 0%
- Daemon+harness PSS: 131.74 MiB / CPU 40.05% (daemon and test harness share this process; daemon bucket is the combined measurement)
- Whole-scenario PSS: 146.87 MiB / SwapPSS 0 MiB / CPU 40.05%
- Host /proc/net/dev delta: {"rxBytes":148199,"txBytes":109344}
- Four preview attach/detach cycles across the two Bots.

### severalRetainedOneSelected

- Ran: true
- Latency: {"inputToVisibleMs":{"samples":[230.91,211.58],"min":211.58,"p50":211.58,"p95":230.91,"max":230.91}}
- Sway infra PSS: 1.27 MiB / SwapPSS 0 MiB / CPU 0%
- WayVNC/projection PSS: 0 MiB / CPU 0%
- Apps+Agent PSS: 13.86 MiB / CPU 0%
- Daemon+harness PSS: 122.71 MiB / CPU 3.33% (daemon and test harness share this process; daemon bucket is the combined measurement)
- Whole-scenario PSS: 137.84 MiB / SwapPSS 0 MiB / CPU 3.33%
- Host /proc/net/dev delta: {"rxBytes":2680565,"txBytes":44705}
- Two retained Sway sessions; measurements taken while one had been expanded earlier.

### cleanup

- Ran: true
- Latency: {"cleanupMs":{"samples":[137.77,3165.47],"min":137.77,"p50":137.77,"p95":3165.47,"max":3165.47}}
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

