# 04: Stream Pi Thinking Blocks

**What to build:** Preserve Thinking that Pi officially exposes as ordered, durable Thinking Blocks and make it inspectable through the Bot's display preference without changing Pi's native reasoning configuration.

**Blocked by:** 01 — Stream Response Blocks as Markdown; 02 — Persist per-Bot Display Settings.

**Status:** resolved

- [x] The common Agent contract represents Thinking start, delta, and end events with one stable Adapter-generated block ID and explicit capability metadata.
- [x] Pi maps native `thinking_start`, `thinking_delta`, and `thinking_end` boundaries and correlates each block without exposing provider-specific identifiers.
- [x] Pi reports Thinking and streaming support truthfully for the installed version and selected model while leaving Pi's native session/model/settings resolution unchanged.
- [x] Only officially exposed reasoning, provider-authored summaries, and provider redaction placeholders are retained; hidden reasoning is never inferred or reconstructed.
- [x] Thinking Blocks persist incrementally in their real order around Response Blocks and Tool Calls and remain available after refresh.
- [x] Failure, cancellation, worker loss, daemon recovery, or another abnormal terminal path removes any incomplete Thinking Block.
- [x] Each Thinking Block is collapsed by default, shows active/completed state and its own start-to-end wall-clock duration, and renders compact Markdown when expanded.
- [x] Manual expansion survives deltas and completion during the current Thread visit but is not persisted across refreshes.
- [x] `Show Thinking` immediately filters live and historical blocks; historical Thinking remains accessible after current capability loss.
- [x] Pi conformance, daemon, browser, and accessibility coverage proves models with and without Thinking, multiple blocks, history, filtering, duration, expansion stability, and boundary-only announcements.

## Answer

The end-to-end slice is implemented: Pi Thinking streams and persists in transcript order, cleans up when interrupted, and appears as collapsible Markdown with duration, stable in-visit expansion, and immediate display filtering.
