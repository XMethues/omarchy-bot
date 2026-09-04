# 03: Present native Tool Call summaries

**What to build:** Carry safe Tool Call summaries from the Agent to the Thread and render adjacent calls with Astryx's native Tool Call presentation, replacing the product-owned Activity disclosure.

**Blocked by:** 01 — Stream Response Blocks as Markdown; 02 — Persist per-Bot Display Settings.

**Status:** resolved

- [x] The common Tool Call contract requires identity, name, and status and permits only Adapter-authored optional target, duration, diff statistics, and one bounded redacted error summary.
- [x] Missing optional fields are omitted rather than guessed by the daemon or browser.
- [x] Full tool inputs, outputs, terminal logs, arbitrary JSON, and detailed diffs are not retained as transcript history.
- [x] A Tool Call started before failure, cancellation, or process loss is retained with `error` status instead of remaining `running` or disappearing.
- [x] One Tool Call renders inline; only adjacent Tool Calls form an Astryx group, and Response, Thinking, Steering, or recognized product content ends that group.
- [x] The outer `Activity` disclosure and system-sender wrapper are removed; Tool Calls render inside assistant message context.
- [x] `Show tool calls` immediately filters current and historical calls, including errors, without changing their persistence.
- [x] Native Events are never mapped into Tool Call rows and have no generic Thread renderer.
- [x] Browser, daemon, and accessibility coverage proves safe summaries, interruption, native grouping, history, filtering, keyboard operation, and start/terminal announcements without progress spam.

## Answer

The end-to-end slice is implemented: safe native Tool Call summaries persist through interruption, render inline in assistant context, group only when adjacent, and respond immediately to the Bot display setting.
