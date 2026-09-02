# 09: Surface background attention in the Sidebar

**What to build:** Turn the Sidebar into a quiet team-awareness surface with recent activity, pinning, accurate unread state, previews, and background desktop notifications.

**Blocked by:** 04: Navigate Thread history and preserve window drafts; 08: Archive and restore Bots safely

**Status:** resolved

- [x] Unpinned Bots sort by latest activity and pinned Bots remain above them.
- [x] Pin and unpin actions persist without changing Thread recency.
- [x] Each row shows avatar, name, latest useful preview, relative time, and relevant working/waiting/action-needed/error state.
- [x] Archived Bots do not appear in the active list.
- [x] A Bot becomes unread when new background output arrives.
- [x] Unread clears only after the user opens that Bot and reaches its latest message.
- [x] Remaining above the latest message preserves unread and offers a jump-to-latest action.
- [x] Background completion and action-needed states request desktop notification only when the window is unfocused or another Bot is selected.
- [x] Viewing the affected Bot in a focused window suppresses duplicate notifications.
- [x] Application startup selects the most recently active non-archived Bot.
- [x] API integration and browser E2E tests cover ordering, pins, previews, unread boundaries, startup, and notification suppression.

## Answer

Implemented deterministic pinned/recent ordering, previews and relative activity, persisted pin/read state, precise latest-message unread clearing, jump-to-latest behavior, replay-safe desktop notifications, and most-recent startup selection.

Validated with `bun run typecheck`, the focused attachment/attention integration run (10 tests), the complete 71-test integration suite, production build, and all three Sidebar-attention Playwright scenarios.
