# AI teammate workspace

Status: ready-for-agent

## Problem Statement

Omarchy Bot currently presents supported coding Agents as a fixed engineering dashboard: Agent identity and Bot identity are conflated, every Agent-backed record appears as a visible Bot, creation is represented by an unrelated multi-step Wizard draft, permissions and capabilities are filtered through an extra product policy, desktop coordination is exposed as lease mechanics, and the chat Composer supports only a narrow text flow.

A user cannot create several distinct teammates backed by the same Agent, give each teammate a durable identity and Job, manage conversation history naturally, attach local material, dictate with Omarchy's native voice tooling, steer active work, or understand background activity without reading implementation diagnostics. The current interface therefore feels like an operations console rather than a polished AI teammate workspace.

The old model and its documentation must be replaced rather than retained as a compatibility product. Existing user data must nevertheless migrate without losing conversations.

## Solution

Replace the dashboard with a local-first conversation workspace built around user-created Bots. A Bot has its own Profile and immutable Agent reference; multiple Bots may use the same Agent. The application presents a Grok-like information architecture without copying Grok's visual styling: a Bot Sidebar, conversation Header, transcript, rich Composer, contextual history Sheet, and contextual Computer Sheet, with no global TopNav.

Separate Agent discovery/readiness from Bot lifecycle. Preserve each Agent's native capabilities and approval behavior through a versioned Agent Capability Inventory instead of an omarchy-bot permission layer. Keep Shared Screen arbitration internal while exposing plain-language activity and Takeover only when relevant.

Use Astryx primitives for the product surface, local managed storage for attachments and avatars, Voxtype for speech-to-text, native steering for messages sent during active work, restrained animated avatars for state, and system-following light/dark themes. Migrate existing Agent-shaped records into the new model, then remove the obsolete Role, permission-policy, Wizard, capability-manifest, and dashboard paths rather than maintaining two models.

## User Stories

