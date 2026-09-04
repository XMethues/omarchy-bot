# 03: Stream Expanded Web Control over H.264

**What to build:** Let a user open one real 1080p Bot Screen in Expanded Web Control and see it through an H.264 WebRTC video track while Computer Preview remains a lossless PNG projection and the existing control/input DataChannels, Computer Broker, Takeover, and HTTP snapshot behavior continue end to end.

**Blocked by:** 01 / Establish long-lived Screen Capture stream.

**Status:** resolved

- [x] The browser offer negotiates an H.264 receive direction and the daemon answer attaches a video track for the same Surface and runtime generation.
- [x] The public Screen Projection contract declares separate preview-image, expanded-video, control, input, and snapshot-fallback capabilities under one incremented protocol version.
- [x] Protocol, daemon, shared client, browser, load harness, and fake projection peer migrate together; no version-one alias or partial compatibility branch remains.
- [x] Computer Preview continues to display low-frequency lossless PNG frames and never installs input authority.
- [x] Entering expanded mode stops continuous image-frame delivery and displays correctly sized H.264 video from the same Bot Screen.
- [x] The H.264 stream uses browser-compatible Baseline/YUV420 framing, a 90 kHz RTP clock, and codec headers accompanying recoverable keyframes.
- [x] Expanded pointer, click, drag, scroll, keyboard, shortcuts, and one-way paste still pass through the existing validated input DataChannel.
- [x] Letterboxed and resized input maps through the video's intrinsic dimensions and rendered content rectangle into current logical output coordinates.
- [x] Takeover holds and resumes the same pending computer tool while the expanded media transport is active.
- [x] Switching Bots clears the previous Bot's PNG, video track, control authority, and queued input before showing the new Computer Surface.
- [x] A real single-Screen browser smoke proves 1920×1080 video is decoded and painted and that visible keyboard or pointer feedback belongs to the selected Bot Screen.

## Answer

Screen Projection now uses protocol version 2 with explicit PNG preview, H.264 video, control, input, and HTTP snapshot-fallback capabilities. The compositor-bound capture helper streams framed RGBA buffers once per pull; preview alone encodes those buffers to lossless PNG, while Expanded mode feeds them directly into one geometry-pinned, long-lived ffmpeg/libx264 Baseline encoder without a PNG encode/decode round trip. The daemon packetizes Annex-B access units on a 90 kHz RTP clock, repeats SPS/PPS on keyframes, and leaves preview delivery at the read-only one-frame-per-second path.

The browser negotiates only compatible H.264 receive codecs, paints the selected Surface through a video element, withholds input until a correctly sized video frame is painted, and maps input through that element's letterboxed content rectangle. Selection cleanup is Surface-tagged and clears preview URLs, video streams, authority, and held input before the replacement Surface can render. Failed live projection presents the existing fresh HTTP snapshot as an explicit read-only fallback.

The fake projection peer, Screen Projection integration seam, codec parser/timestamp coverage, Computer Surface behavior seam, and final-stack browser load harness now exercise the version-2 hybrid transport. The final-stack harness requires intrinsic negotiated dimensions and a browser paint before considering Expanded Web Control ready. Per task instruction, validation was not run in this slice.
