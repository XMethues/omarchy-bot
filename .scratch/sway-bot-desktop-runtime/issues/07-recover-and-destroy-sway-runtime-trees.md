# 07: Recover and destroy Sway runtime trees safely

**Parent:** [#8](https://github.com/XMethues/omarchy-bot/issues/8)

**What to build:** Make Sway Bot Desktop Sessions recoverable and safely destructible: reconcile a fully valid supervised session after daemon restart, reject and remove partial state, isolate component failures, and clean every owned resource during deletion or shutdown.

**Blocked by:** 06: Handle multiple viewers, Bot switching, and projection failures.

**Status:** resolved

- [x] Daemon restart reattaches a fully valid supervised Sway session without changing its runtime generation or losing live application state.
- [x] Reconciliation verifies compositor ownership, private Wayland and Sway IPC sockets, output geometry, neutral desktop, direct capture, input helper, and matching computer worker before reattachment.
- [x] An invalid or partial recovered tree is fully removed before subsequent demand provisions a fresh generation.
- [x] Unexpected Sway, neutral-desktop, input-helper, or computer-worker exit fails only its Bot Screen; ordinary application exit does not.
- [x] Unexpected WayVNC or RFB bridge exit fails only projection and does not invoke Bot Screen cleanup.
- [x] Capacity rejection occurs before provisioning and leaves no process, socket, state directory, bridge, or viewer artifact.
- [x] Retry invalidates queued input and stale projection generations before creating a new runtime.
- [x] Permanent Bot deletion closes projections, stops every owned child, removes plugin-owned runtime/profile state, then removes Screen persistence while preserving Shared Workspace files and Native Sessions.
- [x] Plugin shutdown and explicit destructive reset target only verified plugin-owned process groups or application units.
- [x] Failure, cleanup, and sibling-survival behavior is covered through the existing lifecycle seam and public daemon behavior.

## Answer

`SwayBotScreenRuntimeAdapter.reconcile` no longer tears the tree down. `BotScreenManager.recover` is still the only recovery path.

**Same-adapter restart** (`screens.detach()` + `disconnectForRestart` + reused fixture adapter): if `#sessions` still has this Surface+generation, reconcile verifies private `wayland-*` and `SWAYSOCK` sockets, compositor/desktop liveness, grim capture at the provisioned geometry, and live input/worker handles. Helpers that have died are restarted against the same private env; Sway and the Bot Desktop are not. The same generation is returned and `start()` is not called.

**Fresh-adapter / process restart:** `start()` writes `session.json` under the generation dir (wayland name, swaysock basename, output name, compositor/desktop pids — no host paths or secrets). If `#runtimes` is empty, reconcile reads that file, verifies sockets + pids + capture + profile dirs, spawns a new input helper and computer worker, and `#bindRuntime` reconstructs a `BotScreenRuntime` without a second Sway/desktop.

**Invalid tree:** missing socket, dead compositor/desktop, capture failure, or helper restart failure → stop owned children (handles or persisted pids), `ApplicationUnits.stop` for that Surface/generation, `rmSync` the Surface runtime tree, return `undefined`. Manager then `start()`s at generation+1. Failed reconcile does **not** delete the Surface profile; only `destroy` does.

**Scoped failures:** WayVNC/RFB exit still fails only the projection lease (`stop` count 0). Desktop/Sway/input/worker exit remains Surface-scoped. Capacity still rejects in the manager before `adapter.start`.

**Files:** `swayBotScreenRuntime.ts`, `botScreenWaylandHelpers.ts` (`processAlive`, `terminatePid`, input `running`), `tests/integration/bot-screen-lifecycle.test.ts`, `tests/integration/bot-screen-sway-runtime.test.ts`. No `botScreenManager.ts` recover-path change. No ticket 08/09/10 work.

**New Sway tests:**
- `daemon restart reattaches a valid Sway session without changing its generation` — ready at generation 1, `starts` still 1, window id `10`, snapshot works
- `daemon restart removes a broken Sway tree and reprovisions a fresh generation` — deleted wayland socket → generation 2, gen-1 dir gone, sibling stays generation 1
- `capacity rejection leaves no Sway runtime directory or start`
- `deleting a Sway Bot removes runtime and profile while keeping Shared Workspace files`
- `WayVNC crash does not stop the Sway runtime`
- `a desktop exit fails only that Sway Screen and leaves the sibling runtime`
- `a fresh adapter reattaches a persisted live Sway tree without spawning a second compositor`

**Cited Fake proofs (unchanged):**
- Takeover / stale input after recover: `recovery of an invalid runtime uses a fresh generation and rejects stale input`; `reprovision invalidates queued input, controller authority, geometry, streams, and worker generation`
- Capacity: `rejects a Bot Screen before provisioning when measured capacity is full`
- Deletion vs shared files: `closing a viewer is not Bot deletion and does not evict the desktop or shared files`
- Sibling isolation: `application exit stays ready while Desktop, helper, worker, and compositor failures remain Surface-scoped`

**Results (all pass) + `bun run typecheck`:**
- `tests/integration/bot-screen-lifecycle.test.ts` — 38 pass
- `tests/integration/bot-screen-sway-runtime.test.ts` — 7 pass
- `tests/integration/bot-screen-sway-control.test.ts` — 9 pass
- `tests/integration/bot-screen-sway-projection.test.ts` — 13 pass

**Leftover risk:** public restart tests reuse the same adapter instance, so `#sessions` still has Bun process handles. Fresh-adapter reattach is proven with fake binaries + persisted pids, not a real systemd user-manager reattach after the daemon process itself exits. Production still wires Cage until ticket 10. Ticket 09 conformance/cost is untouched.