1. As an Omarchy user, I want to create a Bot with a name, Job, and Agent, so that I can define a teammate for a specific kind of work.
2. As an Omarchy user, I want Bot creation to use one simple Sheet, so that setup feels immediate rather than like deployment configuration.
3. As an Omarchy user, I want to see every supported Agent in the picker, so that I understand the available backend choices.
4. As an Omarchy user, I want unavailable Agents to remain visible but disabled with setup guidance, so that absence is understandable rather than silent.
5. As an Omarchy user, I want a new Bot to open automatically after creation, so that I can start talking to it immediately.
6. As an Omarchy user, I want a newly created Bot to open a blank conversation, so that the workspace does not impose generic onboarding content.
7. As an Omarchy user, I want several Bots to use the same Agent, so that one backend can power teammates with different identities and Jobs.
8. As an Omarchy user, I want a Bot's Agent reference to remain fixed, so that an existing teammate and its conversation history do not silently change execution backend.
9. As an Omarchy user, I want to edit a Bot's name, Job, and avatar, so that its Profile can evolve.
10. As an Omarchy user, I want updated Instructions to affect future turns in all of that Bot's Threads, so that the teammate has one current Job.
11. As an Omarchy user, I want existing messages to remain unchanged after Instructions are edited, so that history stays truthful.
12. As an Omarchy user, I want to archive a Bot without losing its Threads, so that I can remove inactive teammates from daily navigation.
13. As an Omarchy user, I want archiving a working Bot to explain and stop its current work, so that no hidden task continues after removal.
14. As an Omarchy user, I want to restore an archived Bot, so that archiving is reversible.
15. As an Omarchy user, I want permanent deletion to live behind the archived-Bot surface and explicit confirmation, so that destructive cleanup is deliberate.
16. As an Omarchy user, I want deleting a Bot to leave the referenced Agent installation untouched, so that other Bots remain usable.
17. As an existing user, I want current Agent-backed conversations migrated into user-created Bots, so that redesigning the model does not erase my history.
18. As an Omarchy user, I want the Sidebar to contain only Bots I intentionally created, so that it represents my team rather than an Agent inventory.
19. As an Omarchy user, I want each Bot row to show avatar, name, recent preview, time, unread state, and relevant activity, so that I can scan my team quickly.
20. As an Omarchy user, I want Bots ordered by recent activity, so that current work stays easy to reach.
21. As an Omarchy user, I want to pin important Bots above recency ordering, so that stable teammates remain accessible.
22. As an Omarchy user, I want opening the application to select the most recently active Bot, so that I return to current work.
23. As an Omarchy user, I want selecting a Bot to open its most recently active Thread, so that the Sidebar remains one level deep.
24. As an Omarchy user, I want unread state to clear only after I actually reach the latest message, so that unseen output is not lost.
25. As an Omarchy user, I want a desktop notification when a background Bot completes or needs me, so that parallel work does not require polling.
26. As an Omarchy user, I do not want notifications while already viewing that Bot in a focused window, so that the application does not duplicate visible feedback.
27. As an Omarchy user, I want to open Thread history from the conversation title, so that history remains contextual to one Bot.
28. As an Omarchy user, I want the history Sheet to offer New conversation, recent Threads, and search, so that I can navigate without expanding the Sidebar.
29. As an Omarchy user, I want abandoned blank conversations omitted from history, so that New conversation does not create clutter.
30. As an Omarchy user, I want the first user message to produce a concise local Thread title, so that history is identifiable without an extra model call.
31. As an Omarchy user, I want native Thread actions to appear only when the active Agent actually supports them, so that the interface does not pretend to rename, delete, fork, or compact native sessions.
32. As an Omarchy user, I want a completely blank new Thread with only the Composer, so that the product feels focused rather than like a generic AI landing page.
33. As an Omarchy user, I want each Thread to keep its own Composer Draft within my current window, so that switching conversations does not mix unsent content.
34. As an Omarchy user, I want returning to a Thread in the same window to restore its draft, so that switching Bots is safe.
35. As an Omarchy user, I want the same window to recover its draft after refresh, so that an accidental reload does not erase work.
36. As an Omarchy user, I do not want drafts synchronized into another window, so that simultaneous windows do not overwrite each other.
37. As an Omarchy user, I want to attach local files and images before sending, so that a Bot can work from my material.
38. As an Omarchy user, I want attachments staged with the originating draft, so that they cannot move to another Bot after navigation.
39. As an Omarchy user, I want sent attachments stored as managed local snapshots, so that later history refers to the same content.
40. As an Omarchy user, I want image previews and compact file rows, so that attachments are recognizable without adding dashboard density.
41. As an Omarchy user, I want managed attachment data deleted with its owning permanent data, so that local storage follows explicit deletion.
42. As a privacy-conscious user, I want attachments to remain local, so that Omarchy Bot does not upload my files to its own cloud service.
43. As an Omarchy user, I want a microphone action in the Composer, so that I can dictate naturally with Voxtype.
44. As an Omarchy user, I want one click to begin recording and a second click to stop, so that on-screen dictation is accessible and reliable.
45. As an Omarchy user, I want the Composer to show recording and transcribing states, so that I know what Voxtype is doing.
46. As an Omarchy user, I want a completed transcript inserted into the originating draft, so that I can review and edit it before sending.
47. As an Omarchy user, I want existing draft text preserved around dictation, so that voice input does not replace typed work.
48. As an Omarchy user, I want Escape to cancel dictation, so that I can discard a recording without output.
49. As an Omarchy user, I want silence and transcription errors to leave the draft unchanged, so that failure never creates or sends a message.
50. As an Omarchy user, I want an optional Auto-send voice transcriptions setting, so that I can choose Voxtype-like submission behavior.
51. As an Omarchy user, I want voice auto-send disabled by default, so that default behavior matches Grok Bot's review-before-send interaction.
52. As an Omarchy user, I want auto-sent dictation to target the Thread where recording started, so that focus or navigation cannot redirect it.
53. As an Omarchy user, I want Omarchy's existing Voxtype shortcuts to continue working, so that application integration does not change system dictation.
54. As a privacy-conscious user, I want Omarchy Bot to retain transcript text but not raw voice audio, so that dictation remains local and minimal.
55. As an Omarchy user, I want Enter to send and Shift+Enter to add a newline, so that Composer keyboard behavior is predictable.
56. As an Omarchy user, I want a message sent during active work to steer the same Agent session, so that I can redirect work without restarting it.
57. As an Omarchy user, I want steering to wait for a safe boundary after the current atomic action, so that redirection does not corrupt in-flight tool work.
58. As an Omarchy user, I do not want a permanent Stop button in the Composer, so that normal correction happens conversationally.
59. As an Omarchy user, I want explicit cancellation used when an operation such as archiving requires work to stop, so that stopping and steering remain distinct.
60. As an Omarchy user, I want Agent tools, intermediate steps, and native events grouped into compact Activity by default, so that the transcript remains readable.
61. As an Omarchy user, I want to expand Activity details, so that technical work remains inspectable.
62. As an Omarchy user, I want final answers visually separated from Activity, so that results are never buried in diagnostics.
63. As an Omarchy user, I want streaming to follow output only while I am already at the bottom, so that reading older content is not interrupted.
64. As an Omarchy user, I want a jump-to-latest action after scrolling away, so that I can return to live output deliberately.
65. As an Omarchy user, I want turn errors shown inline with plain-language recovery, so that failure is connected to the relevant work.
66. As an Omarchy user, I want technical diagnostics behind details, so that ordinary conversation is not an engineering console.
67. As an Omarchy user, I want every new Bot to receive a deterministic generated avatar, so that it has an identity without extra setup.
68. As an Omarchy user, I want to upload a custom avatar, so that a Bot can use my preferred image.
69. As an Omarchy user, I want to describe an avatar in natural language, so that the Bot's Agent can produce a matching DiceBear Avatar Recipe.
70. As a security-conscious user, I want Agent-produced avatar data validated rather than rendering Agent-authored SVG, so that profile customization cannot inject executable content.
71. As an Omarchy user, I want selected and working generated avatars to animate subtly, so that active teammates feel alive.
72. As an Omarchy user with an uploaded avatar, I want the same activity communicated through a restrained container treatment, so that custom images retain state parity.
73. As an Omarchy user, I want the assistant avatar to animate while output streams and settle afterward, so that motion communicates real state.
74. As a motion-sensitive user, I want reduced-motion mode to replace animation with static indicators, so that the workspace remains comfortable.
75. As an Omarchy user, I want a Computer icon consistently available in the conversation Header, so that the selected Bot's screen context is discoverable.
76. As an Omarchy user, I want the Computer icon quiet while inactive and stateful only when relevant, so that it does not create permanent operational noise.
77. As an Omarchy user, I want the Computer Sheet to show a preview and plain-language activity, so that I can observe desktop work without lease terminology.
78. As an Omarchy user, I want Take control shown only when human input is relevant, so that takeover is contextual.
79. As an Omarchy user, I want Return to Bot while I control the Shared Screen, so that the handoff has a clear end.
80. As an Omarchy user, I want the computer re-observed before the Bot resumes, so that automation continues from current desktop state.
81. As an Omarchy user, I want a waiting Bot to say Waiting for computer without exposing queue mechanics, so that contention is understandable but quiet.
82. As an Omarchy user, I want desktop input globally serialized on the current Shared Screen, so that Bots and the user cannot interleave clicks and typing.
83. As an Omarchy user, I want emergency stop retained as a global fail-safe outside normal conversation controls, so that I can halt unsafe desktop input.
84. As an Omarchy user, I want Agent-native approvals preserved, so that Omarchy Bot neither weakens nor duplicates my Agent's behavior.
85. As an Omarchy user, I want a tested Agent Capability Inventory to drive contextual native actions, so that the UI reflects the installed Agent version truthfully.
86. As an Omarchy user, I want light and dark themes to follow Omarchy or system preference, so that the workspace fits my desktop.
87. As a keyboard user, I want complete navigation, visible focus, and semantic controls, so that the workspace is operable without a pointer.
88. As a mobile-width user, I want the Sidebar to become a drawer while preserving conversation controls, so that the workspace remains usable in a narrow window.
89. As an Omarchy user, I want cool neutral surfaces, one lively blue accent, low card density, and restrained motion, so that the product feels future-facing without generic AI styling.
90. As an Omarchy user, I want the interface in English, so that terminology remains consistent with the product specification.

