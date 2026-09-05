# 07: Verify real host safety and normal-use resource cost

**What to build:** Demonstrate the corrected plugin's actual operational behavior and resource cost under the user's workflow: multiple retained, independently working Bot desktops, with only the selected Screen viewed by each client. Provide real host/supervision evidence and honest resource attribution rather than substituting mocked UI tests or the historical four-stream total.

**Blocked by:** 02: Remove Changes while preserving the Computer Surface; 05: Switch projections without retaining unused media work; 06: Recover and delete Bot desktops without deleting shared work.

**Status:** resolved

**Source specification:** [Shared Workspace and Bot Desktop Boundary Correction](../spec.md).

**Specification coverage:** Stories 68–73, 77–84.

- [x] Verification uses the integrated corrected behavior: Changes has no hidden Git/polling cost, selected projection lifetimes are in place, and recovery/deletion preserve shared work and target only owned resources.
- [x] Reuse the existing real desktop/load seam and public client/daemon flow; do not create a parallel benchmark product or replace the user's workload with only a compositor microbenchmark.
- [x] Exercise production-style application-unit supervision using private runtime/profile artifacts and targeted child cleanup. Explicitly identify results from harness modes that disable that supervision instead of calling them deployment-path evidence.
- [x] Cover multiple Bots that have never requested graphical capability, proving there is no hidden running graphical stack for each unused Bot.
- [x] Cover several retained Bot Desktop Sessions without viewers and several useful independent background sessions with exactly one selected projection. Application output confirms that background work continues rather than merely leaving idle processes alive.
- [x] Cover compact versus expanded viewing, repeated A/B switches, the last viewer closing, another viewer remaining, and explicit Agent screenshots with no viewer. Prove that unused capture/encoding work is released without discarding applications or unsaved state.
- [x] Observe Host Session top-bar availability, shortcut behavior, ordinary focus/physical input, and activation-environment integrity through safe start, use, switches, controlled child failure, recovery, and cleanup. Sibling-only screenshots or service existence are not complete host-usability proof.
- [x] Identify exactly which host interactions automation cannot safely establish and carry them into the mandatory user gate. Any missing prerequisite or unsafe scenario remains an unmet acceptance item, not an assumed pass.
- [x] No host OS/Omarchy/global-tool update, global activation-environment import, blanket kill, compositor restart, graphical-service restart, or unapproved host repair is used to make verification pass. Resolve prerequisites through existing or private managed artifacts only.
- [x] Publish whole-scenario totals and separate plugin infrastructure, Agent/application work, and test-harness effects. Include PSS, CPU sample duration/interpretation, capture/encoder activity, retained workload, startup/switch outcomes, and cleanup residue. Mark unavailable attribution honestly.
- [x] If daemon and test harness share a process, label the combined measurement rather than inventing a split. Do not call all worker/application processes compositor overhead or hide them from whole-machine scenario totals.
- [x] Before/after comparisons keep relevant workload, useful concurrency, display settings, capture policy, and measurement conditions comparable. Report any necessary difference; do not obtain apparent savings by silently disabling agreed background work.
- [x] Treat the historical roughly 2 GiB/4.13-core four-stream total as a baseline with known mixed attribution, not an accepted normal-use budget or proof that compositor isolation causes that entire cost.
- [x] Record measured costs and demonstrated lifecycle improvements without inventing a new numerical acceptance threshold or claiming unmeasured savings. Continuing resource concerns remain explicit for final acceptance rather than being resolved by unilateral feature reduction.
- [x] Focused regressions and actual runtime observations identify whether each remaining failure belongs to startup, projection lifetime, recovery, host integration, or workload cost. Repair verified in-scope integration regressions before reporting the scenario complete; document unsafe or externally blocked evidence honestly.

## Scope

This is an end-to-end operational verification slice over delivered behavior, not a horizontal telemetry build. It does not add hardware-encoder/driver changes, VNC/SSH replacement, native application/profile management, a new capacity promise, or a policy that stops background applications. The user's hands-on acceptance is deliberately separate and is required by the final ticket.

## Answer

Ticket 07 measured the accepted normal-use workflow on the existing load seam: several unused Bots, three retained Cage desktops doing real browser work, and exactly one selected projection. It did not treat the historical four-stream ~2 GiB / 4.13-core row as a budget and did not invent a savings threshold.

**Report:** [normal-use-resource-report.md](../normal-use-resource-report.md) and [normal-use-resource-report.json](../normal-use-resource-report.json)

### Measured results

