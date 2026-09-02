# Workspace

The end-user context for creating AI teammates and working with them through conversations.

## Language

**Bot**:
A persistent assistant created and named by the user, with its own job instructions, configuration, and identity. Each Bot uses one Agent; multiple Bots may use the same Agent.
_Avoid_: Agent Bot, runtime Bot, Agent instance

**Bot Profile**:
The user-authored identity of a Bot: its name, job instructions, and avatar. The avatar may be a locally uploaded image or an animated DiceBear avatar generated from a prompt interpreted by the Bot's Agent. Runtime choices and technical diagnostics are settings, not profile fields.
_Avoid_: Role contract, capability manifest

**Avatar Recipe**:
A validated, versioned set of DiceBear style options produced from a user's visual prompt. The Agent produces recipe data rather than executable SVG; Omarchy Bot renders and stores the avatar deterministically.
_Avoid_: Agent-generated SVG, avatar capability

**Thread**:
A conversation between the user and one Bot. A Bot may have multiple Threads; selecting a Bot opens its most recently active Thread.
_Avoid_: Bot, Agent, task

**Composer Draft**:
Unsent text and staged attachments belonging to one Thread within one application window. Switching Bots or Threads hides the draft without moving it; returning restores it. Drafts do not synchronize between windows.
_Avoid_: Message, shared Bot draft

**Steering**:
A user message sent while a Bot is working that redirects the active Agent session after its current atomic tool action reaches a safe boundary. Steering continues the same work context and replaces a dedicated Stop control.
_Avoid_: Follow-up, hard abort, queued chat
