# 07: Pass the Cage and H.264 capacity gate

**What to build:** Demonstrate that the combined Cage Bot Desktop and H.264 Screen Projection stack is safe to make production-default. The real final-stack harness must prove usable interaction, explicit frame accounting, failure behavior, and cleanup across the supported 1080p matrix and 720p fallback on the recorded LAN reference workstation.

**Blocked by:** 04 / Bound H.264 lifecycle and recovery; 06 / Prove Cage isolation and lifecycle.

**Status:** resolved — schema-v3 capacity report and approval passed on the recorded reference workstation

- [x] The final-stack harness exercises the production daemon, real Cage runtime, long-lived capture/encoder, actual WebRTC peer, built web client, and browser decode/paint/canvas readback rather than a synthetic codec loop.
- [x] The matrix covers 1, 2, 4, and 8 concurrent 1080p Bot Screens plus the selectable 720p fallback using sustained phases comparable to the checked-in approval.
- [x] Four concurrent 1080p Screens each sustain at least 15 source, encoded, sent, received, decoded, and browser-displayed FPS.
- [x] Four concurrent 1080p Screens remain at or below 200 ms median input-to-visible feedback; p95 is recorded and does not regress beyond the checked-in approved envelope without a separately reviewed approval change.
- [x] The approved four-Screen row has zero unexplained frame drops, and every shortfall is assigned to a capture, encoder, transport, decode, or paint category.
- [x] Idle Screens and static Computer Preview run without H.264 encoders and retain the intended low-frequency update rate.
- [x] The report records per-Screen and total PSS/RSS, CPU, attributable GPU data where available, encoded bytes/bitrate, capture and encode latency, startup/readiness, teardown, and residual resources.
- [x] Cage shows a material compositor-memory reduction at the same 1080p profile; the prior 720p prototype measurement is not reused as release proof.
- [x] Sustained scenarios include active visual change, simultaneous Agent and Web input, Takeover, reconnect churn, capture/encoder/helper/compositor failure, and repeated permanent-delete/fresh-Bot cycles.
- [x] Capacity exhaustion rejects or defers the next Screen before partial provisioning and leaves every admitted Screen within its measured envelope.
- [x] The complete report and chosen default-capacity approval are reproducible and written before any gate failure so unsupported rows remain diagnosable.

## Reproduce

Run the complete gate on the reference workstation:

```bash
OMARCHY_BOT_REAL_SCREEN_LOAD=1 \
OMARCHY_BOT_SCREEN_RUNTIME=cage \
OMARCHY_BOT_LOAD_MATRIX=1,2,4,8 \
OMARCHY_BOT_LOAD_FALLBACK=1 \
OMARCHY_BOT_LOAD_LAN_INTERFACE=<lan-interface> \
OMARCHY_BOT_LOAD_REPORT=<report.json> \
OMARCHY_BOT_LOAD_APPROVAL=<approval.json> \
bun test tests/integration/bot-screen-capacity.load.test.ts
```

`OMARCHY_BOT_LOAD_DURATION_MS` defaults to the approved 15-second sustained phase. The harness writes the schema-v3 report before setup, after the matched 1080p Hyprland/Cage compositor sample, and after every requested row. A candidate approval is written only after the four-Screen release gate, the operational gate, matched compositor-memory gate, and in-load pre-admission proof all pass. The resolved measurement outcomes below come from that final report; no values are copied from the earlier 720p Cage prototype.

## Answer

The final schema-v3 run passed both the release and operational gates. At the selected default of four 1080p Screens, per-Screen source, encoded, sent, received, decoded, and displayed rates were respectively 17.70–18.16, 17.70–18.16, 17.70–18.16, 17.70–18.16, 17.76–18.23, and 17.57–18.16 FPS. Browser-painted input-to-visible feedback was 36.0 ms p50 and 93.9 ms p95. Every Screen recorded zero unexplained drops; aggregate H.264 output was 6,991,670 bytes at 3,707,468.92 bit/s, daemon capture latency averaged 42.39 ms with a 141.17 ms maximum, and encode latency averaged 67.22 ms with a 155.69 ms maximum. Absolute capture-to-browser timestamps were correctly recorded as unavailable because the WebRTC H.264 session did not negotiate an absolute capture timestamp.

The matched 1080p compositor measurement reduced PSS from 116.54 MiB for Hyprland to 45.16 MiB for Cage, a 61.25% reduction. The supported rows are 1, 2, and 4 Screens at 1080p and 8 Screens at the selectable 720p fallback. The 8-Screen 1080p row completed every operational scenario with zero unexplained drops but is unsupported because its displayed rate was only 9.18–10.37 FPS.

Provenance: Cage 0.3.1-b7b774a via `/tmp/cage-portable.sh -v`; FFmpeg n9.0.1 via `/usr/bin/ffmpeg -version`; Google Chrome for Testing 151.0.7922.34 via `/home/colin/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome --version`; final web client in headless secure-context mode through `eno1` at the recorded non-loopback LAN endpoint. The report is `.scratch/bot-screen-media-desktop/capacity-report.json`; the schema-v3 approval was written to `apps/daemon/src/bootstrap/bot-screen-capacity-approval.json`.

Reproduce with:

```bash
OMARCHY_BOT_REAL_SCREEN_LOAD=1 OMARCHY_BOT_SCREEN_RUNTIME=cage OMARCHY_BOT_LOAD_MATRIX=1,2,4,8 OMARCHY_BOT_LOAD_FALLBACK=1 OMARCHY_BOT_LOAD_LAN_INTERFACE=<lan-interface> OMARCHY_BOT_LOAD_REPORT=<report.json> OMARCHY_BOT_LOAD_APPROVAL=<approval.json> bun test tests/integration/bot-screen-capacity.load.test.ts
```
