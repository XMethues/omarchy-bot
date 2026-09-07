# 01: Make Screen Projection transport replaceable without changing Cage behavior

**Parent:** [#8](https://github.com/XMethues/omarchy-bot/issues/8)

**What to build:** Expand the existing Bot Screen runtime and Screen Projection seam so direct preview/capture and expanded view transport can vary independently. Existing Cage behavior remains unchanged and green while later tickets add Sway and view-only RFB behind this seam.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Bot Screen readiness remains independent from expanded projection readiness.
- [x] The runtime seam can provide direct captures and acquire/release an opaque expanded-view stream without exposing process IDs, socket paths, or compositor commands.
- [x] The stream supports bidirectional RFB protocol bytes while conferring no input authority; user input remains a separate Broker-authorized operation.
- [x] Existing preview, expanded Web Control, Takeover, stale-generation rejection, and read-only fallback behavior remain externally unchanged for Cage.
- [x] Closing a projection lease cannot stop the Bot Desktop Session or ordinary applications.
- [x] Fake-runtime and public projection tests cover the expanded seam without asserting compositor-specific implementation details.
- [x] No user-facing runtime selector or second production adapter is introduced.

## Answer

Added an opaque `BotScreenExpandedView` lease (`send` / `receive` / `close`) and `acquireExpandedView()` on both `BotScreenRuntime` and `BotScreenProjectionSource` in `botScreenManager.ts`. Manager wrapping mirrors `openCaptureStream`: stale generation and stopped runtimes reject acquire and in-flight send/receive; `close()` does not call `runtime.stop()` or change lifecycle. `BotScreenRuntimeReadiness` is unchanged (no expanded-view field).

`FakeBotScreenRuntimeAdapter` implements an in-memory echo pipe. RFB-looking bytes stay on the lease and never append to `inputEvents` / `pointerEvents`. Acquire/release counts let tests prove lease close without desktop stop.

Cage `acquireExpandedView` throws `Cage Bot Screen does not provide an expanded-view stream`. `screenProjection.ts` still uses `openCaptureStream` + H.264. No Sway adapter, runtime selector, WayVNC, or protocol bump.

Coverage:
- `tests/integration/bot-screen-lifecycle.test.ts`: ready-before-acquire, RFB bytes confer no input, close leaves Session ready, stale source/lease reject and replacement can acquire.
- `tests/integration/screen-projection.test.ts`: last viewer still releases H.264 capture without stopping the desktop; a subsequent expanded-view lease close also leaves `stops` empty.
