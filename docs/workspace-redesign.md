# AI teammate workspace redesign

Status: implemented; design accepted on 2026-09-02

This document defines the accepted product and interaction design. Earlier architecture drafts remain research inputs only where they do not conflict with this specification.

## 1. Product model

### Bot and Agent

- A **Bot** is a persistent teammate created, named, and configured by the user.
- An **Agent** is a supported execution backend such as Pi, Claude, or Codex.
- Every Bot references one Agent. The reference cannot be changed after creation.
- Several Bots may reference the same Agent.
- Agents are not automatically rendered as Bots in the sidebar.
- A Bot's editable profile contains its name, Job/Instructions, and avatar.
- Updating Instructions affects future turns in every Thread belonging to that Bot. Existing messages remain unchanged.

### Migration boundary

- Enabled Agent inventory is never a Bot and is not migrated into the Sidebar.
- Migration creates or preserves Bots only for legacy rows with user-owned conversation, profile, or configuration data.
- Internal Bot provenance is `user_created`, `legacy_conversation`, or `legacy_inventory`.
- Only rows proven to be `legacy_inventory` may be deleted. Ambiguous rows are preserved.
- Migration is lossless for retained Threads, messages, attachments, profile data, and native-session mappings, including databases where an earlier migration is already marked applied.

### Native Agent behavior

- Omarchy Bot preserves each Agent's native capabilities and native approval behavior.
- It does not add an `ask`/`trusted` policy, capability filter, permission manifest, or parallel approval gate.
- Every adapter owns a compact `AgentCapabilityInventory` returned by the probe protocol and derived from the official interface plus conformance probes.
- The inventory is the sole support-policy source for steering, abort, session deletion, Thread actions, accepted attachment modalities, and native event families.
- Contextual native operations are shown and executed according to that inventory. Unsupported operations are rejected rather than simulated; Pi image input is not claimed while its provider conformance reports images unsupported.

## 2. Information architecture

There is no persistent global TopNav.

```text
┌──────────────────┬─────────────────────────────────────┐
│ Bot Sidebar      │ Conversation Header                 │
│                  ├─────────────────────────────────────┤
│                  │ Transcript                          │
│                  │                                     │
│ Settings         │ Composer                            │
└──────────────────┴─────────────────────────────────────┘
```

- The Sidebar is the global navigation surface.
- The main pane has a conversation-local Header, transcript, and Composer.
- On narrow screens the Sidebar becomes a drawer; the conversation Header supplies its opener.
- Opening the app selects the most recently active Bot, not the previously viewed Bot. That Bot opens its most recently active Thread.

## 3. Sidebar

The list has no visible section heading: the surrounding navigation already establishes the context. Each row represents one persistent Bot—user-created or conservatively preserved from legacy data—and never an enabled Agent-inventory entry. It shows:

- a large avatar with the Bot's display name;
- a one-line excerpt of that Bot's latest Agent output;
- unread state;
- one avatar activity marker when relevant.

Behavior:

- Bots sort by recent activity.
- Threads are never expanded beneath Bot rows.
- Opening a Bot and actually reaching its latest message clears unread. Merely selecting it while remaining above the latest message does not.
- Archived Bots are absent from the normal list.
- Settings is fixed at the bottom of the Sidebar.
- Per-Bot lifecycle actions are absent from rows; archiving is managed in Settings.

Desktop notifications are sent when a background Bot completes work or needs user action. They are suppressed while the user is already viewing that Bot in a focused window.

## 4. Bot creation and lifecycle
### Create Bot surfaces

Use one Astryx Dialog on desktop and one Astryx BottomSheet on narrow viewports.

Fields:

1. Name
2. Job/Instructions
3. Agent

The Agent picker lists every supported Agent. An unavailable Agent remains visible but disabled and includes plain-language setup guidance. Creation automatically selects the new Bot and opens a blank conversation.

### Profile editing

The Bot avatar and name form one Conversation Header button that opens a right-side drawer at every window width. The profile surface identifies the Bot's immutable Agent as read-only context. The user may edit the Bot's name, Instructions, and avatar. Changing execution backend means creating another Bot.

### Archive and delete

