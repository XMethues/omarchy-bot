# AI teammate workspace redesign

Status: accepted product design; the Shared Workspace and plugin-boundary revision was confirmed on 2026-09-05. Implementation gaps below now distinguish landed runtime work from the still-open human host-acceptance gate.

This document defines the accepted product and interaction design. Omarchy Bot is an Omarchy plugin inspired by Grok Bot's user-created teammates, not a generic coding dashboard or a second full desktop session; earlier drafts and feature tickets are authoritative only where they agree with this specification and [ADR 0009](adr/0009-share-work-files-isolate-bot-screens.md). Historical specifications and their still-valid homes are accounted in [the requirement map](../.scratch/shared-workspace-desktop-boundary/requirement-map.md).

> Bot activity, avatar activity presentation, archive/restore, and permanent-deletion decisions are superseded by [Binary Bot activity and direct deletion](../.scratch/bot-activity-lifecycle/spec.md). Transcript Activity, message rendering, and Agent-output structure are superseded by [Ordered rich transcript](../.scratch/ordered-rich-transcript/spec.md) and [ADR 0007](./adr/0007-preserve-ordered-agent-blocks.md).

## 1. Product model

### Bot and Agent

- A **Bot** is a persistent teammate created, named, and configured by the user.
- An **Agent** is a supported execution backend such as Pi, Claude, or Codex.
- Every Bot references one Agent. The reference cannot be changed after creation.
- Several Bots may reference the same Agent.
- Agents are not automatically rendered as Bots in the sidebar.
- A Bot's editable profile contains its name, Job/Instructions, and avatar.
- Updating Instructions affects future turns in every Thread belonging to that Bot. Existing messages remain unchanged.

### Shared Workspace and plugin boundary

All Bots default to the same `~/.omarchy-bot/workspace/` under the user's home directory, not `/workspace` at the filesystem root and not the plugin's checkout, installation, or daemon launch directory. A Bot's Threads share this default; a new conversation, another Agent, or another Bot Screen does not allocate a separate work-file space. It is an ordinary working directory, not a required Git repository, a file-access sandbox, or a mechanism that overrides an Agent's native ability to work elsewhere.

```text
Omarchy user
  ├─ Shared Workspace: work files common to all Bots
  └─ user-created Bots
       └─ each Bot
            ├─ one Agent reference (many Bots may use that Agent)
            ├─ many Threads → Agent-owned Native Sessions
            └─ one Bot Screen identity
                 └─ on-demand Bot Desktop Session → application windows
                      ↑
                 Screen Projection from the selected client view

Host Session: the user's original Omarchy desktop, separate from Bot Screens
```

| Concern | Owner and boundary |
| --- | --- |
| Default working directory | The plugin provides the Shared Workspace default; it never implicitly falls back to its own source or installation directory. |
| Work files and concurrent edits | The user, Agents, and their tools manage their work. The plugin does not add file locks, task locks, Git worktrees, repository management, or file-authorship tracking. |
| Bot and conversation data | The plugin owns Bot identity, Threads, messages, local session mappings, and explicitly managed media. These are not the Shared Workspace. |
| Native Session | The Agent owns conversation execution state. It is not a graphical session or a viewer connection. |
| Bot desktop infrastructure | The plugin owns Screen identity, on-demand session processes, private display endpoints, capture, routed input, and same-Screen human handoff. |
| Applications | Agents and applications retain native behavior. Browser selection, profile layout, Cookies, logins, and cross-Bot application-state sharing are not responsibilities of this desktop design. |
| Deletion | Deleting a Bot removes its plugin-owned records and desktop runtime, not shared work files, Agent-owned Native Sessions, or arbitrary application data. |

`~/.omarchy-bot/memory/` is a future directory intention, not an implemented memory feature or a decision about memory semantics. This revision does not relocate existing databases, managed attachments, avatars, or other product data.

Changes is removed from the accepted interface and its backing product capability, not merely hidden. No review workflow or work-artifact panel replaces it. The Computer Surface remains the desktop observation/control entry; this correction does not add an arbitrary-URL webview or adopt a coding-workspace information architecture.

### Implementation gaps in the 2026-09-05 revision

Implementation is tracked by the [Shared Workspace and Bot Desktop Boundary Correction specification](../.scratch/shared-workspace-desktop-boundary/spec.md), including automated, real-runtime, and mandatory user experience acceptance.

