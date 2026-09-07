# 02: Start one private Sway Bot Desktop Session on demand

**Parent:** [#8](https://github.com/XMethues/omarchy-bot/issues/8)

**What to build:** Make a first graphical action or opening the Computer Surface start one independently routed, pure-headless Sway Bot Desktop Session with a neutral desktop, direct capture, private input, and a bound computer worker. Ordinary Bot and Thread navigation remains process-free.

**Blocked by:** 01: Make Screen Projection transport replaceable without changing Cage behavior.

**Status:** resolved

- [x] Creating, selecting, or opening a Thread for a Bot does not start a desktop runtime.
- [x] A first graphical action and a first Computer Surface request each provision Sway and expose truthful connecting, ready, and failure states.
- [x] Concurrent first-use requests for one Bot converge on one Bot Desktop Session and runtime generation.
- [x] Two different Bots receive collision-free private runtime, Wayland, Sway IPC, D-Bus, configuration, state, cache, and application endpoints.
- [x] Sway uses a pure-headless output with the requested geometry and a persistent neutral Bot Desktop; it does not load a bar, shell, host autostart, user compositor configuration, or physical input devices.
- [x] Direct capture, the private input helper, the neutral desktop, and the Surface-bound computer worker must all be ready before the Bot Screen reports ready.
- [x] Native Wayland applications work and the session has an explicit private XWayland compatibility path for applications that require X11.
- [x] Any startup failure removes its partial process/socket tree and leaves sibling Bot Screens and the Host Session untouched.
- [x] This ticket uses injected or developer-provided runtime binaries; production artifact acquisition remains ticket 08.

## Answer

Added `SwayBotScreenRuntimeAdapter` in `apps/daemon/src/modules/computer/swayBotScreenRuntime.ts`. It implements `BotScreenRuntimeAdapter` with Cage's lifecycle shape: private 0700 runtime/profile trees, pure-headless Sway (`WLR_BACKENDS=headless`, one output, no libinput devices, pixman), a plugin-owned Sway config (`xwayland enable`, no bar/shell/host include), private `WAYLAND_DISPLAY` + `SWAYSOCK` + D-Bus address, `wlr-randr` geometry, separately supervised Bot Desktop, grim + capture helper, private virtual input, and a Surface-bound computer worker. Ready is returned only after all of those succeed. `acquireExpandedView` throws; WayVNC is ticket 05. `act` still delegates non-screenshot actions to the worker (ticket 03 will intercept window/input). `reconcile` is conservative and does not reattach (ticket 07). Production `main.ts` still wires Cage only; there is no compositor selector or portable Sway supply (ticket 08).

Shared Wayland input/capture/env helpers moved to `botScreenWaylandHelpers.ts` and Cage now imports them without behavior change.

Tests: `tests/integration/bot-screen-sway-runtime.test.ts` (readiness/isolation, capture/input/unsupported expanded view, failure cleanup/outcome/stop/destroy) plus three Sway-injected public cases in `bot-screen-lifecycle.test.ts` via `tests/integration/helpers/swayBotScreen.ts`. Fake binaries only; no host Sway launch.