## Implementation Decisions

- Replace the fixed Agent-shaped Bot registry with two aggregates: an Agent registry for installation/readiness/version/inventory and user-created Bot records for identity, Instructions, avatar, archive state, and immutable Agent reference.
- Give Bots independent identifiers that never alias Agent identifiers. Multiple Bot records may reference one Agent.
- Remove the old Role abstraction from the direct conversation product model. A Thread belongs directly to one Bot, and its native session mapping is resolved through that Bot's Agent.
- Migrate existing Agent-shaped Bot records and their Threads into the new schema before removing obsolete tables and fields. Preserve message order, timestamps, native session mappings, and attachment/artifact references. Do not retain a parallel legacy read path after migration.
- Remove per-Bot permission policy, the omarchy-bot Agent permission gate, permission endpoints, permission UI, and capability-manifest drafts. Native Agent approvals and controls remain inside each adapter's official lifecycle.
- Maintain a versioned Agent Capability Inventory containing exercised native operations and event types. Inventory metadata describes support and evidence; it never grants or denies tool use.
- Keep Agent workers isolated and started by Agent identity rather than Bot identity. Independent native sessions preserve separation when several Bots share one Agent worker.
- Extend the worker protocol with native steering and typed native commands while preserving unknown native envelopes with sensitivity metadata.
- Use native steering for a message sent to a working Thread. Use native abort only for explicit cancellation behavior such as confirmed archiving of an active Bot.
- Replace Task/Run-oriented public chat semantics with Thread turn/activity semantics. Internal correlation may remain where useful, but engineering task entities are not primary product navigation.
- Introduce Bot create, read, edit, archive, restore, and permanent-delete commands with validation and conflict/error responses.
- Introduce Agent list/readiness/recheck responses separate from Bot responses. The Agent picker consumes this registry.
- Make Thread creation lazy until first send. Selecting New conversation creates window-local draft state first, then persists a Thread atomically with its initial message.
- List Threads by Bot and recent activity. Derive the first title locally from normalized first-message text and permit contextual native actions according to inventory.
- Store Composer Drafts per Thread and application-window identifier in window session storage. Text and staged attachment references restore in the same window and do not synchronize across windows.
- Introduce an attachment service with staged and sent lifecycle states, managed local snapshots, media metadata, bounded upload handling, message association, history access, and deletion cleanup.
- Pass attachments to the active Agent only in forms claimed by its capability inventory and supported by its adapter. Do not silently transform an unsupported native operation into a different Agent feature.
- Introduce a daemon-owned dictation service that probes Voxtype, serializes one recording, allocates runtime transcript files, parses documented JSON outcomes, cleans up runtime artifacts, and emits non-sensitive recording state.
- Start app-owned dictation with file output and explicit no-auto-submit/no-smart-auto-submit overrides. The application inserts returned text into the owning draft and optionally executes its own Thread-scoped send command based on the user setting.
- Preserve external Omarchy Voxtype shortcuts and user configuration. Do not implement browser speech recognition or raw-audio upload.
- Store the Voice auto-send preference in application settings, defaulting off.
- Store uploaded avatars locally after safe image decoding/re-encoding. Store generated avatars as versioned, validated DiceBear Avatar Recipes.
- Use the Bot's selected Agent for prompt-to-recipe generation as a profile operation outside Thread history. Render only application-generated DiceBear output.
- Animate generated avatar internals or an uploaded-avatar activity container only for selected, working, or streaming states. Gate movement behind reduced-motion preference.
- Keep the Computer Broker as the exclusive Shared Screen input coordinator, but replace public lease/TTL/queue diagnostics with a contextual state projection for the selected Bot.
- Keep Takeover, Return to Bot, waiting state, re-observation, and emergency stop semantics. Remove the separate omarchy-bot approval check for desktop actions; coordination remains distinct from Agent permissions.
- Publish ordered Bot, Thread, turn/activity, dictation, and Computer state through the existing replayable WebSocket seam. Do not broadcast transcript text from dictation to non-owning clients.
- Build the layout with Astryx SideNav, layout, Sheet/Dialog, ChatMessageList, ChatComposer, Avatar, selection, and status primitives discovered through the Astryx CLI. Do not retain TopNav or recreate Astryx primitives by hand.
- Use one cool-neutral visual system with one blue accent, system-following light/dark themes, soft consistent radii, low card density, and state-motivated motion.
- Use a conversation-local Header for title/history, Computer, and contextual Bot actions. Keep global Settings at the Sidebar footer.
- Treat the normal blank Thread as an intentionally empty transcript region plus Composer, not an onboarding hero.
- Use contextual inline errors and skeletons shaped like final content. Use notifications only for background completion and action-needed states.
- Preserve localhost-only deployment, daemon-only SQLite writes, local managed media, and existing worker isolation.

