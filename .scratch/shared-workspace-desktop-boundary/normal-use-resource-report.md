# Normal-use resource and host-safety report

Status: complete for unused-Bot census only
Generated: 2026-09-05T16:27:47.586Z

Authority is the sibling JSON. An earlier markdown draft described selected-view totals that are **not** in this artifact. Do not cite ~850 MiB selected-view figures from that draft.

`OMARCHY_BOT_REAL_SCREEN_LOAD` was unset on the checked-in run. Selected-view / background retained-desktop resource windows were not measured here.

The historical four-stream ~2 GiB / 4.13-core row remains a mixed-attribution baseline, not a budget.

## Harness vs production supervision

The unused-Bot census used the standard integration harness (`useHostApplicationUnits: false`). Those results are harness-mode, not deployment-path supervision evidence.

Daemon and test harness share one process; unused-Bot PSS/CPU is a combined measurement.

## Historical baseline comparison

- Source: `.scratch/bot-screen-media-desktop/capacity-report.json`
- 4×1080p simultaneous streams: 2102.74 MiB PSS, 413.37% CPU over 15050.5 ms
- Combined daemon/harness in that row: 356.26 MiB PSS / 116.28% CPU
- Published mix: compositor ~193 MiB, encoder ~569 MiB, worker/application ~964 MiB

## Scenarios

### unusedBotsNeverGraphics

- Ran: true
- Supervision: harness-mode-direct-children
- Sample duration: 502.98 ms
- Whole-scenario / combined daemon+harness: 242.29 MiB PSS, 19.88% CPU
- Plugin infrastructure: 0
- Agent/application: 0
- Three Bots created and listed; no graphical action or Computer view.
- No Cage, capture, or encoder process and no runtime directory per unused Bot.
- No daemon git child (Changes polling is gone).

### Selected-view / retained-desktop matrix

- Ran: false
- Unmet: `OMARCHY_BOT_REAL_SCREEN_LOAD` was not set in the process that wrote the JSON.

## Host-safety observations (read-only)

- User-manager env stayed Host Session (`WAYLAND_DISPLAY=wayland-1`, `XDG_RUNTIME_DIR=/run/user/1000`).
- No Bot display leak into activation env.
- Visible `omarchy-bot-screen-*` units at start belonged to the already-running plugin and were not stopped.
- The live plugin daemon was not restarted onto this tree.
- Top bar, shortcuts, and physical input remain ticket 09.

## Unmet

- Selected-view / background retained-desktop resource windows
- 15 s viewer-attached sample comparable to the historical row
- Ticket 09 human confirmation
