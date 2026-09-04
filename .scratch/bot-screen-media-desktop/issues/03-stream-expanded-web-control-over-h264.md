# 03: Stream Expanded Web Control over H.264

**What to build:** Let a user open one real 1080p Bot Screen in Expanded Web Control and see it through an H.264 WebRTC video track while Computer Preview remains a lossless PNG projection and the existing control/input DataChannels, Computer Broker, Takeover, and HTTP snapshot behavior continue end to end.

**Blocked by:** 01 / Establish long-lived Screen Capture stream.

**Status:** ready-for-agent

- [ ] The browser offer negotiates an H.264 receive direction and the daemon answer attaches a video track for the same Surface and runtime generation.
- [ ] The public Screen Projection contract declares separate preview-image, expanded-video, control, input, and snapshot-fallback capabilities under one incremented protocol version.
- [ ] Protocol, daemon, shared client, browser, load harness, and fake projection peer migrate together; no version-one alias or partial compatibility branch remains.
- [ ] Computer Preview continues to display low-frequency lossless PNG frames and never installs input authority.
- [ ] Entering expanded mode stops continuous image-frame delivery and displays correctly sized H.264 video from the same Bot Screen.
- [ ] The H.264 stream uses browser-compatible Baseline/YUV420 framing, a 90 kHz RTP clock, and codec headers accompanying recoverable keyframes.
- [ ] Expanded pointer, click, drag, scroll, keyboard, shortcuts, and one-way paste still pass through the existing validated input DataChannel.
- [ ] Letterboxed and resized input maps through the video's intrinsic dimensions and rendered content rectangle into current logical output coordinates.
- [ ] Takeover holds and resumes the same pending computer tool while the expanded media transport is active.
- [ ] Switching Bots clears the previous Bot's PNG, video track, control authority, and queued input before showing the new Computer Surface.
- [ ] A real single-Screen browser smoke proves 1920×1080 video is decoded and painted and that visible keyboard or pointer feedback belongs to the selected Bot Screen.