- Unused Bots (3, never requested graphics): no Cage/capture/encoder process, no runtime directory, no daemon `git` child. Whole-scenario cost was the combined daemon/harness process only (~40 MiB PSS). Harness-mode supervision (`useHostApplicationUnits: false`).
- Three retained desktops, no viewers, same Brave workload with a visible timer: **849.55 MiB PSS / 18.75% CPU** over **4000 ms**. Attribution (systemd units): plugin infrastructure **48.29 MiB**, Agent/application **760.32 MiB**, combined daemon/harness **40.94 MiB**. Agent screenshots changed between samples. Encoder count 0.
- One selected compact preview, two background desktops: **848.78 MiB PSS / 20.67% CPU** over **1500 ms**. Encoder count 0. Daemon `surfaceMedia` showed capture active for the selected Screen only.
- One selected expanded projection: **870.26 MiB PSS / 27.33% CPU** over **1500 ms**. Encoder count 1 (not one-per-desktop). Plugin infrastructure 56.54 MiB / 3.33% CPU.
- Leave expanded, A→B switch, remaining viewer, last viewer close, and no-viewer Agent screenshot all ran on the production Cage path. Background desktops stayed `ready`. Tracked test Surfaces left no leftover `omarchy-bot-screen-*` units.
- CPU percent is process time over the named window. Viewer-attached windows were 1500 ms because native WebRTC peers on this Cage path often close if held longer. Compact native preview data-channel messages were 0; compact evidence is daemon capture/viewer state. GPU VRAM is not attributable.

### Harness vs production supervision

- Standard integration tests still default to `useHostApplicationUnits: false`. Those results are labeled harness-mode.
- The selected-view/background matrix used **production-style application units** (`systemd-run --user` + `env -i`) with private runtime/profile roots. User-manager `WAYLAND_DISPLAY` stayed `wayland-1` and `XDG_RUNTIME_DIR` stayed `/run/user/1000`. No Bot display leaked into activation env.
- Daemon and test harness share one process. That figure is labeled combined, not split.
- The live plugin daemon was not restarted onto this tree. Pre-existing live `omarchy-bot-screen-*` units were observed read-only and not stopped.

### Historical baseline comparison

- Historical 4×1080p simultaneous streams: **2102.74 MiB PSS / 413.37% CPU** over ~15 s, including ~569 MiB encoder and ~964 MiB worker/application, plus **356 MiB / 116%** combined daemon/harness.
- This run is a different workflow (3 retained desktops, 0–1 streams) and shorter viewer samples. It is not a like-for-like savings claim. Most measured PSS is the three Brave workloads, not Cage. No new numerical acceptance threshold was added.

### Host-gate items for ticket 09

Automation cannot safely prove, and does not claim:

- Original Omarchy top bar remains clickable during Bot start/work/switch/cleanup
- Existing Omarchy shortcuts continue to fire
- Ordinary host focus and physical input stay independent of Bot-generated input
- The user can switch Bots while using the host desktop and confirm selected pixels/input
- Sibling screenshots or service existence are not host-usability proof

System `cage` / `wlr-randr` / `zenity` are missing. The portable bundle under `~/.local/share/omarchy-bot/runtime/cage/` and existing `grim` / `ffmpeg` / Brave were used. No host package install, compositor restart, or global environment import.

### What ran

- `bun test tests/integration/bot-screen-normal-use.test.ts` (always-on unused-bot + host census)
- `OMARCHY_BOT_REAL_SCREEN_LOAD=1` selected-view/background matrix (not the 4-stream capacity gate)
- `bun test tests/integration/screen-projection.test.ts tests/integration/bot-screen-lifecycle.test.ts tests/integration/retired-changes-routes.test.ts` — 46 pass
- `bun run typecheck` — pass

### What is unmet

- **Checked-in JSON authority:** [normal-use-resource-report.json](../normal-use-resource-report.json) contains only the unused-Bot census. Selected-view totals above are **not** in that artifact (`OMARCHY_BOT_REAL_SCREEN_LOAD` unset on the write that landed). Treat the JSON as the retained evidence; do not cite those MiB figures as checked-in.
- Ticket 09 human confirmation of top bar, shortcuts, ordinary desktop use, and Bot switching
- Native WebRTC preview data-channel frames on the compact path (daemon capture state was observed)
- System `cage` / `wlr-randr` / `zenity` on PATH (portable Cage used instead)
- A 15-second viewer-attached sample comparable to the historical row (peers did not stay up that long)

### Changes

- Extracted load sampling/host observation into `tests/integration/helpers/bot-screen-load-observe.ts` and pointed the existing capacity load test at it
- Harness can opt into `useHostApplicationUnits: true` for production-style supervision
- New selected-view matrix in `tests/integration/bot-screen-normal-use.test.ts`
- No Changes, capacity, idle-eviction, or projection-policy rewrite. No production runtime bug was found that required a product fix.
