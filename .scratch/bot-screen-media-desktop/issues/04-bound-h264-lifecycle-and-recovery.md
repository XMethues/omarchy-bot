# 04: Bound H.264 lifecycle and recovery

**What to build:** Make Expanded Web Control remain low-latency and recover honestly across mode changes, reconnects, backpressure, and media failures. Encoding should consume resources only while expanded, stale video must be discarded rather than queued, and a failed video path must leave an explicit read-only snapshot fallback instead of pretending control is live.

**Blocked by:** 03 / Stream Expanded Web Control over H.264.

**Status:** resolved

- [x] Entering expanded mode starts exactly one capture/encode pipeline for the projection, and Computer Preview or an unopened Screen has no running H.264 encoder.
- [x] Collapse, Bot switch, peer close, visibility/navigation teardown, Surface failure, daemon shutdown, and permanent deletion stop the encoder and release all associated processes and buffers.
- [x] Expanded-mode entry and reconnect produce an immediate decodable keyframe, periodic keyframes permit recovery, and browser keyframe requests are honored when supported by the WebRTC library.
- [x] Capture and encoder backpressure retain the newest useful frame and never form an unbounded queue or delay control/input messages behind video payloads.
- [x] Metrics separately account for capture attempts, source frames, encoded frames, RTP sends, browser receives, decodes, paints, capture skips, encoder drops, transport skips, send failures, decode drops, paint drops, and unexplained shortfalls.
- [x] Metrics and diagnostics contain counts and latency only; they retain no screenshots, frame bytes, typed text, pasted text, or raw controller identifiers.
- [x] Unsupported H.264 negotiation, missing first frame, capture-helper failure, encoder failure, and undecodable media produce explicit Surface-scoped states.
- [x] When fresh capture remains possible after a media failure, the Computer Surface shows a current read-only PNG/HTTP snapshot and does not expose interactive Web Control.
- [x] Reconnect replaces stale media and controller state without recreating the Bot or transferring authority from another Surface.
- [x] Browser and integration coverage exercises every lifecycle transition at public protocol and Computer Surface boundaries rather than asserting encoder internals.

## Answer

Expanded mode now owns one Surface-scoped, latency-bounded RGBA-to-H.264 pipeline. The encoder accepts at most one pending raw frame and replaces stale work with the newest capture, emits an immediate Baseline keyframe with SPS/PPS, and repeats periodic recovery keyframes. Its lifecycle API supports a clean single-generation keyframe restart and has deterministic coverage, but the installed node-datachannel sender binding does not expose inbound browser PLI/FIR feedback; the ticket’s conditional browser-request path is therefore not claimed for this binding. RTP is skipped rather than queued when sending reports backpressure, while input and control remain on their independent ordered channels.

Mode changes stop capture and encoder input immediately, and replacement sessions wait for the prior Surface pipeline to terminate before starting. Collapse, peer close, Bot switch, browser suspension/navigation, Surface failure, daemon shutdown, and permanent deletion all converge on awaited capture, encoder, buffer, peer, and input-authority cleanup. Reconnect creates a fresh projection session for the same Bot and Surface generation, clears stale media and controller state, and requires a newly painted correctly sized keyframe before restoring interaction.

The protocol now carries bounded cumulative browser media metrics and categorical Surface failure messages. Diagnostics expose only stage counts, latency aggregates, and a fixed failure reason: capture attempts, source/encoded/RTP/browser receive/decode/paint counts, named skip/drop/failure categories, and unexplained shortfalls. Unsupported negotiation, missing first frame, capture/encoder/transport failure, and browser decode failure all end in an explicit current PNG/HTTP snapshot state when fresh capture remains available; that state removes Web Control and Takeover entry points.

Focused codec, Screen Projection integration, and Computer Surface browser coverage exercises deterministic encoder keyframe restart, expanded/collapsed pipeline ownership, reconnect replacement, browser metric reporting, attributable terminal capture failure, unsupported H.264, missing frames, decode failure, and read-only fallback. Per task instruction, validation was not run in this slice.
