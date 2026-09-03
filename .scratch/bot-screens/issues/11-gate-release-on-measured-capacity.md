# 11: Gate release on measured Bot Screen capacity

**What to build:** Establish the supported Bot Screen capacity from the final production stack and enforce it before additional Screens can destabilize the user's desktop. Publish a reproducible performance envelope and enable a default capacity of four only when the target workstation passes it.

**Blocked by:** 10: Remove legacy Shared Screen control paths.

**Status:** resolved

- [x] A sustained 1/2/4/8-Screen matrix covers idle runtimes, static previews, active browser motion/scroll, simultaneous Agent and Web input, concurrent WebRTC encoding, Takeover, reconnect churn, crashes and repeated teardown.
- [x] Measurements record per-Screen and total PSS/RSS, CPU, attributable GPU/VRAM, encoded/displayed FPS, dropped frames, startup/teardown time, and input-to-visible-feedback p50/p95.
- [x] The 1080p reference setup sustains at least 15 FPS and no more than 200 ms median input-to-visible-feedback latency at the supported capacity.
- [x] A 720p fallback is measured and selectable when the 1080p capacity target cannot be met.
- [x] The default capacity is four only if four concurrent Screens pass; otherwise the measured lower limit is configured and reported honestly.
- [x] Admission beyond capacity returns an explicit unavailable/busy outcome without a partial runtime, leaked resource, or impact on active Screens.
- [x] Idle unopened Screens do not continuously encode, final teardown leaves no residual resources, and product copy does not present the unauthenticated/plaintext release as secure remote access.

## Answer

The production configuration consumes a checked-in schema-v2 capacity approval for four 1080p Screens, offers the selectable 720p profile, and `BotScreenManager` rejects admission before provisioning when measured capacity is full. The built final web client ran through a non-loopback HTTPS LAN endpoint: four 1080p Screens passed at 15.69–15.76 source, encoded and browser-displayed FPS with 155.0 ms median input-to-visible feedback; eight 1080p Screens retained 15.41–15.67 encoded FPS but fell to 6.24–6.77 displayed FPS and 259.6 ms median latency, while eight 720p Screens passed. Independent performance and operational gates record accounted drop categories and require static previews, simultaneous Broker Agent and Web input, Takeover, two reconnects per Screen, isolated failures, two permanent-delete/fresh-provision cycles per row, complete cleanup, resource metrics, and no-impact admission rejection.