- **Shared Workspace default implemented:** implicit Agent sessions and supported application launches use `~/.omarchy-bot/workspace` under the live user home. Explicit Thread cwd values are unchanged. Native `session.resume` still only proves the daemon supplied cwd, not that a backend relocated an existing Native Session.
- **Changes removed:** the Changes UI, Git summary/detail service, public endpoints, and client methods are gone. Retired `/api/bots/:id/changes` routes return ordinary missing-interface 404s.
- **Screen startup repaired; production compositor is Sway:** output configuration is retried while the compositor is alive, and projection `releaseInput` / snapshot capture no longer destroy a ready desktop. Public state exposes the failing stage. Computer ADR 0009 is the production stack. Prior top-bar/shortcut breakage was not shown to share the historical Cage startup cause.
- **Unused-Bot cost recorded; selected-view evidence and human acceptance pending:** unused Bots add no desktop/capture/transport stack. Historical Cage measurements and the bounded Sway/Xvnc experiments are evidence with different workloads, not a current Sway capacity result. The Sway stack still requires matched retained-desktop / one-selected-projection measurements plus top-bar, shortcut, and ordinary host-input acceptance.

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
- The inventory is the sole support-policy source for steering, abort, Thinking, Thread actions, accepted attachment modalities, and native event families.
- Contextual native operations are shown and executed according to that inventory. Unsupported operations are rejected rather than simulated; Pi image input is not claimed while its provider conformance reports images unsupported.
- Bot deletion removes Omarchy Bot-owned data and local Agent-session mappings only. Shared Workspace files and Agent-owned Native Sessions survive deletion.

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

### Future Tauri Bot Client

The current Web frontend will be reused for a Tauri desktop client, not replaced by an independently implemented interface. Conversation UI, Bot selection, Computer Surface behavior, and daemon-facing contracts stay shared; Agents, Native Sessions, Bot Desktop Sessions, and capture/input execution remain on the Omarchy side.

[ADR 0010](adr/0010-reuse-web-client-in-tauri.md) records this accepted evolution contract. Preserve the client/execution separation now without adding unused native scaffolding. Tauri packaging and shell-specific integrations are later work; its actual WebView media/input support must be tested then rather than inferred from Chromium tests. This does not change current Omarchy plugin lifecycle ownership, network policy, or application-state ownership.

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

### Bot Settings

The Bot avatar and name form one Conversation Header toggle for a right-side Astryx `LayoutPanel` named Bot Settings at every window width. Selecting the identity again closes the panel. Its Profile section identifies the Bot's immutable Agent as read-only context and lets the user edit the Bot's name, Instructions, and avatar. Changing execution backend means creating another Bot.

The Display section contains independent `Show tool calls` and `Show Thinking` switches. Both default off, apply to all Threads belonging to the Bot, persist through the daemon, and synchronize across windows. They filter presentation only: hidden content remains received and retained, and changing a switch does not change Agent configuration.

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

## 9. Ordered rich transcript

- User text and Bot Response Blocks render with Astryx Markdown inside filled message bubbles. Live Bot content uses streaming Markdown; raw HTML is ignored or shown as text.
- Safe links open outside the workspace with `noopener noreferrer`. HTTP(S) Markdown images load directly with `no-referrer`, including addresses on public, private, loopback, and link-local networks.
- Response Blocks, Thinking Blocks, Tool Calls, Steering, and recognized product content retain their original occurrence order. Adjacent Response Blocks may merge visually without merging persisted identity.
- Thinking is only content or a provider-authored summary officially exposed by the Agent. Each Thinking Block is collapsed by default, renders compact Markdown when expanded, and shows its own state and wall-clock duration.
- Tool Calls use Astryx `ChatToolCalls` directly inside assistant message context. Only adjacent calls group; there is no outer Activity disclosure.
- Tool history contains status, name, and only Adapter-authored optional target, duration, diff statistics, and bounded redacted error summary. Full tool input and output are not retained as transcript details.
- Bot Display Settings independently hide Tool Calls and Thinking; both default off. Hiding affects current output and all history immediately without changing receipt, persistence, or Agent behavior.
- Native Events remain typed residual Agent-specific envelopes after common content is normalized. Unknown public payloads may be retained, diagnostic and secret payloads are redacted, and no generic Native Event renderer appears in the Thread.
- Sidebar previews and unread content use Response Blocks only. A Turn that produces no Response remains quiet when process content is hidden.
- Streaming follows the latest content only while the user is already at the bottom. Scrolling upward is never overridden; a quiet jump-to-latest action appears instead.
- Errors appear inline at the turn where they occurred with plain-language recovery. Technical diagnostics live in details, not in the primary transcript.

## 10. Computer

Each Bot owns one Bot Screen identity with independent windows, pixels, focus, pointer, and keyboard state. A running Bot Desktop Session serves that Screen; a Screen Projection only exposes it to a viewer. Neither a new Thread nor another viewer creates another computer or transfers ownership of the Bot's ongoing work.