- Removing a Bot from active use archives it rather than deleting it.
- If it is working, confirmation explains that its active work will be stopped; confirmation stops the work and archives the Bot.
- Archived Bots can be restored from Settings → Archived Bots.
- Permanent deletion is available only from the archived-Bot surface and requires explicit confirmation.
- Archiving or deleting a Bot never changes the referenced Agent installation.

## 5. Avatars and activity motion

A Bot can use either:

- a locally uploaded image; or
- a deterministic animated DiceBear SVG Avatar Recipe.

Generated avatars use the application's sole renderer id `dicebear-core@10.7.0+styles@10.6.0` and DiceBear's native `animationVariant`. Each recipe stores its renderer id, style, seed, and validated options. Product upgrades replace recipes from retired or unsupported renderers with deterministic current defaults; the browser bundle does not ship legacy renderers.

In profile editing, the user may upload an image, choose another generated variation, or describe an avatar in a prompt. The Bot's selected Agent converts that prompt into a constrained Avatar Recipe. Omarchy Bot validates the recipe and renders DiceBear itself; Agent-produced SVG, HTML, scripts, and remote URLs are never rendered.

Motion is stateful and restrained:

- selected or working generated avatars use DiceBear's native internal `animationVariant` animation;
- uploaded images use the same container-level activity ring/state treatment;
- the assistant avatar in the transcript may animate while output is streaming and settles when the turn completes;
- idle, unselected avatars do not animate continuously;
- reduced-motion mode uses static state indicators.

## 6. Threads and history

- A Bot may own multiple Threads.
- Selecting a Bot opens its most recently active Thread.
- Clicking the conversation title opens a contextual history Dialog on desktop and BottomSheet on narrow viewports, containing New conversation, that Bot's recent Threads, and search.
- A new Thread has no hero, greeting, example prompts, or cards. Only the Composer is visible.
- A Thread is created lazily when its first message is sent so abandoned blank conversations do not pollute history.
- After the first send, a concise local title is derived from the first user message without an additional Agent call. The title can be changed where the active Agent/session integration supports the corresponding operation; display metadata remains distinct from claims about native session mutation.
- Native Thread actions such as resume, rename, delete, fork, or compact follow the selected Agent adapter's tested capability inventory and native data-management method.

## 7. Composer

The Composer supports:

- text;
- local files;
- images;
- Voxtype dictation.

Enter sends; Shift+Enter inserts a newline. Sending while the Bot is working uses native steering rather than aborting and restarting the turn. The redirected instruction is applied after the Agent reaches a safe boundary following its current atomic action. There is no permanent Stop button in the Composer.

### Window-scoped drafts

- Unsent text and staged attachments belong to one Thread.
- Switching Bot or Thread hides that draft; returning restores it.
- Drafts are scoped to the current application window and are not synchronized to other windows.
- The same window can restore its draft after refresh; closing it clears the draft.
- A transcript or attachment must never move to whichever Bot happens to be selected later.

### Attachments

- Selecting or dropping a file creates a local managed copy.
- Sent attachments remain associated with the Thread so history can render and the Agent can access the same snapshot later.
- Images render inline previews; other files render compact attachment rows.
- Permanent deletion of the owning data removes managed copies.
- Files remain local and are not uploaded to a cloud service by Omarchy Bot.
- The attachment service accepts a send only when the selected Bot's probed `AgentCapabilityInventory` claims that attachment modality. Unsupported modalities are rejected contextually and are neither transformed nor forwarded.

## 8. Voice input

Voice is an input method, not an audio-message transport.

### Default behavior

1. Clicking the microphone starts Voxtype recording.
2. Clicking again stops recording and enters a transcribing state.
3. The resulting text is inserted into the originating Composer draft at its insertion point.
4. Existing text is preserved.
5. The user may review or edit the transcript and presses Send explicitly, matching the observed Grok Bot behavior.
Escape cancels recording. Empty speech or failure leaves the draft unchanged. Raw audio is not uploaded, attached, or retained by Omarchy Bot.

### Optional auto-send

