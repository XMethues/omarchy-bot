# 04: Bound H.264 lifecycle and recovery

**What to build:** Make Expanded Web Control remain low-latency and recover honestly across mode changes, reconnects, backpressure, and media failures. Encoding should consume resources only while expanded, stale video must be discarded rather than queued, and a failed video path must leave an explicit read-only snapshot fallback instead of pretending control is live.

**Blocked by:** 03 / Stream Expanded Web Control over H.264.

**Status:** ready-for-agent

- [ ] Entering expanded mode starts exactly one capture/encode pipeline for the projection, and Computer Preview or an unopened Screen has no running H.264 encoder.
- [ ] Collapse, Bot switch, peer close, visibility/navigation teardown, Surface failure, daemon shutdown, and permanent deletion stop the encoder and release all associated processes and buffers.
- [ ] Expanded-mode entry and reconnect produce an immediate decodable keyframe, periodic keyframes permit recovery, and browser keyframe requests are honored when supported by the WebRTC library.
- [ ] Capture and encoder backpressure retain the newest useful frame and never form an unbounded queue or delay control/input messages behind video payloads.
- [ ] Metrics separately account for capture attempts, source frames, encoded frames, RTP sends, browser receives, decodes, paints, capture skips, encoder drops, transport skips, send failures, decode drops, paint drops, and unexplained shortfalls.
- [ ] Metrics and diagnostics contain counts and latency only; they retain no screenshots, frame bytes, typed text, pasted text, or raw controller identifiers.
- [ ] Unsupported H.264 negotiation, missing first frame, capture-helper failure, encoder failure, and undecodable media produce explicit Surface-scoped states.
- [ ] When fresh capture remains possible after a media failure, the Computer Surface shows a current read-only PNG/HTTP snapshot and does not expose interactive Web Control.
- [ ] Reconnect replaces stale media and controller state without recreating the Bot or transferring authority from another Surface.
- [ ] Browser and integration coverage exercises every lifecycle transition at public protocol and Computer Surface boundaries rather than asserting encoder internals.
