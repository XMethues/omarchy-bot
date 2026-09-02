# 08: Archive and restore Bots safely

**What to build:** Let users remove a Bot from active navigation without losing it, stop hidden work deliberately, and restore the Bot later from Settings.

**Blocked by:** 02: Chat through a user-created Bot

**Status:** resolved

- [x] An idle Bot can be archived from its contextual menu and disappears from the normal Sidebar.
- [x] Archiving a working Bot requires confirmation that current work will stop.
- [x] Confirmed archive uses the Agent's native cancellation path and reaches a terminal turn state before hiding the Bot.
- [x] Cancelling the confirmation leaves the Bot and active work unchanged.
- [x] Archived Bots and their Threads remain intact and are listed in Settings.
- [x] Restoring a Bot returns it to normal recent-activity ordering.
- [x] Archiving or restoring a Bot never changes its Agent installation or other Bots using that Agent.
- [x] Opening the application falls back cleanly when the most recent Bot has been archived.
- [x] API integration and browser E2E tests cover idle archive, active archive, cancel, restore, and fallback selection.

## Answer

Implemented idle and confirmed-active archive flows, native turn cancellation with a terminal-state barrier before hiding, responsive confirmation UI, preserved Thread/Agent data, archive-driven draft cleanup and fallback selection, and a composable Settings surface for restoring archived Bots to normal recency ordering.

Validated with `bun run typecheck`, focused archive integration tests, the complete 61-test integration suite, and both archive/restore Playwright scenarios.