Settings → Voice includes **Auto-send voice transcriptions**, off by default. When enabled, a successful transcript is inserted and then sent through the originating Thread's normal command path. During active work it becomes steering. Empty or failed transcription is never sent.

The microphone integration uses Voxtype's stable file-output contract through the localhost daemon:

```text
record start --file=<runtime-file> --no-auto-submit --no-smart-auto-submit
record stop --wait --json --wait-file <runtime-file>
```

The app does not depend on Voxtype's synthetic Return because file output bypasses the typing/paste auto-submit chain and synthetic input could target the wrong conversation. Omarchy's normal Voxtype shortcuts remain untouched and continue typing into the focused control.

## 9. Transcript and activity

- User and assistant text remain the visual focus.
- Tool calls, intermediate steps, and Agent-native events collapse into one compact Activity presentation by default.
- Activity can be expanded to inspect details.
- The final answer is never buried inside the Activity surface.
- Unsupported native event types are retained through typed/raw native envelopes rather than silently discarded.
- Streaming follows the latest content only while the user is already at the bottom. Scrolling upward is never overridden; a quiet jump-to-latest action appears instead.
- Errors appear inline at the turn where they occurred with plain-language recovery. Technical diagnostics live in details, not in the primary transcript.

## 10. Computer

The current implementation has one real Omarchy screen shared by all Bots and the user.

- Keep one invisible global input arbiter so clicks and typing cannot interleave.
- Do not show lease holders, TTLs, queue depth, or engineering diagnostics in normal UI.
- A Computer glyph is always present in the Conversation Header. It is visually quiet while inactive and gains state only while the Bot is using the computer or needs human input.
- The glyph toggles a docked Computer drawer on desktop and opens an Astryx BottomSheet on narrow viewports, with a live preview and plain-language activity.
- Selecting the preview's expand icon opens the desktop image in an Astryx Lightbox modal.
- Show **Take control** only when human input is relevant.
- While the user controls the screen, show **Return to Bot**; re-observe before resuming automation.
- Emergency control is never permanent idle Sidebar chrome. It is immediately available while computer input is active and remains available in the stopped state so the user can deliberately resume.
- The arbiter coordinates the shared input seat; it does not approve or filter Agent capabilities.

Independent per-Bot screens remain the required future architecture for true parallel desktop operation. Hyprland workspaces alone are not sufficient isolation.

## 11. Settings

Settings opens from the bottom of the Sidebar and includes at least:

- Voice, including Auto-send voice transcriptions;
- Archived Bots, including restore and permanent deletion;
- Appearance, showing that theme follows the current Omarchy/system preference;
- contextual setup guidance for unavailable local integrations.

## 12. Visual system

- Direction: future, energetic, and fresh without looking like a generic AI template.
- Information architecture may reference Grok Bot, but visual styling does not copy it.
- Use cool neutral surfaces with one lively blue accent.
- Support light and dark modes and follow Omarchy/system preference.
- Favor whitespace and hierarchy over cards; avoid dashboard density.
- Use consistent soft radii and restrained borders.
- Avoid neon, glassmorphism, purple AI gradients, excessive pills, decorative charts, and permanent ambient animation.
- The blank Thread remains genuinely blank rather than becoming a landing-page hero.
- Respect reduced motion, keyboard navigation, visible focus, semantic labels, and sufficient contrast.
- Give each meaningful Bot avatar an accessible label derived from the Bot name; hide purely decorative duplicates from assistive technology.

Use Astryx components discovered through its CLI, especially SideNav, Layout, ChatMessageList, ChatComposer, Dialog, BottomSheet, SelectableCard, and Avatar. Extend composition and tokens where needed; do not recreate existing primitives by hand.

## 13. Conformance boundary

The implementation preserves one public model across domain types, persistence, daemon APIs, worker adapters, and the web workspace. Migration coverage must prove that retained user-owned conversations keep their Bot, Thread, message, attachment, profile, avatar recipe, and native-session data; inventory-only rows are removed only from proven provenance, and ambiguous rows remain. API and worker tests exercise public protocols. Browser E2E policy is role-first: interact through accessible roles and visible names, using test ids only where no semantic seam exists, and never couple assertions to CSS classes or component internals. No validation count is part of this design authority.
