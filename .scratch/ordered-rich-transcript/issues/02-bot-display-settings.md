# 02: Persist per-Bot Display Settings

**What to build:** Give each Bot independent controls for showing Tool Calls and Thinking, with one durable preference shared by every Thread and application window without changing Agent behavior or retained history.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Bot Settings clearly separates the identity-focused Bot Profile from a Display section.
- [x] `Show tool calls` and `Show Thinking` both default off for every Bot.
- [x] Both values are stored by the daemon, exposed through the public Bot contract, and synchronized to other windows through the normal event stream.
- [x] A switch changes the current window optimistically and immediately affects the Bot's current output and all historical Threads.
- [x] A failed save restores the previous value and shows a non-blocking error rather than leaving windows inconsistent.
- [x] Hiding content changes only presentation; it never changes Agent configuration, event receipt, persistence, failure handling, or retention.
- [x] When no current Thinking support or retained Thinking exists, the Thinking switch is disabled with an explanation; retained Thinking keeps it usable even after capability loss.
- [x] API and browser coverage proves defaults, all-Thread scope, cross-window synchronization, immediate filtering, capability explanation, and rollback.

## Answer

The end-to-end slice is implemented: each Bot now has durable, synchronized display settings that immediately filter Tool Calls and Thinking across current and historical Threads without altering retained history or Agent behavior.
