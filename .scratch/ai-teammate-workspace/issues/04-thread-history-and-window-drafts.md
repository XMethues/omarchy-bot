# 04: Navigate Thread history and preserve window drafts

**What to build:** Give each Bot contextual multi-Thread history while keeping unsent Composer content isolated per Thread and per application window.

**Blocked by:** 02: Chat through a user-created Bot

**Status:** ready-for-agent

- [ ] Clicking the conversation title opens an Astryx history Sheet for the selected Bot.
- [ ] The Sheet lists recent Threads, searches within that Bot, and offers New conversation.
- [ ] Selecting a Bot opens its most recently active Thread.
- [ ] New conversation opens a blank Composer without persisting a Thread before first send.
- [ ] Thread titles are derived locally from the first user message and can be updated only through truthful supported behavior.
- [ ] Unsent text is keyed by Thread or temporary blank-conversation identity within one application window.
- [ ] Switching Bots or Threads hides a draft and returning restores it without crossing conversation boundaries.
- [ ] Refreshing the same window restores drafts, while another window does not receive them.
- [ ] Deleting or archiving owning data cannot cause a stale draft to appear under another Bot.
- [ ] API integration and browser E2E tests cover ordering, search, lazy creation, switching, refresh, and window isolation.
