# 01: Separate Agents from user-created Bots

**What to build:** Replace the fixed Agent-shaped Bot list with a complete user flow that discovers Agents separately, migrates existing conversations into user-created Bots, lets the user create another Bot from a simple Sheet, and shows only intentionally created Bots in the Sidebar.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Starting from a representative legacy database preserves existing Threads and messages while migrating only Agent records with user-owned content or configuration into Bots.
- [x] Empty built-in Agent inventory records remain Agents and never become Sidebar Bots; repeat startup is idempotent.
- [x] The Agent API lists every supported Agent with installation, readiness, version, and plain-language unavailability guidance.
- [x] The Bot API creates a Bot from Name, Job/Instructions, and an available Agent and rejects invalid or unavailable selections clearly.
- [x] Multiple Bots can reference the same Agent and receive independent Bot identifiers.
- [x] A Bot's Agent reference cannot be changed through the edit contract.
- [x] The Sidebar renders user-created Bots rather than one row per supported Agent.
- [x] The creation Sheet uses Astryx primitives, selects the new Bot on success, and opens a blank conversation.
- [x] API integration and browser E2E tests prove the migration and creation flow through public behavior.
 
## Answer
 
Implemented the Agent/Bot split end to end. Migration `0002-user-created-bots` creates separate Agent records while converting only legacy records with conversations or user configuration into Bots; migration `0005-created-bots-animated-avatars` removes empty inventory placeholders created by the earlier broad migration. Legacy Threads and native sessions are rewired without message loss, and repeat startup remains idempotent. The public Agent and Bot APIs expose readiness guidance, validate creation, preserve fixed Agent ownership, and allow multiple independent Bots per Agent. The web app uses an Astryx `AppShell` with a Bot-only `Sidebar` and an Astryx Create Bot `Dialog`; successful creation selects the new Bot and opens `thread=blank`.
 
Evidence:
 
- `bun run typecheck` and `bun run build`: passed.
- `bun test tests/integration`: 74 passed, including both fresh-legacy and already-migrated database coverage proving empty Agent inventory placeholders are absent while user-owned data survives.
- `bun run test:e2e`: 44 passed; `01-create-bot.spec.ts` proves the empty Sidebar, readiness guidance, disabled unavailable Agents, selection into a blank conversation, and independent rows for multiple user-created Bots on one Agent.
