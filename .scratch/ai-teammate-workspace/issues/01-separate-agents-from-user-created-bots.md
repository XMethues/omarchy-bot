# 01: Separate Agents from user-created Bots

**What to build:** Replace the fixed Agent-shaped Bot list with a complete user flow that discovers Agents separately, migrates existing conversations into user-created Bots, lets the user create another Bot from a simple Sheet, and shows only intentionally created Bots in the Sidebar.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Starting from a representative legacy database preserves existing Threads and messages while creating separate Agent and Bot records.
- [ ] Starting again after migration is idempotent and does not duplicate Agents, Bots, Threads, or messages.
- [ ] The Agent API lists every supported Agent with installation, readiness, version, and plain-language unavailability guidance.
- [ ] The Bot API creates a Bot from Name, Job/Instructions, and an available Agent and rejects invalid or unavailable selections clearly.
- [ ] Multiple Bots can reference the same Agent and receive independent Bot identifiers.
- [ ] A Bot's Agent reference cannot be changed through the edit contract.
- [ ] The Sidebar renders user-created Bots rather than one row per supported Agent.
- [ ] The creation Sheet uses Astryx primitives, selects the new Bot on success, and opens a blank conversation.
- [ ] API integration and browser E2E tests prove the migration and creation flow through public behavior.
