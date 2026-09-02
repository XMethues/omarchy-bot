# 02: Chat through a user-created Bot

**What to build:** Make one migrated or newly created Bot usable as a teammate: selecting it opens a blank or recent Thread, the first send creates the Thread, Pi answers through its native session, Activity stays compact, and the final answer remains the focus of the conversation workspace.

**Blocked by:** 01: Separate Agents from user-created Bots

**Status:** ready-for-agent

- [ ] Selecting a Bot opens its most recent Thread or a genuinely blank Composer when it has none.
- [ ] An abandoned blank conversation creates no persisted Thread.
- [ ] The first successful send atomically creates a Thread and user message and derives a concise local title.
- [ ] The Bot's Agent opens or resumes an independent native session for that Thread.
- [ ] Pi streams text and structured tool/native events through the existing ordered event connection.
- [ ] Tool calls and intermediate events render as one collapsed Activity surface that can be expanded.
- [ ] Final assistant text is visually separate from Activity and persists in history.
- [ ] The active Agent follows its native approval behavior; the legacy omarchy-bot Agent permission gate is not on this path.
- [ ] The page uses Sidebar, conversation Header, transcript, and Composer with no global TopNav.
- [ ] API integration and browser E2E tests cover blank, sending, streaming, completed, and failed turns.
