# 05: Contract the legacy transcript model

**What to build:** Complete the ordered-transcript cutover by removing the temporary legacy Bot-text and Activity paths after Response, Thinking, and Tool Call slices are live.

**Blocked by:** 03 — Present native Tool Call summaries; 04 — Stream Pi Thinking Blocks.

**Status:** resolved

- [x] Bot-authored legacy `text` records and their buffering path are removed; Bot output uses Response Blocks only.
- [x] Legacy Activity grouping, labels, rendering, tests, and assumptions are removed rather than retained as aliases.
- [x] Legacy Tool Call input/output transcript payloads are removed after all callers use safe summaries.
- [x] Thinking capability metadata becomes a required, versioned inventory contract after every current producer and fixture has migrated.
- [x] Native Events remain the residual Agent-specific fidelity boundary after Response, Thinking, Tool Call, Turn, and error normalization.
- [x] Unknown public Native Event payloads may remain retained, while diagnostic and secret payloads retain only redacted metadata; no generic Native Event Thread UI is introduced.
- [x] The development schema and all test fixtures use only the new transcript format, with no dual reads or compatibility parsing.
- [x] The existing local development database is reset manually; product code neither automatically deletes a database nor establishes destructive upgrade behavior.
- [x] Contract, daemon, conformance, and browser suites remain green after the old forms are deleted.

## Answer

The end-to-end slice is implemented: Bot output now uses the ordered transcript model exclusively, legacy Bot text, Activity, and full Tool Call payload paths are gone, and Native Events remain the residual fidelity boundary.
