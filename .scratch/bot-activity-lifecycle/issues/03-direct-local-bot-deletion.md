# 03: Delete inactive Bots locally

**What to build:** Let users permanently delete an inactive Bot directly from the Sidebar or Settings, removing the data Omarchy Bot owns while leaving the Agent and its Native Sessions untouched.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Mouse right-click on a Sidebar Bot opens a menu containing Edit Profile and a final red Delete item, in that order.
- [x] The Sidebar menu has no hover ellipsis or keyboard trigger in this release.
- [x] The existing conversation Header Profile entry remains and opens the same profile surface as Edit Profile.
- [x] Settings exposes the same permanent Delete operation for each inactive Bot.
- [x] Both entry points use one ordinary confirmation that names the Bot and does not require typed-name input.
- [x] Confirmation states which Omarchy Bot conversation and file data will be removed and that Agent-owned Native Sessions may remain.
- [x] Confirmed deletion removes the inactive Bot's Threads, messages, Turns, managed attachments, uploaded avatar data, drafts known to the current window, events, state, leases, and local Agent-session mappings.
- [x] Deletion never acquires an Agent worker, mutates the shared Agent, removes Agent-owned data, or affects another Bot.
- [x] Deletion succeeds regardless of Agent Readiness.
- [x] Cancelling confirmation leaves all data unchanged.
- [x] Local file or database cleanup failure produces an honest retryable result and never reports false success.
- [x] Successful deletion evicts stale Bot, Thread, message, and draft state and falls back to another Bot or the empty workspace when necessary.
- [x] The existing archive and restore path remains operational until its dedicated contraction ticket lands.
- [x] Daemon HTTP integration coverage proves owned-data cleanup, shared-Agent and sibling-Bot survival, non-ready Agent deletion, local failure, and retry.
- [x] Playwright coverage proves both entry points, confirmation, cancellation, success, and navigation fallback.

## Answer

Inactive Bots now use one permanent, local-only deletion flow from the pointer-only Sidebar menu and Settings. The flow truthfully preserves Agent-owned Native Sessions, retries local failures, clears current-window projections and drafts, and recovers navigation deterministically.