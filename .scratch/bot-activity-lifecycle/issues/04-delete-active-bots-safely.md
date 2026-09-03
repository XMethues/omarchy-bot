# 04: Delete active Bots safely

**What to build:** Let users delete a working or waiting Bot without leaving hidden work by stopping every Active Turn before the shared local deletion operation runs.

**Blocked by:** 03: Delete inactive Bots locally

**Status:** resolved

- [x] Deleting a Bot with any Active Turn adds a clear warning that all of that Bot's current work will stop.
- [x] Cancelling the warning leaves every Turn and the Bot unchanged.
- [x] Confirming deletion cancels every Active Turn across all Threads through the existing native cancellation behavior.
- [x] Cleanup does not begin until every affected Turn reaches completed, cancelled, or failed.
- [x] Waiting for user input and waiting for computer access are included in the active-work barrier.
- [x] Concurrent Active Turns are all handled; one terminal Thread never allows another active Thread to survive deletion.
- [x] Cancellation or terminal-barrier failure keeps the Bot visible and returns an honest retryable result.
- [x] Once all Turns are terminal, the operation reuses the local-only cleanup and navigation behavior delivered by ticket 03.
- [x] The Agent and Agent-owned Native Sessions remain untouched beyond the native Turn cancellation needed to stop current work.
- [x] Daemon HTTP integration coverage proves cancellation, concurrent Turn handling, terminal ordering, barrier failure, and final cleanup.
- [x] Playwright coverage proves the active-work warning, cancel-without-effects path, confirmed stop, and eventual removal from both delete entry points.

## Answer

Active deletion now claims the Bot against new work, cancels every nonterminal Turn across all Threads, and waits for the complete terminal barrier before local cleanup. Barrier failures retain the Bot and its data for an honest retry.