## Testing Decisions

- Tests assert externally observable behavior rather than private classes, SQL statements, React component structure, or implementation call order. Refactoring an internal module without changing product behavior must not require rewriting the test.
- The primary seam is the localhost REST/WebSocket API against a real daemon process with fake Agent, Computer, and Voxtype boundaries. This seam verifies schema migration, Agent/Bot separation, Bot lifecycle, Thread and message behavior, native steering routing, attachment lifecycle, dictation outcomes, event replay, background state, and Computer coordination.
- Migration tests start from a representative legacy database, boot the current daemon, and verify the migrated product exclusively through public API responses. They also verify that a second boot is idempotent and does not expose a legacy model.
- API integration tests extend the existing daemon harness and fake worker prior art. Fakes model public worker/subprocess protocols, not daemon internals.
- Browser E2E is the user seam for Sidebar ordering/pinning/unread, Bot creation and editing, history Sheet, blank Thread, window-local drafts, attachment staging, dictation states, streaming scroll behavior, collapsed Activity, Computer Sheet, responsive drawer, keyboard navigation, focus restoration, light/dark themes, and reduced motion.
- Browser tests interact by accessible roles and visible labels rather than CSS selectors or component names. Accessibility checks include automated axe coverage plus focused keyboard scenarios.
- Visual regression covers representative light/dark desktop and narrow-window states, selected/working avatar states, reduced motion, long transcript, errors, and contextual Takeover.
- Agent worker conformance remains the adapter seam. It verifies the exact installed version's session lifecycle, stream boundaries, attachments, native cancellation, steering where claimed, native events, capability inventory evidence, and restart recovery.
- Unsupported capability entries are tested as truthful absence, not as mocked emulation.
- Computer tests verify that observation remains available without input ownership, input cannot interleave, Takeover parks Bot input, Return to Bot re-observes, waiting state is scoped to the affected Bot, and emergency stop revokes input.
- Voxtype tests use a fake executable that produces documented `ok`, `empty`, `timeout`, `error`, busy, cancel, and unavailable outcomes. At least one local smoke test probes the installed Voxtype integration contract without recording audio.
- Attachment tests use known local fixtures and verify byte-for-byte snapshot stability, media metadata, history retrieval, window-draft isolation, cleanup, and rejection of invalid or oversized input.
- Existing tests for the removed omarchy-bot permission layer, Agent-as-Bot registry, Role model, task dashboard, and permanent engineering Computer panel are deleted rather than preserved as compatibility expectations.

