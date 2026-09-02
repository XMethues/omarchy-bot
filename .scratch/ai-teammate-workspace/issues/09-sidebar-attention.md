# 09: Surface background attention in the Sidebar

**What to build:** Turn the Sidebar into a quiet team-awareness surface with recent activity, pinning, accurate unread state, previews, and background desktop notifications.

**Blocked by:** 04: Navigate Thread history and preserve window drafts; 08: Archive and restore Bots safely

**Status:** ready-for-agent

- [ ] Unpinned Bots sort by latest activity and pinned Bots remain above them.
- [ ] Pin and unpin actions persist without changing Thread recency.
- [ ] Each row shows avatar, name, latest useful preview, relative time, and relevant working/waiting/action-needed/error state.
- [ ] Archived Bots do not appear in the active list.
- [ ] A Bot becomes unread when new background output arrives.
- [ ] Unread clears only after the user opens that Bot and reaches its latest message.
- [ ] Remaining above the latest message preserves unread and offers a jump-to-latest action.
- [ ] Background completion and action-needed states request desktop notification only when the window is unfocused or another Bot is selected.
- [ ] Viewing the affected Bot in a focused window suppresses duplicate notifications.
- [ ] Application startup selects the most recently active non-archived Bot.
- [ ] API integration and browser E2E tests cover ordering, pins, previews, unread boundaries, startup, and notification suppression.
