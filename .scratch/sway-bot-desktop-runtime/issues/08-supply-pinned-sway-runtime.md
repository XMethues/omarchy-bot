# 08: Supply a pinned Sway runtime on stock Omarchy

**Parent:** [#8](https://github.com/XMethues/omarchy-bot/issues/8)

**What to build:** Deliver the complete selected graphical runtime as an application-owned, versioned, checksum-verified artifact that can be acquired lazily on stock Omarchy without package-manager changes, compilation, or Host Session restart.

**Blocked by:** 03: Control Sway through native IPC and private input; 05: Open Web Control through view-only WayVNC.

**Status:** resolved

- [x] The published artifact contains pinned compatible Sway, Sway IPC tooling, WayVNC, the embedded browser RFB dependency, private helpers, and every non-host runtime library they require.
- [x] The artifact integrates with the repository's existing first-enable pinned-runtime delivery strategy instead of creating a second installer.
- [x] A user who never requests graphical capability does not download or start the desktop runtime.
- [x] First graphical demand downloads, verifies, extracts, and atomically publishes one complete version under application-owned state.
- [x] Concurrent first demands converge on one verified publication.
- [x] Interrupted downloads, checksum mismatch, incomplete extraction, unsupported architecture, missing host prerequisite, and version replacement fail honestly and leave no runnable partial artifact.
- [x] A verified cached version is safely reused.
- [x] Acquisition requires no pacman, sudo, compiler, Wayland development headers, global environment change, or graphical-session restart.
- [x] Supplying or updating the artifact cannot disturb an already running production Bot Desktop Session.
- [x] Runtime-supply tests use temporary roots and fake downloads and cover atomicity, reuse, corruption, concurrency, and cleanup.
- [x] Coordination requirements with GitHub issue #6 are documented without silently redefining that issue's broader plugin packaging scope.

## Answer

`PortableSwayRuntimeSupply` is the lazy Cage→Sway compositor slot. `ensure()` is the only download trigger. Production `main.ts` still wires Cage, so a user who never starts a Sway adapter never downloads this pack.

**Pack** (`SWAY_RUNTIME_RELEASE` = `sway-1.12-wayvnc-0.10.1-wlroots-0.20.2-x86_64`):
- sway 1:1.12-4 (`sway` + `swaymsg`)
- wayvnc 0.10.1-1, neatvnc 1.0.1-2, aml 1.0.0-1
- wlroots0.20 0.20.2-1, libliftoff 0.5.0-1, wlr-randr 0.5.0-1
- wrappers at `bin/sway`, `bin/swaymsg`, `bin/wayvnc`, `bin/wlr-randr` that set `LD_LIBRARY_PATH` to the bundle `usr/lib`

HTTPS + SHA-256, staging dir, atomic `renameSync`, `.omarchy-bot-runtime` ready marker, in-process `#inFlight` coalescing, linux/x64 only. Failed staging is deleted. Cached ready version is reused. Publish races reuse the winner. `ensure()` writes only under `rootDir` and never touches Bot Desktop Session trees.

`resolveSwayRuntimeBinaries` matches the Cage resolver for later cutover. Config exposes unused `botScreenSwayRuntimeSupplyDir` (`dataDir/runtime/sway`).

**#6 coordination:** #6 owns first-enable (`omarchy-bot-runtime-<sha>-x86_64.tar.zst`: web dist, C helpers, node_modules) and keeps compositor downloads lazy. This ticket fills that lazy slot. It is not a second installer and does not change #6's success criteria. `@novnc/novnc@1.6.0` stays in the web dist; capture/input/bot-desktop helpers stay in the plugin tarball; grim stays a host Omarchy app.

**Files:** `apps/daemon/src/modules/computer/swayRuntimeSupply.ts`, `tests/integration/bot-screen-sway-runtime-supply.test.ts`, unused `botScreenSwayRuntimeSupplyDir` on config, config test assertion. No `main.ts`, `swayBotScreenRuntime.ts`, or `screenProjection.ts` edits.

**Tests:**
- `selects the app-owned Sway fallback only when the system set is incomplete`
- `keeps an unavailable explicit Sway override authoritative`
- `rejects an archive integrity failure and removes its private staging tree`
- `shares one provision across concurrent callers and atomically publishes launch wrappers`
- `reuses a verified cached Sway runtime without fetching again`
- `rejects an incomplete extract and leaves no ready destination`
- `rejects an unsupported architecture before downloading`
- `ensure does not create or touch a running Bot Desktop Session directory`

**Results:** sway-supply 8, cage-supply 4, config 4, `bun run typecheck`. All pass.

**Leftover:** not wired into the Sway adapter or production `main.ts` (ticket 10). Default package pins were hashed over HTTPS from archive.archlinux.org; tests inject fixtures and do not hit the network.

## Comments

#6 owns first-enable plugin packaging. This ticket does not amend that issue. The compositor pack remains lazy and out of enable, same policy Cage used.