## Out of Scope

- Implementing the eight pending non-Pi Agent adapters in this workspace migration. They remain visible and unavailable until their separate adapter implementation and conformance work passes.
- Emulating native Agent operations that an installed Agent version does not expose.
- Independent per-Bot Screens and true parallel desktop input. The current product continues to coordinate one Shared Screen.
- Treating a Hyprland workspace as a Bot Screen.
- Cloud attachment storage, remote audio transcription, raw voice messages, or browser speech recognition.
- A public network listener, remote device pairing, Tauri client, or mobile application.
- Roles, Channels, Routines, cross-Bot handoff, product-owned long-term memory, public plugin APIs, and capability provisioning.
- A permanent TopNav, engineering dashboard, visible lease console, or capability-management screen.
- Agent-generated executable SVG or arbitrary remote avatar content.
- Agent-generated Thread titles; title derivation remains local in this scope.
- Automatic cross-window Composer Draft synchronization.

## Further Notes

- The accepted workspace design and ADRs are the authority when ticket detail is ambiguous.
- The cleanup requirement is strict: migration preserves user data, not obsolete product concepts or compatibility UI.
- The implementation should proceed in vertical tracer bullets so each ticket leaves a usable end-to-end behavior rather than a horizontal layer waiting for later integration.
- The product is English-only even though planning discussion may occur in Chinese.
