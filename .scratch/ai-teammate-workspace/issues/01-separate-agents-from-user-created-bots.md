# 01: Separate Agents from user-created Bots

**What to build:** Replace the fixed Agent-shaped Bot list with a complete user flow that discovers Agents separately, migrates existing conversations into user-created Bots, lets the user create another Bot from a simple Sheet, and shows only intentionally created Bots in the Sidebar.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Starting from a representative legacy database preserves existing Threads and messages while creating separate Agent and Bot records.
- [x] Starting again after migration is idempotent and does not duplicate Agents, Bots, Threads, or messages.
- [x] The Agent API lists every supported Agent with installation, readiness, version, and plain-language unavailability guidance.
- [x] The Bot API creates a Bot from Name, Job/Instructions, and an available Agent and rejects invalid or unavailable selections clearly.
- [x] Multiple Bots can reference the same Agent and receive independent Bot identifiers.
- [x] A Bot's Agent reference cannot be changed through the edit contract.
- [x] The Sidebar renders user-created Bots rather than one row per supported Agent.
- [x] The creation Sheet uses Astryx primitives, selects the new Bot on success, and opens a blank conversation.
- [x] API integration and browser E2E tests prove the migration and creation flow through public behavior.
 
## Answer
 
Implemented the Agent/Bot split end to end. Migration `0002-user-created-bots` creates separate Agent and user-created Bot records, rewires legacy Threads and native sessions without message loss, and remains idempotent. The public Agent and Bot APIs expose readiness guidance, validate creation, preserve fixed Agent ownership, and allow multiple independent Bots per Agent. The web app now uses an Astryx `AppShell` with a Bot-only `Sidebar` and an Astryx Create Bot `Dialog`; successful creation refreshes the Bot query, selects the created Bot, and sets `thread=blank`.
 
Evidence:
 
- `bun run typecheck`: passed (`tsc --noEmit`, exit 0).
- `bun test tests/integration`: 24 passed, 0 failed, 136 assertions. This includes the representative legacy migration/idempotency test, all-nine-Agent readiness API coverage, unavailable and invalid Bot creation rejection, independent same-Agent Bot IDs, and immutable `agentId`.
- `bun run --filter='@omarchy-bot/web' build`: passed; Vite transformed 2,263 modules and exited 0.
- `bunx playwright test -c tests/e2e`: 7 passed. `01-create-bot.spec.ts` proves readiness guidance, disabled unavailable Agents, inline validation, selection into a blank conversation, and independent Sidebar rows for same-Agent Bots.
