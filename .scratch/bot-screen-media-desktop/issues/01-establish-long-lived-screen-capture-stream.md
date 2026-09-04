# 01: Establish long-lived Screen Capture stream

**What to build:** Preserve the current Computer Preview, Expanded Web Control, and HTTP snapshot behavior while moving Screen Projection onto one bounded, long-lived, compositor-neutral capture stream per active source. Users should see the same Bot-owned pixels and interaction behavior, but steady-state capture must no longer start a new process for every frame.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Computer Preview and the current expanded image projection still render fresh frames from the selected Bot Screen at their existing target rates.
- [ ] A fresh HTTP snapshot still returns the assigned Surface's current pixels with the actual image media type and no-store caching.
- [ ] Steady-state Screen Projection obtains frames from a long-lived capture process or helper; process creation is not part of each frame capture.
- [ ] The capture stream is bound to the assigned private Wayland socket and named output and never falls back to the Shared Screen.
- [ ] Every frame retains Surface ID, runtime generation, geometry generation, logical geometry, video geometry, scale, sequence, and capture time semantics.
- [ ] At most one capture and one not-yet-consumed frame are pending; a newer frame replaces stale pending work instead of growing a queue.
- [ ] Stream failure closes or fails only the owning Screen Projection and leaves sibling Bot Screens usable.
- [ ] Collapse, disconnect, Surface failure, daemon shutdown, and Bot deletion stop the capture stream and leave no helper process, socket, or buffer behind.
- [ ] Existing Screen Projection, contextual Computer API, Browser paint, and real Bot Screen smoke coverage pass without asserting helper command construction or process order.
