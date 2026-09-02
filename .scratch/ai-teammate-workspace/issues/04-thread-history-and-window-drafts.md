# 04: Navigate Thread history and preserve window drafts

**What to build:** Give each Bot contextual multi-Thread history while keeping unsent Composer content isolated per Thread and per application window.

**Blocked by:** 02: Chat through a user-created Bot

**Status:** resolved

- [x] Clicking the conversation title opens an Astryx history Sheet for the selected Bot.
- [x] The Sheet lists recent Threads, searches within that Bot, and offers New conversation.
- [x] Selecting a Bot opens its most recently active Thread.
- [x] New conversation opens a blank Composer without persisting a Thread before first send.
- [x] Thread titles are derived locally from the first user message and can be updated only through truthful supported behavior.
- [x] Unsent text is keyed by Thread or temporary blank-conversation identity within one application window.
- [x] Switching Bots or Threads hides a draft and returning restores it without crossing conversation boundaries.
- [x] Refreshing the same window restores drafts, while another window does not receive them.
- [x] Deleting or archiving owning data cannot cause a stale draft to appear under another Bot.
- [x] API integration and browser E2E tests cover ordering, search, lazy creation, switching, refresh, and window isolation.

## Answer

Implemented contextual Thread history, search, lazy first-send creation, latest-Thread selection, truthful Pi rename conflicts, and versioned window-local draft persistence. Archive fallback clears drafts even when lifecycle changes arrive through the API; the Sidebar also clears them immediately after a successful archive. Validated with focused integration coverage, the complete 61-test integration suite, and all three Thread/draft Playwright scenarios.
