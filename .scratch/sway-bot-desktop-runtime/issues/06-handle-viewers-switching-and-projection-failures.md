# 06: Handle multiple viewers, Bot switching, and projection failures

**Parent:** [#8](https://github.com/XMethues/omarchy-bot/issues/8)

**What to build:** Complete the view-only projection lifecycle so multiple clients can safely observe one Bot Screen, Bot selection can change without stale pixels or authority, and a projection failure remains separate from desktop failure.

**Blocked by:** 04: Retain live Sway state when viewers leave; 05: Open Web Control through view-only WayVNC.

**Status:** resolved

- [x] The first expanded viewer starts one WayVNC process for the Bot Screen, and additional viewers share it without creating another desktop or WayVNC process.
- [x] Closing one viewer preserves the projection needed by remaining viewers.
- [x] Closing the final expanded viewer drains RFB bridges and stops WayVNC while leaving Sway, applications, and direct Agent capture running.
- [x] Compact-preview viewers do not keep expanded projection resources alive.
- [x] Switching from Bot A to Bot B clears A's pixels and input authority before B becomes usable.
- [x] Late frames, view messages, and input from an obsolete session, Surface, runtime generation, geometry generation, controller epoch, or sequence are rejected.
- [x] Browser blur, visibility loss, navigation, disconnect, and teardown release all held input.
- [x] A WayVNC, RFB bridge, or browser decoder failure marks only the Screen Projection failed and exposes a truthful read-only fallback.
- [x] An unfinished Takeover remains unfinished across view closure or switching.
- [x] Repeated connection churn leaves no stale bridge, capture, authority, timer, or viewer-count state.

## Answer

`SwayBotScreenRuntime.acquireExpandedView` now refcounts one WayVNC per Bot Screen. The first expanded lease starts a single `wayvnc` unit bound to `wayvnc.sock`. Further leases open additional Unix clients to that same socket; they do not spawn a desktop or a second WayVNC. The last `close()` terminates the process and removes the socket. Preview, `openCaptureStream`, and `capture` never take a lease. `ScreenProjectionService.#startRfbView` still acquires one lease per session; sharing is at the adapter so direct `acquireExpandedView` tests see the same process. Application-unit role `wayvnc-N` is gone.

`ScreenProjection` already failed RFB without failing the desktop (`rfb-failed` + `snapshotFallback`). This ticket added the shared-process proofs and a sibling-Screen isolation case. Fake H.264 tests already cover A→B switch, stale session/Surface/generation/epoch/sequence rejection, held-input release on blur/teardown, and unfinished Takeover across view close; they were left in place.

**Sharing:** adapter-level `leaseCount` + coalesced start. Each lease is its own Unix RFB bridge. Last lease stop is skipped while another acquire is in flight.

**Files:** `swayBotScreenRuntime.ts`, `applicationUnits.ts` (dropped `wayvnc-${string}`), `tests/integration/helpers/swayBotScreen.ts` (echo + `exitWayvncFor` + existing `wayvncStarts`), `tests/integration/bot-screen-sway-projection.test.ts`. No `screenProjection.ts` change. No ticket 07/08/10 work.

**New Sway/RFB tests:**
- `two expanded leases share one WayVNC process and survive a sibling close`
- `two expanded Sway viewers share one WayVNC and keep RFB after a sibling close`
- `last expanded close stops WayVNC while a preview viewer and Sway stay ready`
- `WayVNC crash fails only that Screen Projection and leaves a sibling Screen ready`
- `expanded connection churn restarts WayVNC serially and leaves no leftover state`
- `switching from Sway Bot A to Bot B clears A's RFB and authority before B expands`

**Cited Fake H.264 proofs (unchanged):**
- A→B: `switching from Bot A to Bot B replaces only that client's projection`
- stale rejection: `fails closed on missing, stale, mismatched, duplicated, or out-of-order fields`; `binds ordered pointer input to the current Surface, runtime, geometry, controller, and sequence`
- held input: `revokes held input on browser suspension and helper failure before issuing a new epoch`; `releases held keys and buttons before replacement and rejects the stale controller epoch`
- Takeover across view close: `failed final artifact persistence restores the still-open Takeover controller`; `double failure waits without authority and a fresh controller resumes Takeover`

**Results (all pass) + `bun run typecheck`:**
- `tests/integration/bot-screen-sway-projection.test.ts` — 13 pass
- `tests/integration/screen-projection.test.ts` — 24 pass
- `tests/integration/bot-screen-lifecycle.test.ts` — 33 pass
- `tests/integration/bot-screen-sway-runtime.test.ts` — 4 pass

**Leftover risk:** production still uses Cage until ticket 10; real WayVNC is ticket 08. Sharing is proven with the fake Unix WayVNC (echo + start count), not a live compositor. Ticket 07 recovery/destroy of Sway trees is untouched.