- Keep input arbitration internal and scoped to each Bot Screen so a Bot and the user cannot interleave actions on that Screen while unrelated Bots continue independently.
- Do not show controller epochs, queues, runtime generations, or engineering diagnostics in normal UI.
- A Computer glyph is always present in the Conversation Header. It is visually quiet while inactive and gains state only while the Bot is using the computer or needs human input.
- The glyph toggles a right-side Astryx `LayoutPanel` at every window width with a low-frequency, lossless, read-only Computer Preview and plain-language activity.
- Expanding the preview opens Web Control. Production uses an on-demand WayVNC RFB Screen Projection through a dedicated view-only WebSocket, separate from the versioned preview/control WebSocket. The browser client is bundled noVNC; SDP/ICE and WebRTC are removed. The HTTP PNG snapshot remains an explicit read-only fallback, never an interactive image stream.
- Show **Take control** only when human input is relevant.
- While the user controls the Screen, show **Return to Bot**; re-observe before resuming automation.
- Permanent deletion removes plugin-owned desktop runtime and session metadata before its Screen identity. It does not authorize erasing Shared Workspace files or taking ownership of application-internal state.
- Screen coordination does not approve or filter Agent capabilities, and compositor/socket isolation is not an adversarial security boundary.

### Desktop implementation and host boundary

- Adopt one pure-headless Sway runtime per running Bot Desktop Session, with view-only WayVNC projection, existing Computer Broker-authorized human input, and native Sway IPC window control, as selected in [Computer ADR 0009](contexts/computer-control/adr/0009-adopt-sway-bot-desktops.md). Production provisions Sway for every new Bot Desktop Session. Do not expose a compositor selector or retain dual production runtimes. Provision on the first graphical action or requested desktop view, not simply because a Bot was created.
- Run only lightweight desktop infrastructure: private runtime, Wayland, Sway IPC, VNC, D-Bus, and application-profile endpoints; headless output; persistent application surface; and explicitly targeted capture/input. There is no per-Bot Omarchy/UWSM login session, shell/bar stack, or host autostart configuration.
- Bot A and Bot B may operate independently. The Computer Broker coordinates Bot versus human input on the same Screen; it does not serialize unrelated Bots or manage workspace files.
- A client switching from A to B releases its old projection and input authority and connects to B. A's background work continues under its existing authority rules; switching does not cancel a Turn, destroy A's desktop, or implicitly finish an outstanding human Takeover.
- Each client projects only its selected Screen. When a Screen has no viewers, stop unused continuous capture and transport work; this does not prohibit screenshots explicitly requested by an Agent, interrupt an unfinished graphical task, or stop its applications. Reopening must show the same live page/window state. A projection disconnect is not a session-destruction policy.
- Application launch and desktop tools receive the intended Bot display endpoint. Installing a browser per Bot, synchronizing Cookies, choosing shared versus separate browser profiles, and controlling application-internal concurrency are outside this contract.
- The Host Session's top bar, shortcuts, focus, and physical input remain usable through provisioning, operation, projection switches, failures, and cleanup. Child environments never overwrite global systemd/D-Bus activation state; teardown addresses only plugin-owned child processes or transient application units.
- Private display routing is operational isolation, not an Agent system-permission sandbox. Preserving native Agent capabilities does not authorize plugin development or runtime management to update the host OS or alter its graphical session.
- A single shared window/focus/input state cannot satisfy parallel Bot desktop operation. VNC or SSH connections alone do not create independent surfaces; Sway supplies the independent Bot Screen, view-only WayVNC supplies projection, the Computer Broker-authorized path supplies human input, and native Sway IPC supplies truthful window control.

### Required host-safety and resource evidence

Separate plugin desktop overhead (compositor, desktop surface, helpers, capture, encoder, and daemon) from Agent/application workloads; report the whole scenario as well, and identify test-harness overhead rather than assigning it to the compositor. The historical four-active-Screen result of about 2 GiB PSS and 4.13 CPU cores is not an accepted normal-use budget or proof that desktop isolation itself requires that cost.

Acceptance must exercise Bots with no graphical use, several retained Bot desktop sessions with only one viewed, repeated client A/B switches, and no viewers while background work continues. Verify release of unused capture/encoding paths without destroying applications; do not claim unmeasured resource savings or introduce idle-kill policies that discard work.

Host-safety evidence must cover the original top bar, shortcuts, focus, and physical input across desktop start, use, failure, and targeted cleanup. The historical two-Cage smoke and bounded two-Sway experiment check sibling-screen outcomes but do not directly assert host top-bar/shortcut usability or complete target-stack conformance. Safe verification must use private runtime/profile artifacts and targeted child teardown, never host package updates or graphical-session restarts.

Final acceptance also requires the user's own confirmation that the original top bar, shortcuts, ordinary desktop use, and Bot switching behave correctly. Record automated results, real-runtime evidence, and human acceptance separately; automated passes alone do not satisfy this gate.

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
