# 01: Separate Agents from user-created Bots

**What to build:** Replace the fixed Agent-shaped Bot list with a complete user flow that discovers Agents separately, conservatively preserves legacy user-owned Bot data, lets the user create another Bot from a desktop Dialog or narrow BottomSheet, and shows no enabled Agent inventory as a Sidebar Bot.

**Blocked by:** None (can start immediately)

**Status:** resolved

- [x] Starting from representative legacy databases preserves Threads, messages, attachments, profiles, avatar recipes, and native sessions while migrating only rows with user-owned conversation, profile, or configuration data into Bots.
- [x] Internal provenance records `user_created`, `legacy_conversation`, or `legacy_inventory`; only proven inventory is removed, ambiguous rows are preserved, and repeat startup is idempotent even when the earlier migration is already marked applied.
- [x] The Agent API lists every supported Agent with installation, readiness, version, and plain-language unavailability guidance.
- [x] The Bot API creates a Bot from Name, Job/Instructions, and an available Agent and rejects invalid or unavailable selections clearly.
- [x] Multiple Bots can reference the same Agent and receive independent Bot identifiers.
- [x] A Bot's Agent reference cannot be changed through the edit contract.
- [x] The Sidebar renders persistent user-created or conservatively preserved Bots, never one row per supported Agent.
- [x] Creation uses an Astryx Dialog on desktop and BottomSheet on narrow viewports, selects the new Bot on success, and opens a blank conversation.
 
## Answer
 
Implemented the Agent/Bot split end to end. The Agent registry is independent from persistent Bots, and enabled Agent inventory is never a Bot. Forward migration records provenance, preserves ambiguous and user-owned rows, removes only proven legacy inventory, and keeps retained Threads, messages, attachments, profiles, avatar recipes, and native sessions losslessly. The public Agent and Bot APIs expose readiness guidance, validate creation, preserve fixed Agent identity, and allow multiple independent Bots per Agent. The web app uses a Bot-only Sidebar with responsive Create surfaces and selects a successfully created Bot into a blank conversation.
