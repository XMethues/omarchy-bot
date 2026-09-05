# 03: Restore host-safe single-Bot desktop startup

**What to build:** Opening one Bot's Computer Surface starts a real, correctly targeted lightweight desktop and produces a usable projection, rather than the reported “Screen didn’t load” / “Couldn’t start the Bot Screen” failure. Startup, failure handling, retry, and targeted cleanup preserve the original Omarchy Host Session.

**Blocked by:** None (can start immediately).

**Status:** resolved

**Source specification:** [Shared Workspace and Bot Desktop Boundary Correction](../spec.md).

**Specification coverage:** Stories 41, 44, 47–49, 67–73, 76.

- [x] Treat the user's startup failure and prior top-bar/shortcut disruption as observed failures. Inspect existing evidence first; do not rerun a dangerous host interaction merely to confirm the report or assume that both failures have the same cause.
- [x] Establish and record a safe, tight, red-capable scenario at the actual affected startup/projection/supervision seam before selecting a source fix. Minimize the failure and identify its responsible stage; an unrelated mock failure is not a reproduction of the reported problem.
- [x] Repair the actual responsible module, preserving pure-headless Cage and the existing public desktop/projection contract. Changing the message, disabling interactive desktop use, or presenting a snapshot as interactive control does not satisfy the repair.
- [x] A real user-facing desktop request reaches verified compositor/application-surface readiness and usable capture/projection. Evidence distinguishes real runtime behavior from scripted workers and intercepted browser responses.
- [x] The Bot runtime uses private display/runtime endpoints, a lightweight application surface, and explicitly targeted capture/input. It does not start a full Omarchy/UWSM session, shell/bar stack, or host autostart configuration.
- [x] Application launch and input target the Bot display, not the Host Session. Browser choice, profile/Cookie/login policy, and application-internal concurrency are not redesigned to solve infrastructure startup.
- [x] Child environments do not overwrite global user-manager or D-Bus activation state. Supervision uses verified plugin-owned child groups or transient application units; cleanup never stops broad host targets or unrelated processes.
- [x] Failed startup reports truthful, useful state with bounded, redacted diagnostics and an appropriate retry action. Retry clears stale runtime facts, targets only the affected Bot, and leaves no partial orphan runtime.
- [x] A regression covers the real failure pattern at the highest existing seam that can reach it, and the original safe feedback loop passes after the fix. A missing adequate seam or prerequisite is reported honestly, not hidden by a passing shallow fixture.
- [x] Real verification includes the production-style supervision path rather than relying exclusively on the harness mode that disables host application units. It uses private artifacts and targeted teardown.
- [x] Record safe observations of the Host Session through start, use, failure, retry, and cleanup. Automated checks do not claim complete top-bar/shortcut usability when they only inspect sibling pixels or service existence; remaining direct interaction evidence is carried into the mandatory user gate.
- [x] Missing prerequisites are resolved only with existing binaries, repository-managed dependencies, or private portable artifacts. No host package/Omarchy/global-tool update, host environment repair, compositor restart, or graphical-service restart is authorized. If a safe scenario cannot run, record the precise unmet prerequisite instead of treating it as a pass.
- [x] The result states the evidence-backed startup cause and any separate host-disruption findings or unresolved cause. It makes no claim that private socket routing is an Agent system-permission sandbox.

## Scope

This is one complete startup-to-viewing slice, not a wholesale runtime rewrite or a global performance project. Preserve valid existing behavior and change only source justified by diagnosis. Multi-Bot activation, viewer-driven resource release, broader recovery, and final host/resource acceptance follow in dependent tickets; do not require them to establish a working single-Bot path.

## Answer

The client strings “Screen didn’t load” / “Couldn’t start the Bot Screen” are the Computer Surface / projection-offer fallback when HTTP signaling fails or hides the real stage. They are not themselves the defect.

**Startup cause (evidence-backed):** two cooperating faults in the production Cage + application-unit path, not a missing compositor and not a WebRTC wording bug.

1. **Transient output configuration.** After Cage creates its private `wayland-0` socket, `wlr-randr` was invoked once. A not-ready compositor failed that call, `adapter.start()` aborted, the manager advanced the generation, and the next offer retried. Journal evidence on the live plugin-owned Surface showed compositor-only flashes (for example generation 162 started and was stopped in the same second) and generation counts above 160. A red Cage-runtime test that makes `wlr-randr` fail once, then succeed, reproduced this stage. The adapter now retries output configuration while Cage is still alive.
2. **Cleanup treated as fatal infrastructure failure.** Projection teardown calls `releaseInput`. That path went through `#invoke`, so a release RPC error destroyed the ready desktop and forced another generation. Live units were explicitly stopped after capture had already started. A red lifecycle test now keeps the Screen ready and its sibling usable when release throws. Snapshot `capture()` is no longer routed through `#invoke` either; stream capture already was not.
3. **Swallowed stage.** `last_failure` was stored (240-character redacted manager text) but `/api/computer/state` always said “Screen unavailable.” and a failed projection offer said “Bot Screen is unavailable.” The offer HTTP then looked like the generic client fallback. Public state and projection 503 now return the stored stage; the Computer Surface shows that `activity` on Retry.

**Seam used:** public computer/projection HTTP (`computer.test.ts` missing-Cage + offer), Bot Screen manager/lifecycle (`bot-screen-lifecycle.test.ts`), Cage adapter including one production-style `systemctl --user` stop of a nonexistent test Surface (`bot-screen-cage-runtime.test.ts`), plus one private-runtime real Cage start (portable app-owned Cage, no host application units) that reached compositor/desktop/capture/input readiness, returned a PNG snapshot and a 1280×720 frame, and deleted its runtime/profile. The standard harness still sets `useHostApplicationUnits: false`; that path was not used as the sole supervision evidence.

**Host-safety observations (not a top-bar/shortcut pass):** user-manager environment remained the Host Session (`WAYLAND_DISPLAY=wayland-1`, `XDG_RUNTIME_DIR=/run/user/1000`, `XDG_CURRENT_DESKTOP=Hyprland`). Child units use `env -i` and a private `XDG_RUNTIME_DIR`. Failed-start cleanup listed no leftover `omarchy-bot-screen-<test-surface>-*` units. Graphical-session and Hyprland units were active in read-only checks. Automated checks do **not** claim original top-bar or shortcut usability.

**Separate / unresolved host-disruption cause:** prior top-bar/shortcut breakage is accepted as a historical failure. It was **not** shown to share the startup cause. Current user-manager environment has no Bot display/runtime leak. This ticket does not treat private socket routing as an Agent permission sandbox.

**Human-gate / unmet prerequisites:**
- Two-Cage smoke (`OMARCHY_BOT_REAL_CAGE_SMOKE=1`) was not run: `zenity` is missing; the existing smoke also disables host application units.
- System `cage` / `wlr-randr` are absent from PATH; the app-owned portable bundle under `~/.local/share/omarchy-bot/runtime/cage/` was used instead. No host package install was performed.
- The already-running plugin daemon was not restarted or pointed at this tree; its live Surface continued its own generation cycle and was not used as a fix loop.
- Mandatory user confirmation of top bar, shortcuts, ordinary desktop use, and Bot switching remains for later acceptance tickets.
