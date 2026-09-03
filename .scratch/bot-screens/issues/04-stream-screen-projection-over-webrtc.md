# 04: Stream the selected Screen Projection over WebRTC

**What to build:** Show a live Screen Projection for the selected Bot through WebRTC. The compact Computer Preview stays low-frequency and read-only, while the expanded desktop-browser viewer receives the selected Surface's live video without retaining frames from a previously selected Bot.

**Blocked by:** 02: Provision one real headless Bot Screen.

**Status:** resolved

- [x] Capture connects directly to the assigned child Wayland socket and output rather than the shared user portal.
- [x] WebRTC signaling and media are associated with Surface ID and runtime generation and can reach clients through the daemon's configured network listener under the accepted unauthenticated first-release posture.
- [x] The compact Computer Preview is read-only and low-frequency; continuous encoding is not active for an idle unopened Surface.
- [x] The expanded desktop-browser view displays the selected Surface at its correct aspect ratio and reports starting, connected, interrupted, and unavailable states without lease jargon.
- [x] Selecting another Bot or closing the view terminates the old peer, clears decoded frames and geometry, and rejects late media from the old Surface/generation.
- [x] Mobile clients retain a usable preview but do not expose promised Web Control gestures.
- [x] Browser and daemon integration coverage prove media lifecycle, selected-Bot switching, and no stale-frame leakage.

## Answer

The daemon `screenProjection` and projection routes bind direct Surface capture and WebRTC signaling to Surface and runtime generation, while the web `screenProjection` client owns peer teardown and selected-Surface frame clearing. Focused projection integration proves idle-versus-active media lifecycle, generation rejection, and delivered frame rate, and the Computer-sheet browser coverage proves selected-Bot switching, stale-frame removal, lifecycle copy, and mobile preview behavior.
