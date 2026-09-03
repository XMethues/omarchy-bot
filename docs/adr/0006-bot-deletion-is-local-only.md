# Bot deletion removes only Omarchy Bot data

Status: accepted

Permanent Bot deletion owns only data managed by Omarchy Bot: the Bot, Threads, messages, Turns, attachments, avatar files, and local Agent-session mappings. Agent-owned Native Sessions are outside this boundary and survive deletion. The confirmation must say that deleting a Bot is not an Agent-data privacy erase.

This boundary is deliberately simpler than capability-dependent native cleanup. The only production Agent, Pi, cannot delete Native Sessions, while future Agents may use different storage and deletion semantics. Omarchy Bot therefore does not expose or call `session.delete`, advertise native session deletion in `AgentCapabilityInventory`, or retain native-deletion retry checkpoints.

Bots have no archived or disabled lifecycle state. Delete is available directly from the Sidebar context menu and Settings; deleting an active Bot first cancels every Active Turn and waits for terminal state. Existing archived Bots return to normal visibility rather than being deleted silently.

This decision supersedes the session-deletion portion of [Agent Integration ADR 0003](../contexts/agent-integration/adr/0003-preserve-native-agent-capabilities.md) and the archive prerequisite and native-cleanup requirements recorded in `.scratch/ai-teammate-workspace/issues/08-archive-and-restore-bots.md` and `.scratch/ai-teammate-workspace/issues/11-permanent-bot-deletion.md`.