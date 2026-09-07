# 04: Retain live Sway state when viewers leave

**Parent:** [#8](https://github.com/XMethues/omarchy-bot/issues/8)

**What to build:** Decouple Computer Surface lifetime from Bot Desktop Session lifetime so closing or switching the view releases projection work while the same Sway session, applications, unsaved fields, window state, and background progress remain live for reconnect and Agent work.

**Blocked by:** 03: Control Sway through native IPC and private input.

**Status:** resolved

- [x] Closing the Computer Surface or switching Bots revokes that viewer's input and releases its capture/transport work without stopping Sway, applications, or the computer worker.
- [x] A Bot can continue a graphical task while no user is viewing its Screen.
- [x] Reopening the Computer Surface reconnects to the same runtime generation and shows the same live page, windows, focusable state, unsaved Unicode field contents, and advanced background progress.
- [x] Agent screenshots and actions continue working while no viewer transport exists.
- [x] An unfinished Turn or Takeover is not implicitly completed by closing or switching the view.
- [x] Held buttons and keys are released when viewer authority ends.
- [x] Idle policy cannot terminate or suspend a session in a way that interrupts unfinished GUI work or discards in-memory state.
- [x] Only an explicit destructive lifecycle event may end Sway and its applications.

## Answer

Computer Surface / Screen Projection close is not `runtime.stop()`. Searched `swayBotScreenRuntime.ts`, `botScreenManager.ts`, and `screenProjection.ts`: there is no idle timer, MaxIdleTime, disconnect-timeout, or "no viewers → stop compositor" path. Projection `idle` is viewer-mode (capture off), not compositor eviction. `closeSurface` only tears down projection sessions and, when a controller was provisioned, calls existing `releaseInput`. Generated Sway config still has no idle/lock/suspend. Nothing was added "for later."

Public Sway-injected proof lives in `tests/integration/bot-screen-lifecycle.test.ts` via the existing `createScriptedSwayFixture()` seam. The fixture now serves a stable fake GET_TREE, records helper input (including `release`), counts wrapped `stop()`, can block worker `act`, and can advance a live Unicode window title while no viewer exists.

- Slice 1: `closing the Computer Surface releases projection work without stopping Sway` — after snapshot + capture stream + `closeSurface`, status is `ready`, generation 1, runtime dir present, `stops` empty, snapshot and `act(screenshot)` still succeed, projection media idle.
- Slice 2: `Sway window identity and Unicode progress stay live after viewers leave` — after close + 300ms + fixture progress, `list_windows`/`observe` still show window id `10`, focused, title `未保存 你好 · 1`, generation 1. Real unsaved browser/terminal fields remain ticket 09.
- Slice 3: `ending viewer authority releases held Sway input without stopping the desktop` — held button/key through `projectionSource`, then `closeSurface` + `releaseInput`; helper recorded `release`, Sway `stops` empty.
- Slice 4: `closing a Sway view does not settle an in-flight act or Takeover` — blocked `open_app` + `takeOver`, close surface; act and Takeover stay pending, view `takeover: available`, generation 1; explicit `releaseActions` + `imDone` then completes them.
- Slice 5: `a Sway Bot Desktop Session is not idle-evicted while no viewer is attached` — 1s with no viewers, still `ready`, stop count 0.

Required runs: lifecycle 33 pass, sway-runtime 4 pass, sway-control 9 pass, `bun run typecheck` clean. No production `main.ts` change, no real Sway, no WayVNC (ticket 05). Leftover risk: Sway still throws on `acquireExpandedView`, so this ticket did not drive a live WebRTC/WayVNC controller; held-input revoke is proven at the same `releaseInput` seam projection already uses. Fake A→B switch and H.264 tests were left as-is.
