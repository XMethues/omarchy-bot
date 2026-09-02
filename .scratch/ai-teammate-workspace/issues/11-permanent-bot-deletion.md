# 11: Permanently delete Bot-owned data

**What to build:** Give users one truthful, confirmed permanent-delete operation for an archived Bot that removes all Omarchy Bot-owned data without modifying the referenced Agent installation.

**Blocked by:** 05: Send and revisit managed attachments; 07: Edit Bot Profiles and avatars; 08: Archive and restore Bots safely

**Status:** ready-for-agent

- [ ] Permanent deletion is available only for an archived Bot in Settings.
- [ ] Confirmation names the Bot and clearly states that its Threads and local managed data will be removed.
- [ ] Deletion removes the Bot, Threads, messages, local session mappings, drafts known to the current window, managed attachments, and uploaded avatar data.
- [ ] Deletion uses the Agent's tested native session deletion behavior when available and does not fabricate unsupported native operations.
- [ ] The operation never uninstalls, disables, or rewrites the referenced Agent or another Bot using it.
- [ ] Partial filesystem or native-session cleanup failure produces an honest recoverable result rather than reporting false success.
- [ ] Deleted Bots cannot reappear through event replay, startup selection, or stale drafts.
- [ ] API integration and browser E2E tests cover confirmation, cancellation, complete cleanup, shared-Agent safety, and partial failure.
