# 02: Chat through a user-created Bot

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
- [x] API integration and browser E2E tests cover blank, sending, streaming, completed, and failed turns.
 
## Answer
 
Implemented the Bot conversation workspace and lazy Thread flow. URL search state owns Bot and Thread selection, startup and Bot changes resolve the most recent Thread, explicit `thread=blank` remains genuinely unpersisted until send, and refresh restores the selected conversation. The Astryx transcript renders ordered text, expandable collapsed Activity for persisted tool and native events, and final assistant text outside Activity. The Astryx Composer remains enabled during active work so a second send uses native steering; active paths contain no TopNav or permanent Stop control. Tool completion state and public native-event transcript records are persisted, while secret native payloads are redacted from transcript presentation.
 
Evidence:
 
- `bun run typecheck`: passed (`tsc --noEmit`, exit 0).
- `bun test tests/integration`: 24 passed, 0 failed, 136 assertions. Coverage proves atomic first-send creation, local title derivation, per-Thread native open/resume, ordered deltas, persisted completed tool/native Activity records, separate final text, failed-turn notes, native approval forwarding, and steering.
- `bun run --filter='@omarchy-bot/web' build`: passed; Vite transformed 2,263 modules and exited 0.
- `bunx playwright test -c tests/e2e`: 7 passed. `02-chat.spec.ts` proves abandoned blank state, lazy first send, visible streaming, completion and reload persistence, recent Thread reopening, collapsed/expandable Activity, inline failure, enabled steering, URL restoration, and absence of TopNav/Stop.
