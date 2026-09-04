# 07: Pass the Cage and H.264 capacity gate

**What to build:** Demonstrate that the combined Cage Bot Desktop and H.264 Screen Projection stack is safe to make production-default. The real final-stack harness must prove usable interaction, explicit frame accounting, failure behavior, and cleanup across the supported 1080p matrix and 720p fallback on the recorded LAN reference workstation.

**Blocked by:** 04 / Bound H.264 lifecycle and recovery; 06 / Prove Cage isolation and lifecycle.

**Status:** ready-for-agent

- [ ] The final-stack harness exercises the production daemon, real Cage runtime, long-lived capture/encoder, actual WebRTC peer, built web client, and browser decode/paint/canvas readback rather than a synthetic codec loop.
- [ ] The matrix covers 1, 2, 4, and 8 concurrent 1080p Bot Screens plus the selectable 720p fallback using sustained phases comparable to the checked-in approval.
- [ ] Four concurrent 1080p Screens each sustain at least 15 source, encoded, sent, received, decoded, and browser-displayed FPS.
- [ ] Four concurrent 1080p Screens remain at or below 200 ms median input-to-visible feedback; p95 is recorded and does not regress beyond the checked-in approved envelope without a separately reviewed approval change.
- [ ] The approved four-Screen row has zero unexplained frame drops, and every shortfall is assigned to a capture, encoder, transport, decode, or paint category.
- [ ] Idle Screens and static Computer Preview run without H.264 encoders and retain the intended low-frequency update rate.
- [ ] The report records per-Screen and total PSS/RSS, CPU, attributable GPU data where available, encoded bytes/bitrate, capture and encode latency, startup/readiness, teardown, and residual resources.
- [ ] Cage shows a material compositor-memory reduction at the same 1080p profile; the prior 720p prototype measurement is not reused as release proof.
- [ ] Sustained scenarios include active visual change, simultaneous Agent and Web input, Takeover, reconnect churn, capture/encoder/helper/compositor failure, and repeated permanent-delete/fresh-Bot cycles.
- [ ] Capacity exhaustion rejects or defers the next Screen before partial provisioning and leaves every admitted Screen within its measured envelope.
- [ ] The complete report and chosen default-capacity approval are reproducible and written before any gate failure so unsupported rows remain diagnosable.
