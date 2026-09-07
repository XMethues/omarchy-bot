# Sway Bot Desktop Runtime completion

Updated: 2026-09-08

This report separates implementation, automated evidence, publication, and human acceptance. It does not turn historical resource measurements into a current Sway approval.

## Stage flags

- production cutover: true
- Cage removal: true
- H.264 video-track removal: true
- WebRTC removal: true
- automated conformance: current focused suites and real-browser scenarios passed; final full-suite results are recorded with the implementation delivery
- real-runtime evidence: current two-Sway report
- resource evidence: current short scenario measurements, not an approved performance budget
- human acceptance: pending

## Current production path

`main()` constructs `SwayBotScreenRuntimeAdapter` with `PortableSwayRuntimeSupply`. No compositor selector or Cage fallback remains. Leftover Cage trees block startup unless explicitly destroyed through the one-shot migration gate; Shared Workspace files and Agent Native Sessions are not migration targets.

Projection protocol v3 creates an owner-bound session and returns separate control/preview and RFB WebSocket endpoints. PNG preview, input authority, ordered input, view mode, and failures use the control socket. RFB bytes are bidirectional protocol traffic; real noVNC 1.7 is view-only and WayVNC disables remote input. SDP, ICE, RTC data channels, `node-datachannel`, encoder/RTP counters, and the UDP listener are removed. Closing a viewer releases projection and input resources without ending the desktop.

Recovery now verifies persisted process boot/start identity and private ownership before individual-PID teardown; it never signals a recovered numeric process group. A Sway generation marker is written before spawn, so partial startup is not misclassified as Cage. RFB sends retain partial-write suffixes until drain, and a runtime-wide WayVNC stop barrier prevents replacement from racing old unit/socket cleanup.

The launcher logs failures and runs the daemon behind a private lifetime pipe. Even Quickshell's forced destruction of its tracked process triggers the daemon's ordinary cleanup. A shared startup lock remains held until the daemon exits, including process-group termination.

## Verification evidence

The complete Bun suite was run: 345 passed and two test-isolation/readiness failures were found. Those failures were corrected and passed focused reruns. After final review repairs, the affected-module batch passed 90 tests (4 opt-in skips, no failures), the complete browser suite passed 80 tests, and strict real two-Sway/browser conformance passed again. Type checking passed.

Focused integration coverage exercises session creation, ownership, stale input rejection, RFB byte flow, fallback, multiple viewers, source isolation, runtime supply, native Sway controls, and lifecycle cleanup. The public Computer Surface E2E file uses the real noVNC client and checks negotiated pixels, input separation, Takeover, switching, reconnect, and read-only fallback.

The current real-runtime command is:

```bash
OMARCHY_BOT_REAL_SWAY=1 bun test tests/integration/bot-screen-sway-conformance.test.ts
```

See [the current report](conformance-report.md). This run verifies exact Unicode in a real browser field and terminal, `open_url` into the intended Screen, real Sway-to-noVNC browser paint and Broker input, unchanged window/runtime identity and unsaved text across close/reopen, advancing background work, multiple viewers, failure isolation, and complete targeted cleanup. The test fails if a required check is missing or false; it no longer counts a blocked report as a passing conformance test.

Host compositor PID and routing invariants were observed unchanged. This is not a hands-on bar, shortcut, focus, or physical-input pass.

## Resource interpretation

The two-Sway report separates desktop infrastructure, WayVNC/projection, applications, daemon/harness, and whole-scenario costs. Daemon and harness share a process; network counters are whole-host. RFB handshake latency is distinguished from actual browser first-paint and input-to-paint measurements. Opaque RFB chunks are not treated as encoded video frames.

Production admission is an explicit conservative policy: four 1080p Screens by default, with up to eight in the 720p profile. It no longer depends on Cage memory comparisons or a historical video-FPS/latency budget. Original Cage data is archived under `.scratch/bot-screen-media-desktop/historical-capacity-approval.json`. No new performance budget or full capacity-matrix approval is claimed.

## First-enable delivery

The runtime packager installs frozen production dependencies into private staging and excludes all source `node_modules` trees. A real archive was served over private HTTPS and used to start the daemon with no Bun, mise, or compiler on PATH. The launcher downloaded and verified official Bun 1.4.2, verified/extracted the runtime, and returned healthy. No Sway runtime was downloaded at enable. This was an isolated cold-path check on the supported host architecture, not a new stock-machine installation or a published GitHub release.

The workflow publishes SHA-addressed runtime assets after a main-branch push. Publication is separate from this local implementation and commit.

## Remaining acceptance

[Human Host Session acceptance](host-session-acceptance.md) remains open. The checklist is not marked passed. GitHub #8 must not be closed as fully accepted on automation alone; GitHub #6 publication/stock-user validation must not be inferred from a local artifact.
