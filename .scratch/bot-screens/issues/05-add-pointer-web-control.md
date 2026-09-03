# 05: Add pointer Web Control

**What to build:** Let a desktop-browser user control the selected Bot Screen with pointer motion, click, drag and scroll only from the expanded viewer. Browser coordinates map to the displayed logical output, and every event remains bound to the current Surface and geometry.

**Blocked by:** 03: Run two Bot Screens concurrently; 04: Stream the selected Screen Projection over WebRTC.

**Status:** resolved

- [x] Only the expanded viewer installs pointer input handlers; the compact Computer Preview remains incapable of sending input.
- [x] Coordinates map through the rendered video's content rectangle, including letterboxing, scale and resize, into logical output coordinates.
- [x] Pointer events carry Surface, runtime generation, geometry generation and monotonic sequence; missing, stale, duplicated, out-of-order, or mismatched events fail closed.
- [x] Pointer motion may coalesce to the latest unsent position, while button and axis transitions are delivered in order and never coalesced away.
- [x] The assigned child's output-bound virtual pointer performs motion, click, drag and scroll without moving another Bot's pointer or the physical Shared Screen pointer.
- [x] Browser E2E and real-platform smoke coverage exercise edge coordinates, resized video, click, drag, scroll, high-rate motion and cross-Surface isolation.

## Answer

Expanded Web Control maps pointer events through the rendered video content rectangle, and the projection input protocol binds ordered events to the current Surface, runtime, geometry, controller epoch, and sequence while coalescing only motion. The focused browser test covers resized letterboxing and an inert compact preview, projection integration covers ordering and stale or mismatched rejection, and the real Hyprland smoke proves click, drag, scroll, sibling isolation, and an unchanged host pointer.
