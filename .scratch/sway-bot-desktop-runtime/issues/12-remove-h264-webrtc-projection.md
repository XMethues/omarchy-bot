# 12: Remove the obsolete H.264 and WebRTC projection stack

**Parent:** [#8](https://github.com/XMethues/omarchy-bot/issues/8)

**What to build:** Contract the projection migration by deleting the old expanded H.264/WebRTC implementation after view-only RFB and the separate Broker control channel are production-wired.

**Blocked by:** 10: Cut production Bot Desktop Sessions over to Sway.

**Status:** resolved

- [x] H.264 encoder processes, ffmpeg encoder preflight, RTP packetization, SDP/ICE signaling, video-track handling, and encoder-specific diagnostics are removed from production projection.
- [x] WebRTC-native dependencies are removed when no remaining product capability uses them.
- [x] Projection protocol schemas and clients no longer expose SDP, ICE candidates, H.264 codec/profile fields, encoder states, or media-track assumptions.
- [x] Preview PNG, view-only RFB, Broker control/input, browser metrics needed by the new transport, and HTTP read-only fallback remain explicit and versioned.
- [x] Obsolete H.264/WebRTC tests, helpers, capacity roles, environment variables, and documentation are removed or replaced with RFB equivalents.
- [x] External behavior remains green for preview, Web Control, Takeover, Bot switching, multiple viewers, failure fallback, input release, and projection cleanup.
- [x] Repository search and dependency inspection demonstrate that the obsolete expanded projection path is not reachable or shipped.
- [x] Historical transport ADRs and reports remain available with supersession and scope clearly stated.

## Answer

Completed the full transport cutover rather than retaining WebRTC underneath RFB. Projection v3 creates an owner-bound session with separate control/preview and view-only RFB WebSocket endpoints. It removes SDP/ICE offers and answers, RTC channel names, `node-datachannel`, the UDP listener, encoder/RTP counters, and the obsolete H.264 process path.

The real noVNC 1.7 client negotiates bidirectional RFB protocol bytes. RFB remains view-only at both client and WayVNC; pointer, key, scroll, paste, controller epochs, ordering, release barriers, and Takeover remain on the Broker-authorized control channel. Preview is lossless PNG, and projection failures retain an explicit read-only snapshot fallback without killing Sway.

Conformance/load clients now use the same WebSocket contract. The browser measurement proxy forwards upgrades and opaque binary data; browser paints are not equated to RFB transport chunks or historical video-frame budgets. Production admission no longer depends on the archived Cage approval.

Verification includes public session/control/RFB integration tests, all Computer Surface E2E scenarios with actual noVNC pixels, and the strict real two-Sway/browser conformance report. Historical transport records are retained as historical evidence, not current implementation instructions.
