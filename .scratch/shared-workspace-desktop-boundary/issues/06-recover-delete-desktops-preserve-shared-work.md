# 06: Recover and delete Bot desktops without deleting shared work

**What to build:** Failure, restart, retry, and deletion act only on the owning Bot's desktop runtime. The user can recover a failed Screen or delete a Bot without losing shared files, erasing Agent-owned Native Sessions, replaying stale input, or interrupting sibling Bots.

**Blocked by:** 01: Route Bot work to the Shared Workspace; 04: Run independent Bot Desktop Sessions on demand.

**Status:** resolved

**Source specification:** [Shared Workspace and Bot Desktop Boundary Correction](../spec.md).

**Specification coverage:** Stories 23, 24, 43, 46–48, 50, 61–66, 73–76, 83, 89.

- [x] Infrastructure failures remain Screen-scoped and distinguishable from application exit or launch failure. A healthy sibling remains usable through the affected Screen's failure and retry.
- [x] A valid supervised session is reconciled on daemon recovery where the existing adapter supports it; invalid owned runtime is cleaned up and reprovisioned honestly at a fresh generation rather than treated as ready.
- [x] Reprovision invalidates obsolete geometry, streams, queued actions, controller authority, and worker bindings. Old input cannot target the new desktop and late media cannot relabel another Bot's Screen.
- [x] Human Takeover remains scoped, releases held input when appropriate, and is not silently completed by recovery or navigation. A native pending tool that cannot survive a restart is failed honestly rather than reconstructed with fabricated continuation.
- [x] Explicit Bot deletion stops the Bot's active work and closes its projections before removing its owned desktop/runtime identity. View disconnect alone is not treated as Bot deletion.
- [x] Deletion and failure cleanup target verified plugin-owned child groups, transient application units, sockets, runtime state, and local product relationships only. They do not stop host graphical targets, unrelated processes, or sibling desktops.
- [x] Shared Workspace sentinels, explicit user work directories, and Agent-owned Native Sessions survive Bot deletion and daemon recovery. Application-internal data is not migrated, synchronized, or erased as a desktop-policy change.
- [x] Existing data ownership is respected when evaluating old retained profile directories: no inference from the old per-Bot profile requirement authorizes deleting arbitrary application state. Any necessary handling is evidence-backed and preserves user data.
- [x] Application closure leaves its healthy neutral Bot Desktop ready. Recovery does not introduce an idle-eviction policy that discards applications or unsaved work.
- [x] Capacity rejection and recovery retain existing admission protections without a partial runtime, new capacity promise, or disturbance of admitted sibling Screens.
- [x] Repeated provision/recovery/deletion cycles use fresh runtime facts and leave no owned process, socket, stream, authority, or runtime-directory residue after completed cleanup.
- [x] Exercise the public deletion/retry/recovery workflow and existing lifecycle/runtime seam with temporary homes and scripted fatal outcomes for deterministic regressions. Extend real private-runtime verification for the production cleanup path; fake adapter success alone is not host-safety evidence.
- [x] Verify shared-file survival, explicit-directory preservation, native-data preservation, unaffected sibling operation, stale-input rejection, application-vs-infrastructure failure, and complete targeted cleanup together through meaningful scenarios.
- [x] Record any unsupported restart continuation or unsafe/missing host prerequisite as an unmet condition. Do not repair the host environment, update system packages, restart graphical services, or claim an Agent permission sandbox.

## Scope

The blockers supply the real Shared Workspace behavior and independent on-demand sessions, so data-preservation and runtime lifecycle outcomes can be verified together. This ticket does not require the viewer-resource optimization to be complete: deletion/failure teardown already has its own public lifecycle. Coordinate overlapping runtime/projection mutations with the projection ticket if implemented concurrently, and preserve both contracts in final integration.

## Answer

Failure, restart, retry, and explicit Bot deletion stay on the owning Bot's desktop runtime. Shared Workspace files, explicit Thread cwd directories, leftover `legacy-profiles` sentinels, and Agent-owned Native Sessions survive both daemon recovery and public `DELETE /api/bots/:id`. Viewer `closeSurface` is not deletion and does not evict a ready desktop. An in-flight computer action and Takeover fail honestly on infrastructure death or daemon restart rather than completing or reconstructing continuation. Stale generation input is rejected after invalid recover/reprovision. Siblings stay usable.

Most of that contract was already on the public lifecycle/deletion seam. The production Cage adapter gap was restart/deletion after `detach()`: `reconcile`/`destroy` stopped user-systemd units (often disabled in the harness) and removed directories, but did not stop the adapter-owned child processes. The adapter now tracks ready runtimes and stops those children on start/reconcile/destroy, then continues to target only `omarchy-bot-screen-<surface>-*` units, the Surface runtime tree, and (on explicit delete) the plugin-owned Screen profile directory. No old per-Bot application-profile locations are scanned or deleted.

**Shared-file / native-data evidence**

- Temp-HOME Shared Workspace sentinel `survive-recovery.txt` remains after recover + delete.
- Explicit Thread cwd sentinel remains; resume still uses that cwd.
- Native Session id from `session.open` is the same on `session.resume` after recover, and the Agent can still `session.resume` that id after Bot delete.
- Sibling Bot continues in the same Shared Workspace after the deleted Bot is gone.
- `~/.omarchy-bot/legacy-profiles/keep-me.txt` is not deleted. Plugin product db remains. `~/.omarchy-bot/memory/` is still not created.

**Validation**

- `bun run typecheck` — passed
- `bun test tests/integration/bot-screen-lifecycle.test.ts tests/integration/permanent-deletion.test.ts tests/integration/shared-workspace.test.ts tests/integration/bot-screen-cage-runtime.test.ts` — 46 pass, including viewer-close ≠ deletion, honest pending-action failure, stale input after invalid recover, scripted Cage public delete/recover residue, shared/explicit/native survival, existing Native Session survival probe, and the production-style `systemctl --user` Surface-only unit stop

**Unmet real-cleanup / host prerequisites**

- Standard harness still sets `useHostApplicationUnits: false`. The new scripted-Cage public DELETE/recover test exercises the production adapter cleanup code with real child processes and private runtime/profile roots, not the live user-manager path. The existing cage-runtime unit test still proves `systemctl --user` targeting for a nonexistent test Surface when a user systemd manager is present.
- System `cage` / `wlr-randr` are not on PATH. `grim` is. `zenity` is missing, so `OMARCHY_BOT_REAL_CAGE_SMOKE=1` was not run. The app-owned portable bundle under `~/.local/share/omarchy-bot/runtime/cage/` was not started on the live Host Session.
- No host package install, compositor/bar/session restart, or blanket kill was performed.
- Fake-adapter Takeover-on-daemon-restart honesty remains in `tests/integration/agent-computer-tool.test.ts` (`daemon restart fails a held Takeover turn instead of pretending to resume it`). Cage cannot reconnect a valid supervised session (`reconcile` always cleans and returns undefined); that is honest reprovision, not fabricated continuation.
- This is not an Agent permission sandbox. Mandatory human confirmation of top bar, shortcuts, and Bot switching remains later.
