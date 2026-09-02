# 08: Archive and restore Bots safely

**What to build:** Let users remove a Bot from active navigation without losing it, stop hidden work deliberately, and restore the Bot later from Settings.

**Blocked by:** 02: Chat through a user-created Bot

**Status:** ready-for-agent

- [ ] An idle Bot can be archived from its contextual menu and disappears from the normal Sidebar.
- [ ] Archiving a working Bot requires confirmation that current work will stop.
- [ ] Confirmed archive uses the Agent's native cancellation path and reaches a terminal turn state before hiding the Bot.
- [ ] Cancelling the confirmation leaves the Bot and active work unchanged.
- [ ] Archived Bots and their Threads remain intact and are listed in Settings.
- [ ] Restoring a Bot returns it to normal recent-activity ordering.
- [ ] Archiving or restoring a Bot never changes its Agent installation or other Bots using that Agent.
- [ ] Opening the application falls back cleanly when the most recent Bot has been archived.
- [ ] API integration and browser E2E tests cover idle archive, active archive, cancel, restore, and fallback selection.
