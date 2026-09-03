# Bot activity is binary and independent of Agent readiness

Status: accepted

A persistent Bot is either `active` when at least one of its Threads has an Active Turn, or `inactive` otherwise. Waiting for user input or computer access remains active; completion, cancellation, and failure are terminal. Agent Readiness, current selection, unread attention, and ambient avatar motion are separate signals and must not introduce `unavailable`, `error`, `waiting`, or similar values into Bot activity.

This replaces the former six-value Bot activity projection because it mixed execution, attention, failure, and Agent health into one public field. The public Bot activity contract is now strictly `active | inactive`; detailed Turn state and contextual errors remain available at their own boundaries. The Sidebar may aggregate activity across all Threads, while a conversation-level activity marker reflects only the selected Thread.

This decision supersedes the activity-state and motion coupling in [Workspace ADR 0005](../contexts/workspace/adr/0005-prompt-authored-bot-avatars.md). DiceBear animation in the Sidebar is ambient identity motion rather than activity; a separate activity point carries the binary state. Historical Bot messages have no avatar, and the selected Thread has one transient working avatar below its live output until the Turn becomes terminal.