# 09: Surface background attention in the Sidebar

**What to build:** Turn the Sidebar into a quiet team-awareness surface with recent activity, pinning, accurate unread state, previews, and background desktop notifications.

**Blocked by:** 04: Navigate Thread history and preserve window drafts; 08: Archive and restore Bots safely

**Status:** resolved

- [x] Unpinned Bots sort by latest activity and pinned Bots remain above them.
- [x] Pin and unpin actions persist without changing Thread recency.
- [x] Each heading-free row shows a large avatar, Bot name, latest Agent-output excerpt, and relevant working/waiting/action-needed/error state.
- [x] Archived Bots do not appear in the active list.
- [x] A Bot becomes unread when new background output arrives.
- [x] Unread clears only after the user opens that Bot and reaches its latest message.
- [x] Remaining above the latest message preserves unread and offers a jump-to-latest action.
- [x] Background completion and action-needed states request desktop notification only when the window is unfocused or another Bot is selected.
- [x] Viewing the affected Bot in a focused window suppresses duplicate notifications.
- [x] Application startup selects the most recently active non-archived Bot.

## Answer

Implemented deterministic pinned/recent ordering, two-line Bot summaries backed only by the latest Agent output, persisted pin/read state, precise latest-message unread clearing, jump-to-latest behavior, replay-safe desktop notifications, and most-recent startup selection.

