# 05: Switch projections without retaining unused media work

**What to build:** A client switches its Computer Surface between Bots without interrupting their independent background work. Old connections, stale input authority, and unnecessary viewer-driven capture/encoding are released, while applications, Agent screenshots, and outstanding human handoffs retain their correct lifetimes.

**Blocked by:** 04: Run independent Bot Desktop Sessions on demand.

**Status:** resolved

**Source specification:** [Shared Workspace and Bot Desktop Boundary Correction](../spec.md).

**Specification coverage:** Stories 51–66, 78, 79, 83, 91–96.

- [x] Switching the selected Bot replaces that client's old Screen Projection and input connection with the selected Bot's current Screen; it does not cancel a Turn, destroy the old desktop, or serialize unrelated desktop work.
- [x] A real A-to-B scenario proves A continues useful background graphical work while B can be viewed and operated independently. Clearing a React view alone is not evidence of that behavior.
- [x] Old pixels, authority, and obsolete connection responses cannot appear under the new Bot. Late responses, generation changes, and reconnect races cannot overwrite the current selected projection.
- [x] Compact Computer Preview stays low-frequency and read-only; expanded Web Control retains the existing H.264/signaling/input contract and authority rules. No new VNC/SSH transport or arbitrary-URL view is introduced.
- [x] Leaving expanded mode releases expanded-only encoding when no other viewer requires it. Closing the last viewer stops continuous viewer-driven preview capture and video encoding for that Screen.
- [x] Closing one viewer does not terminate resources another attached viewer still needs. Each client projects only its selected Screen, without imposing an unapproved global one-viewer policy.
- [x] No-viewer cleanup leaves applications and useful background work running; an explicit Agent screenshot still succeeds. No idle-kill policy discards application or unsaved state to make resource figures look better.
- [x] Input authority is released through the existing protocol, including held-key/button cleanup on authority loss, blur, disconnect, or selection change. Stale runtime/controller input is rejected rather than replayed after reconnect.
- [x] Human Takeover coordinates Bot versus human input only on the owning Screen. Navigating away or closing a view does not complete a pending sensitive step or implicitly tell the Bot to resume; unrelated Bots remain independent.
- [x] Live projection failure remains explicit, and read-only snapshot fallback cannot masquerade as usable interactive control. Reconnection targets the currently selected Screen and fresh runtime/geometry facts.
- [x] Extend existing browser/public-daemon behavior coverage for selection, fallback, Takeover, and stale responses; use the real desktop/projection seam for background continuation and release of capture/encoder processes. Distinguish simulated peer coverage from actual media evidence.
- [x] Verify repeated A/B switches, compact/expanded transitions, disconnect/reconnect, the last viewer leaving, another viewer remaining, and Agent screenshot use without a viewer. Observe remaining process work and retained application output rather than testing private cleanup helpers alone.
- [x] Keep conversation, selection, and Computer behavior in the shared Web frontend/daemon-facing contracts intended for future Tauri reuse. Execution remains on Omarchy, without shell-specific business rules, native scaffolding, or claims that Chromium passes prove Tauri WebView support.
- [x] Report the resource lifecycle behaviors proved here without asserting an unmeasured overall memory/CPU saving. Use private runtime/profile fixtures and targeted teardown; do not modify or restart the Host Session.

## Scope

The blocker supplies working independent sessions. This ticket supplies the complete viewer-to-media lifetime cutover, not broader application lifecycle policy or browser-state synchronization. Its changes may share projection modules with recovery work; concurrent implementers must coordinate shared mutations rather than inventing a false product dependency or running validation against half-integrated sibling edits.

## Answer

Viewer-to-media cutover is now per remaining viewer: a client switch replaces that client's projection and input only. Capture and H.264 encoding stop when no viewer still needs them. Bot Desktop Sessions, applications, Agent screenshots, in-flight Turns, and unfinished Takeover stay on their owning Screen.

**Changed**
- `ScreenProjectionService` no longer closes every other session on the same Screen when one expands, and no longer destroys the previous controller's peer when a new viewer claims input. Authority still transfers: held keys/buttons are released, the old epoch is revoked, and stale controller input is rejected.
- Public `surfaceMedia(surfaceId)` reports viewer counts, capture/encode activity, and live encoder PIDs. `H264EncoderProcess.pid` exposes the current ffmpeg generation so tests observe process work rather than private helper names.
- `ScreenProjectionConnection.connect()` discards a late SDP answer after the viewer has closed, so a switch cannot apply obsolete signaling to the old peer.
- Computer sheet e2e: Bot-switch coverage is labeled as simulated peers; a pending-Takeover switch case asserts `return-to-bot` is not called. A JSX brace typo in `ComputerPanel` (activity fallback) was fixed so the web build parses.

**Proved (injectable Screen + real ffmpeg encoder)**
- `tests/integration/screen-projection.test.ts`: expanding one viewer leaves another client's preview running; last viewer closes capture streams and encoder PIDs while `screens.status` stays `ready`, HTTP snapshot and `screenshot`/`open_app` still succeed, and `adapter.stops` stays empty; leaving expanded kills unused encoder PIDs while a remaining preview keeps frames; A→B switch releases A's media, does not stop A's runtime or cancel a blocked `computer:observe` turn, and B keeps receiving frames; a second expanded viewer takes input without tearing down the first video stream, then stale first-controller input is rejected; reconnect explicitly closes the old session and waits for its capture pipeline before the replacement encodes.
- Existing Takeover, held-input release, stale generation/controller rejection, and snapshot-fallback tests still pass. Compact preview remains 1 Hz PNG; expanded remains H.264/signaling/input. No VNC/SSH.
- `apps/web/src/lib/screenProjection.test.ts`: a late offer answer after `close()` does not call `setRemoteDescription` or deliver frames.
- `bun run typecheck` passed. Focused suites: screen-projection 24 pass, web projection 2 pass, `computer.test.ts` 17 pass.

**Simulated (UI/state, not real media)**
- `tests/e2e/specs/10-computer-sheet.spec.ts` switch and Takeover cases use `installProjectionPeer` fake `RTCPeerConnection`s. They cover selection, scoped requests, read-only snapshot copy, and “navigate away does not complete Takeover.” They are not encoder or Cage evidence.

**Unmet real media / host evidence**
- This session did not run real Cage A/B pixels. Background continuation for A is the injectable runtime staying up plus screenshot/`open_app` after the viewer left, plus a real ffmpeg PID going away. It is not a filmed sibling desktop.
- `bot-screen-capacity.load.test.ts` was not extended. No selected-view / background-work PSS or CPU matrix is claimed. Encoder-process release here is PID liveness in the projection harness, not a normal-use cost report.
- Computer-sheet Playwright did not execute in this session: the sandbox Playwright browser path was empty (existing browsers live under `~/.cache/ms-playwright`), and the e2e daemon imports `cageBotScreenRuntime.ts`, which currently fails to parse (`#stopTracked`) under concurrent ticket 06. That file was not edited.
- No host top-bar, shortcut, or usability claim. No Tauri/WebView claim. No unmeasured memory/CPU saving. No idle-kill of applications.
