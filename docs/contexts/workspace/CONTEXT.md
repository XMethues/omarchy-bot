# Workspace

The end-user context for creating AI teammates and working with them through conversations.

## Language

**Bot**:
A persistent assistant created and named by the user, with its own job instructions, configuration, and identity. Each Bot uses one Agent; multiple Bots may use the same Agent. Ambiguous legacy rows are conservatively treated as Bots until evidence permits another classification; enabled Agent inventory is never itself a Bot.
_Avoid_: Agent Bot, runtime Bot, Agent instance

**Bot Activity**:
Whether a Bot has at least one Active Turn in any of its Threads. A Bot is `active` or `inactive`; Agent readiness, selection, unreadness, and ambient avatar motion are separate concepts.
_Avoid_: Online status, presence, availability

**Bot Lifecycle**:
A Bot exists from creation until permanent deletion. It has no disabled or archived form.
_Avoid_: Bot enablement, archived Bot, offline Bot

**Bot Deletion**:
Irreversible removal of a Bot and the data Omarchy Bot owns for it. Agent-owned Native Sessions are outside this boundary.
_Avoid_: Archive, disable, Agent data erasure


**Bot Provenance**:
Internal evidence for why a persisted Bot exists: `user_created`, `legacy_conversation`, or `legacy_inventory`. Provenance makes migration conservative: only proven `legacy_inventory` rows may be removed, while ambiguous rows are preserved.
_Avoid_: Agent type, user-facing Bot category

**Bot Profile**:
The identity presented for a Bot: its editable name, job instructions, and avatar, plus the immutable Agent identity shown as read-only context. The avatar may be a locally uploaded image or an animated DiceBear avatar generated from a prompt interpreted by the Bot's Agent. Runtime readiness and technical diagnostics are settings, not editable profile fields.
_Avoid_: Role contract, capability manifest, editable Agent

**Bot Display Settings**:
Per-Bot preferences that control whether tool calls and Thinking are shown across all of the Bot's Threads. They affect presentation only: hidden content is still received and retained, and the preferences follow the Bot across application windows.
_Avoid_: Bot Profile, Agent permission, retention policy

**Bot Settings**:
The per-Bot configuration surface containing its Bot Profile and Bot Display Settings. The Profile remains the identity portion rather than a synonym for the whole surface.
_Avoid_: Bot Profile for the whole surface, Application Settings

**Avatar Recipe**:
A validated set of DiceBear style options for the application's sole current renderer. The Agent produces recipe data rather than executable SVG; Omarchy Bot renders it deterministically. Product upgrades replace recipes from retired renderers with deterministic current defaults.
_Avoid_: Agent-generated SVG, avatar capability, multiple active renderer versions

**Thread**:
A conversation between the user and one Bot. A Bot may have multiple Threads; selecting a Bot opens its most recently active Thread.
_Avoid_: Bot, Agent, task

**Response Block**:
One contiguous segment of Bot-authored text within a Turn. A Turn may contain several Response Blocks interleaved in their original order with Thinking Blocks, Tool Calls, Native Events, and Steering.
_Avoid_: Final answer, merged response, text delta

**Active Turn**:
A Turn that has not completed, been cancelled, or failed. Waiting for user input or computer access remains active.
_Avoid_: Online Bot, currently selected Thread

**Composer Draft**:
Unsent text and staged attachments belonging to one Thread within one application window. Switching Bots or Threads hides the draft without moving it; returning restores it. Drafts do not synchronize between windows.
_Avoid_: Message, shared Bot draft

**Steering**:
A user message sent while a Bot is working that redirects the active Agent session after its current atomic tool action reaches a safe boundary. Steering continues the same work context and replaces a dedicated Stop control.
_Avoid_: Follow-up, hard abort, queued chat
