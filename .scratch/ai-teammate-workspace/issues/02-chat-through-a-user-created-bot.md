# 02: Chat through a user-created Bot

> The Activity-specific acceptance criteria and implementation recorded here are historical and are superseded by [Ordered rich transcript](../../ordered-rich-transcript/spec.md). This ticket remains resolved evidence of the slice it originally delivered.

**What to build:** Make one migrated or newly created Bot usable as a teammate: selecting it opens a blank or recent Thread, the first send creates the Thread, Pi answers through its native session, Activity stays compact, and the final answer remains the focus of the conversation workspace.

**Blocked by:** 01: Separate Agents from user-created Bots

**Status:** resolved

- [x] Selecting a Bot opens its most recent Thread or a genuinely blank Composer when it has none.
- [x] An abandoned blank conversation creates no persisted Thread.
- [x] The first successful send atomically creates a Thread and user message and derives a concise local title.
- [x] The Bot's Agent opens or resumes an independent native session for that Thread.
- [x] Pi streams text and structured tool/native events through the existing ordered event connection.
- [x] Tool calls and intermediate events render as one collapsed Activity surface that can be expanded.
- [x] Final assistant text is visually separate from Activity and persists in history.
- [x] The active Agent follows its native approval behavior; the legacy omarchy-bot Agent permission gate is not on this path.
- [x] The page uses Sidebar, conversation Header, transcript, and Composer with no global TopNav.
 
## Answer
 
Implemented the Bot conversation workspace and lazy Thread flow. URL search state owns Bot and Thread selection, startup and Bot changes resolve the most recent Thread, explicit `thread=blank` remains genuinely unpersisted until send, and refresh restores the selected conversation. The Astryx transcript renders ordered text, expandable collapsed Activity for persisted tool and native events, and final assistant text outside Activity. The Astryx Composer remains enabled during active work so a second send uses native steering; active paths contain no TopNav or permanent Stop control. Tool completion state and public native-event transcript records are persisted, while secret native payloads are redacted from transcript presentation.
 
