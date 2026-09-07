# Normal-use resource and host-safety report

Status: complete
Generated: 2026-09-07T02:01:10.889Z

This is the selected-view / background-work / unused-Bot matrix for ticket 07.
The historical four-stream ~2 GiB / 4.13-core row is a mixed-attribution baseline, not a budget.

## Harness vs production supervision

The standard integration harness defaults to `useHostApplicationUnits: false` (direct children).
Those results are harness-mode. Production-style units are used only when the user systemd manager is present and the real-load matrix opts in.
Daemon and test harness share one process; that PSS/CPU figure is a combined measurement.

## Historical baseline comparison

- Source: `.scratch/bot-screen-media-desktop/capacity-report.json`
- 4×1080p simultaneous streams: 2102.74 MiB PSS, 413.37% CPU over 15050.5 ms
- Combined daemon/harness in that row: 356.26 MiB PSS / 116.28% CPU
- Published mix: compositor ~193 MiB, encoder ~569 MiB, worker/application ~964 MiB
- That row is not compositor-only cost and is not an accepted normal-use budget.

## Scenarios

### unusedBotsNeverGraphics

- Ran: true
- Supervision: harness-mode-direct-children
- Sample duration: 500.14 ms
- Whole-scenario PSS: 263.65 MiB, CPU 6%
- Combined daemon/harness: 263.65 MiB, CPU 6%
- Plugin infrastructure: 0 MiB PSS / 0% CPU (none)
- Agent/application: 0 MiB PSS / 0% CPU
- Three Bots created and listed; no graphical action or Computer view.
- No Sway, capture, or encoder process and no runtime directory per unused Bot.
- No daemon git child (Changes polling is gone).
- Whole-scenario total is the combined daemon/harness process only.
- Standard integration harness disables host application units. Results are harness-mode evidence, not deployment-path supervision evidence.

## Measurement caveats

- CPU percent is process time over the named sample window, not a 15-second historical-row equivalent.
- Viewer-attached windows were shortened to 1500 ms because native WebRTC peers on this Sway path often close if held longer. No-viewer windows used the configured duration.
- Compact preview evidence is daemon `surfaceMedia` capture/viewer state. Native preview data-channel messages were not required.
- GPU VRAM is not attributable on this stack.

## Unmet

- OMARCHY_BOT_REAL_SCREEN_LOAD was not set; selected-view / background retained-desktop resource windows were not measured in this process

## Host-gate items for ticket 09

- Original Omarchy top bar remains clickable and visually available during Bot desktop start, work, switching, failure, and cleanup
- Existing Omarchy keyboard shortcuts continue to fire in the Host Session through the same lifecycle
- Ordinary host focus and physical pointer/keyboard input stay independent of Bot-generated input
- The user can switch Bots while using the host desktop and confirm selected pixels/input belong to the correct Bot
- Sibling Bot screenshots or service existence do not prove host usability

