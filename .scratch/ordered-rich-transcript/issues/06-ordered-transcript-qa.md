# 06: Verify ordered mixed-Turn behaviour

**What to build:** Prove the completed transcript behaves as one coherent user experience when Response Blocks, Thinking Blocks, Tool Calls, Steering, display filtering, attention, and live Bot state interact.

**Blocked by:** 05 — Contract the legacy transcript model.

**Status:** resolved

- [x] A representative Turn preserves and renders Response → Thinking → Tool Call → Response and equivalent interleavings in exact occurrence order before and after refresh.
- [x] Steering remains in its real transcript position and never causes surrounding Agent blocks to merge or reorder.
- [x] Adjacent Response Blocks visually merge, while Thinking, Tool Calls, Steering, or recognized product content creates a visible boundary.
- [x] A Turn containing only hidden Tool Calls or Thinking completes quietly without inventing a Bot or System response.
- [x] Sidebar preview and unread content derive only from completed or visible Bot Response content; hidden process records do not become conversation summaries.
- [x] Existing state-driven completion and action-needed notifications remain correct when no Response Block exists.
- [x] The temporary working avatar follows the selected Thread's visible live output and retains the existing Bot Activity semantics.
- [x] Screen readers receive Thinking and Tool Call start/terminal boundaries without streamed delta or progress spam.
- [x] Responsive, light/dark, reduced-motion, keyboard, focus, and scroll-follow behaviour remains usable with long Markdown, expanded Thinking, and grouped tools.
- [x] Historical Activity expectations are replaced by ordered-block, Astryx Tool Call, and Thinking assertions, and the authoritative supersession documentation remains consistent.

## Answer

The end-to-end slice is implemented: mixed Turns preserve exact order across refresh, Steering and content-kind boundaries remain visible, hidden process-only Turns stay quiet, and transcript interactions remain accessible and usable.
