# Shared Workspace and Bot Desktop Boundary Correction

Status: implemented for the 2026-09-05 correction; accepted Sway runtime migration and human host acceptance pending

## Problem Statement

Omarchy Bot is intended to be an Omarchy plugin inspired by Grok Bot: the user creates persistent Bots backed by Agents already available in Omarchy. Multiple Bots may use the same Agent, share work files, and continue independent desktop work while the client views another Bot. The current implementation and accumulated specifications do not consistently preserve that model.

The user currently encounters “Screen didn’t load” and “Couldn’t start the Bot Screen.” The user also reports that prior operation/development left the host Omarchy top bar and shortcuts unusable. These observations are accepted as failures against the product contract. The startup failure and host disruption have not been shown to have the same cause, and neither cause was established during the design review. A generic connection error, an existing isolation-shaped implementation, or a historical passing test is not proof of a working, host-safe plugin.

Bot work has no reliable shared default directory distinct from plugin development and installation. Agent-session initialization falls back from a Thread's explicit working directory to the daemon's launch directory; another Agent entry point also directly uses that launch directory. This can make plugin source or installed application files the implicit location of Bot work. A Changes capability then exposes Git working-tree state from that effective directory. The user does not want that panel, a review workflow, or plugin-managed file/task locks and Git worktrees.

The desktop discussion also conflated an Agent Native Session, a Bot Desktop Session, and a viewer's Screen Projection. Creating a Bot must not mean creating another full Omarchy environment, and switching a viewing connection must not mean cancelling the old Bot or forcing all Bots to share one focus/input state. Conversely, separate Bot Screens do not make browser profile, Cookie, login, or application-internal concurrency policy a responsibility of the plugin.

Finally, the historical four-active-Screen result of roughly 2 GiB PSS and 4.13 CPU cores combined compositor, application/worker, capture, encoder, and daemon/test-harness costs. It is neither a compositor-only measurement nor an accepted normal-use resource budget. The user rejects that level of overhead as the default design. The product needs evidence for its actual use pattern: several independent background sessions, with only the selected Screen projected by each client, and no continuous projection work for a Screen without viewers.

The Web frontend is also intended to become a Tauri desktop client. Treating it as a disposable browser-only implementation, duplicating its business behavior in a native client, or moving Agent/desktop execution into the viewer would create another architectural drift. Future desktop delivery is an accepted direction; shipping that client is not part of this correction.

## Solution

Keep Omarchy Bot focused on its plugin role. Users create Bots from available Agents, converse with them, and observe or take over their graphical work without disrupting their own Omarchy desktop. All Bots default to the same Shared Workspace at `~/.omarchy-bot/workspace/` under the user's home directory. This is a working-file location, not the plugin repository, an installation directory, a required Git repository, or a file-access sandbox. Agents retain their native ability to work elsewhere.

Each Bot retains one Bot Screen identity. Its first graphical action or requested desktop view starts or resumes a lightweight private Bot Desktop Session on demand, with its own display endpoint and independent windows, focus, pointer, and keyboard state. [Computer ADR 0009](../../docs/contexts/computer-control/adr/0009-adopt-sway-bot-desktops.md) is the production stack: pure-headless Sway, view-only WayVNC, the existing Computer Broker-authorized human input path, and native Sway IPC. The Host Session remains the user's original Omarchy environment. Bot A can keep operating its own graphical applications while the client selects Bot B; the client replaces its Screen Projection and input connection, not the underlying Bot's work.

Stop continuous preview capture and video encoding when a Screen no longer has viewers, without stopping its applications or prohibiting Agent-requested screenshots. Preserve low-frequency read-only Computer Preview, expanded Web Control, contextual Takeover, and truthful read-only fallback. The plugin owns desktop lifecycle and routing, not browser selection, profile layout, Cookie synchronization, logins, or application-internal concurrency.

Remove Changes and its backing product capability rather than hiding the tab or replacing it with a review/artifact panel. Preserve unrelated Composer, Bot Settings, conversation, accessibility, and Computer Surface behavior. Deleting a Bot removes plugin-owned records and targeted desktop runtime, not Shared Workspace files or Agent-owned Native Sessions.

`~/.omarchy-bot/memory/` remains a future directory intention only. This work does not implement memory or relocate existing conversation databases, managed attachments, avatars, or other application data.

Retain one Web frontend as the basis for a future Tauri Bot Client. Conversation and Computer Surface behavior remain shared, and the Omarchy daemon continues to own execution and desktop infrastructure. Current changes must preserve that separation without adding a Tauri scaffold, another UI implementation, or speculative native abstractions.

Consolidate documentation so current contexts, the product model, and this implementation specification give one consistent answer. Retire superseded requirements after preserving still-valid requirements and necessary evidence. Completion requires automated behavior coverage, safe real desktop/resource evidence, and the user's explicit hands-on confirmation that host desktop use and Bot switching behave correctly.

## User Stories

### Product identity and ownership

1. As an Omarchy user, I want to create named Bots backed by available Agents, so that the plugin follows the teammate model rather than displaying Agent inventory as Bots.
2. As an Omarchy user, I want several Bots to use the same Agent, so that backend reuse does not merge their identities or conversations.
3. As an Omarchy user, I want each Bot's Threads and Agent-owned Native Sessions to remain distinct from its graphical session, so that changing a conversation does not accidentally create or destroy a desktop.
4. As an Omarchy user, I want work files shared independently of Bot and Thread identity, so that one Bot can use work saved by another without the plugin inventing a file-transfer workflow.
5. As an Omarchy user, I want the plugin repository and installed program kept separate from Bot work, so that normal Bot tasks do not implicitly target plugin source.
6. As an Omarchy user, I want Agents to keep their native tools and approval behavior, so that desktop integration does not become a new general permission or workflow layer.
7. As an Omarchy user, I want the plugin to manage desktop infrastructure rather than application-internal state, so that browser profile and login policy do not become unrelated product requirements.
8. As a maintainer, I want the context vocabulary to distinguish Shared Workspace, Host Session, Bot Screen, Bot Desktop Session, Native Session, and Screen Projection, so that implementation work does not substitute one lifetime or ownership model for another.

### Shared Workspace

9. As an Omarchy user, I want every Bot without an explicit working-directory choice to use the same home-local Shared Workspace, so that new Bots have a predictable place to work.
10. As an Omarchy user, I want the Shared Workspace prepared when needed without a separate setup wizard, so that a fresh installation can accept ordinary file work.
11. As an Omarchy user, I want an existing Shared Workspace reused without overwriting its contents, so that plugin startup and updates preserve my work.
12. As an Omarchy user, I want new Threads of a Bot to inherit the shared default, so that opening another conversation does not silently choose another directory.
13. As an Omarchy user, I want two Bots backed by the same Agent to receive the same default work-file location but distinct Native Sessions, so that sharing files does not merge conversational context.
14. As an Omarchy user, I want the shared default to remain stable when the daemon is launched from another directory, so that development, installation, and restart entry points do not determine Bot work ownership.
15. As an Omarchy user, I want the workspace to work without Git metadata, so that ordinary documents, downloads, and non-code tasks are first-class work.
16. As an Omarchy user, I want explicit existing Thread working-directory choices preserved, so that this correction does not silently rebind intentional project work.
17. As an Omarchy user, I want session continuation to preserve native conversation state while honoring supported working-directory semantics, so that adopting a correct default does not erase or fabricate session history.
18. As an Omarchy user, I want the shared default used by ordinary turns and existing target-Bot mail turns, so that internal entry points do not fall back to plugin installation files.
19. As an Omarchy user, I want plugin-initiated Agent session requests and supported application launches to receive an intentional working-directory context, so that an omitted directory never silently means the plugin checkout.
20. As an Omarchy user, I want workspace creation or access failures reported honestly, so that work cannot silently fall back into the source or installation directory.
21. As an Omarchy user, I want Agents and their tools to coordinate concurrent file edits themselves, so that the plugin does not add file locks, task locks, or managed Git worktrees.
22. As an Omarchy user, I want native Agent operations to remain able to work outside the default directory when appropriate, so that a shared default is not misrepresented as a permission sandbox.
23. As an Omarchy user, I want shared files to survive deleting any one Bot, so that another Bot's or my own work is not erased with a conversation identity.
24. As an Omarchy user, I want existing product data and application state left in place during this correction, so that a default work-directory change does not become an unrelated storage migration.
25. As an Omarchy user, I want the future memory directory distinguished from implemented memory behavior, so that a path suggestion does not silently create a memory subsystem.

### Remove Changes without losing the conversation or Computer Surface

26. As an Omarchy user, I want Changes removed from the interface, so that an unrequested Git feature no longer occupies the Bot workspace.
27. As an Omarchy user, I want no hidden Changes polling or Git inspection when I use the plugin, so that removing the tab also removes its background cost and repository access.
28. As an Omarchy user, I want no replacement review or work-artifact panel added in this correction, so that feature removal does not introduce another unrequested workflow.
29. As an Omarchy user, I want the existing Computer entry to remain accessible, so that removing Changes does not remove desktop observation and control.
30. As an Omarchy user, I want Composer drafts, attachments, dictation, send, and Steering to remain unchanged, so that documentation/model cleanup does not regress conversation work.
31. As an Omarchy user, I want Bot Settings and the Computer Surface to keep the existing single-right-region behavior, so that removing the tab does not introduce competing panels.
32. As a narrow-screen user, I want the existing one-panel-at-a-time navigation retained, so that the remaining Computer Surface remains usable beside the conversation flow.
33. As a keyboard or motion-sensitive user, I want focus, accessible labels, reduced-motion behavior, and light/dark presentation preserved, so that the simplified interface remains operable.
34. As an integration maintainer, I want the retired Changes summary/detail interface removed rather than kept as an empty compatibility response, so that clients cannot mistake a deleted capability for a clean repository.
35. As a maintainer, I want obsolete Changes assertions removed while unrelated layout and Computer regressions remain covered, so that old tests do not force the rejected feature back into the product.

### On-demand Bot Desktop Sessions

36. As an Omarchy user, I want creating a Bot to create its identity without immediately provisioning a graphical session, so that unused Bots do not each carry a running desktop stack.
37. As an Omarchy user, I want the first graphical action or requested view to start the owning Bot's lightweight desktop, so that graphical capability remains available on demand.
38. As an Omarchy user, I want multiple Threads belonging to one Bot to use that Bot's Screen identity, so that conversations do not multiply desktop sessions.
39. As an Omarchy user, I want different Bots using one Agent to retain independent Screen identities, so that sharing an execution backend does not merge window or input state.
40. As an Omarchy user, I want Bots A and B to operate their graphical applications concurrently without changing each other's focus or input, so that independent background work remains possible.
41. As an Omarchy user, I want desktop tools and application launches routed to the intended Bot display endpoint, so that Bot actions do not appear on the Host Session or another Bot's Screen.
42. As an Omarchy user, I want a persistent neutral Bot Desktop available between applications, so that an arbitrary terminal or browser process is not mistaken for the Screen itself.
43. As an Omarchy user, I want closing or failing an application distinguished from failure of its desktop infrastructure, so that an application exit does not unnecessarily destroy the Screen.
44. As an Omarchy user, I want Bot Desktop Sessions to exclude full Omarchy login, shell, bar, and autostart stacks, so that the plugin does not duplicate host graphical services.
45. As an Omarchy user, I want concurrent requests for the same Bot's desktop to converge on its one current session, so that simultaneous viewing and Agent work do not create duplicate runtimes.
46. As an Omarchy user, I want a failing Bot Screen to leave sibling Screens and conversations usable, so that one runtime failure does not become an application-wide outage.
47. As an Omarchy user, I want a real startup failure shown as unavailable rather than as a stale or empty interactive desktop, so that readiness is truthful.
48. As an Omarchy user, I want retry to target the failed Bot and clear stale runtime facts, so that recovery cannot attach me to an old or different Screen.
49. As an Omarchy user, I want useful startup error context and a clear recovery action, so that a generic connection failure does not conceal the actionable failure stage.
50. As an Omarchy user, I want capacity rejection to leave no partial runtime and not disturb admitted Screens, so that existing resource admission remains safe without assuming an unmeasured higher limit.

### Projection and input lifetimes

51. As an Omarchy user, I want selecting Bot B to replace my connection to A with a connection to B, so that the Computer Surface follows the selected Bot.
52. As an Omarchy user, I want A's background graphical work to continue when I view B, so that selection changes do not cancel work or serialize all Bots.
53. As an Omarchy user, I want the old Bot's pixels and input authority cleared before the new projection becomes usable, so that stale content is never presented under another Bot's identity.
54. As an Omarchy user, I want obsolete projection responses ignored after switching Bots, so that a late connection cannot replace the currently selected Screen.
55. As an Omarchy user, I want closing or disconnecting a viewer to release its projection resources without closing the Bot's applications, so that viewing is not confused with desktop ownership.
56. As an Omarchy user, I want Screens without viewers to stop continuous preview capture and video encoding, so that unseen Screens do not pay the cost of ongoing human-view streams.
57. As an Omarchy user, I want compact Computer Preview to remain low-frequency and read-only, so that observation neither takes control nor incurs expanded-video behavior.
58. As an Omarchy user, I want expanded Web Control to use the existing live video and input contract, so that the model correction does not introduce another transport stack.
59. As an Omarchy user, I want leaving expanded mode to release unused encoding work, so that a compact or closed view does not retain a full video pipeline.
60. As an Omarchy user, I want Agent-requested screenshots to remain available without an open viewer, so that removing background projection overhead does not break autonomous work.
61. As an Omarchy user, I want human Takeover of A coordinated only against A's input, so that B's independent desktop work continues.
62. As an Omarchy user, I want an unfinished Takeover to remain unfinished when I switch or close the view, so that navigation does not falsely tell the Bot that my sensitive step is complete.
63. As an Omarchy user, I want held keys and buttons released when the controlling view loses authority, so that disconnects or selection changes do not leave stuck input.
64. As an Omarchy user, I want stale Screen generations and controller messages rejected, so that reconnects cannot replay input against a new runtime.
65. As an Omarchy user, I want an explicit read-only fallback when live projection is unavailable, so that a snapshot is never presented as working interactive control.
66. As a user with multiple client windows, I want each client to project only its selected Screen and closing one viewer not to tear down another viewer's needed stream, so that projection cleanup respects actual remaining viewers.

### Host protection, recovery, and deletion

67. As an Omarchy user, I want the reported Screen startup failure fixed at its actual source and checked through the affected path, so that changing the error wording is not mistaken for a repair.
68. As an Omarchy user, I want the original top bar usable during Bot desktop start, work, switching, failure, and cleanup, so that the plugin never makes my desktop unusable.
69. As an Omarchy user, I want my existing Omarchy shortcuts to continue working through the same lifecycle, so that Bot graphical work does not replace host bindings or activation state.
70. As an Omarchy user, I want my physical input and host focus independent of Bot-generated input, so that Bots cannot accidentally take over the desktop I am using.
71. As an Omarchy user, I want child display environments kept out of global user-manager and D-Bus activation state, so that future host applications are not launched into a Bot display by mistake.
72. As an Omarchy user, I want missing dependencies handled without host package updates or graphical-session restarts, so that repository work does not mutate my operating environment.
73. As an Omarchy user, I want teardown limited to the owning Bot's verified child processes and transient application units, so that cleanup cannot stop unrelated desktop services or applications.
74. As an Omarchy user, I want daemon recovery to reconcile or honestly reprovision its owned desktop runtime without losing shared files, so that process recovery is not a data-erasure operation.
75. As an Omarchy user, I want Bot deletion to stop its active work and remove plugin-owned Screen runtime while preserving shared files and Native Sessions, so that lifecycle cleanup respects ownership.
76. As an Omarchy user, I want the desktop isolation claim described as routing and lifecycle isolation rather than a complete Agent security sandbox, so that the plugin does not overstate its protection.

### Resource evidence and trustworthy delivery

77. As an Omarchy user, I want resource measurements for Bots that have never needed a desktop, so that unused graphical capability has no hidden per-Bot running stack.
78. As an Omarchy user, I want measurements for several retained Bot Desktop Sessions with only one viewed, so that reported cost matches my normal switching workflow.
79. As an Omarchy user, I want no-viewer measurements while background tasks continue, so that the absence of unnecessary capture and encoding is demonstrated rather than asserted.
80. As an Omarchy user, I want plugin desktop overhead separated from Agent, application, and test-harness workloads while retaining whole-scenario totals, so that resource costs are not hidden or attributed to the wrong subsystem.
81. As an Omarchy user, I want before/after measurements taken under comparable conditions, so that lower costs cannot be claimed by silently reducing useful background work.
82. As an Omarchy user, I want the previous four-stream total treated as historical evidence rather than an accepted budget, so that a costly benchmark does not define the product without my agreement.
83. As an Omarchy user, I want applications and unsaved work retained when viewers leave, so that idle resource reduction does not silently discard work.
84. As an Omarchy user, I want missing host-safety or resource evidence reported as an unmet acceptance item, so that mocks, snapshots, or unavailable prerequisites cannot be presented as a passing real-world result.
85. As an Omarchy user, I want to personally verify top bar, shortcuts, ordinary desktop use, and Bot switching before final acceptance, so that automation is not the sole judge of the experience that previously failed.
86. As a maintainer, I want one current model and implementation specification, so that obsolete Changes, full-session, or application-profile requirements cannot be reintroduced from old documents.
87. As a maintainer, I want still-valid Composer and Computer requirements retained when old specifications are retired, so that document cleanup does not silently shrink product behavior.
88. As a maintainer, I want ADR rationale and original measurements retained with their limits while obsolete normative documents are removed safely, so that useful evidence survives without competing instructions.
89. As a maintainer, I want shared files, current conversation data, and existing application state preserved throughout the cutover, so that correcting the model is not used to justify destructive migration.
90. As an Omarchy user, I want the final report to distinguish implemented changes, automated results, real desktop evidence, and my pending or completed manual acceptance, so that “done” has a truthful end-to-end meaning.

### Future Tauri Bot Client

91. As an Omarchy user, I want the current Web interface to become the basis of a future Tauri desktop client, so that desktop delivery preserves the product I already use.
92. As an Omarchy user, I want conversation, Bot selection, and Computer Surface behavior shared between Web and future desktop delivery, so that the two clients do not evolve conflicting business rules.
93. As an Omarchy user, I want Agent and Bot desktop execution to remain on the Omarchy side when a Tauri viewer is introduced, so that a client shell does not become another execution environment or host graphical session.
94. As a maintainer, I want current client/daemon contracts kept independent of a particular client shell, so that future Tauri integration does not require rewriting the domain model or duplicating desktop control logic.
95. As a maintainer, I want native shell integrations introduced only when concrete Tauri work needs them, so that a future-client agreement does not add unused scaffolding or speculative abstractions now.
96. As an Omarchy user, I want future Tauri media and input compatibility verified on its actual WebView, so that browser-only test results are not advertised as proof that the desktop client works.

## Implementation Decisions

### Model and ownership

- Preserve user-created Bot identity, immutable Agent references, multiple Bots per Agent, existing Threads, and Agent-owned Native Sessions. The Shared Workspace is a common default work-file location, not a new per-Bot entity, project manager, permission model, or conversation store.
- Keep Bot Screen identity separate from its on-demand Bot Desktop Session and from each viewer's Screen Projection. One Bot may have many Threads and viewers without acquiring a desktop per Thread or merging with other Bots that reference the same Agent.
- The plugin owns the common default directory and desktop infrastructure. Agent/application work-file coordination, browser/profile/Cookie/login behavior, and other application-internal policies remain outside that ownership. Sharing files does not imply sharing one focus/input state; independent input does not imply a browser-account isolation policy.

### Web-to-Tauri evolution contract

- Reuse the current Web frontend in the future Tauri desktop client: shared conversation UI, Bot selection, Computer Surface, and daemon-facing behavior. Treat Tauri as a Bot Client shell, not a second business-logic implementation.
- Keep Agent workers, Native Sessions, Bot Desktop Sessions, capture/input execution, and persistence authority on the Omarchy side. The Tauri agreement does not transfer daemon lifecycle ownership away from the current Omarchy plugin contract.
- Preserve explicit client-to-daemon interfaces and keep host process/filesystem operations out of presentation modules. Introduce shell-specific adapters only for demonstrated needs; do not prebuild a native bridge, duplicate protocol, or generic platform abstraction for this future delivery.
- Current acceptance continues to use the shipped Web client and public daemon interface. Future Tauri delivery must exercise its actual WebView's projection codecs, signaling, input, and shell lifecycle rather than infer compatibility from Chromium coverage.

### Default working-directory cutover

- Extend existing daemon configuration/bootstrap and session initialization modules with one authoritative Shared Workspace default resolution. Reuse that resolution wherever an Agent session or supported application launch otherwise inherits the daemon's launch directory; do not introduce another configurable project-management layer.
- Create or reuse the shared directory without truncating, moving, importing, or deleting existing contents. A failed default-directory preparation/access attempt must produce an honest failure, never a fallback into plugin source, installed program files, or an unrelated directory.
- Apply the default when no explicit work context exists. Preserve explicit Thread working directories and native backend continuation semantics; directory equality with a plugin checkout is not proof that a stored choice was accidental. Do not delete, restart as a fresh conversation, or silently relabel a Native Session to fabricate migration success.
- Audit ordinary turn starts, resumed turns, existing target-Bot mail turns, utility Agent-session requests, and the computer worker's supported application-launch context. Keep native instructions, session identity, model configuration, and unrelated mailbox/conversation behavior unchanged.
- A shared default is not a command-level file-access restriction. Do not add file/task locks, filesystem serialization, Git repositories, Git worktrees, authorship tracking, or automatic cross-Bot file transfers.
- Keep shared work files outside Bot deletion. Do not relocate existing product databases/media or implement memory as part of this correction. No new per-Bot workspace schema, workspace identifier, or browser-submitted arbitrary filesystem-root interface is required by the accepted model; any minimal persistence adjustment must preserve existing data and explicit choices.

### Remove the Changes capability

- Cut over the conversation's right-region module to the remaining Bot Settings and Computer Surface behavior without retaining Changes selection, query keys, refresh timers, summary/diff presentation, or a hidden Git capability.
- Remove the backing working-tree module, Changes-only daemon endpoints, public DTOs, client methods, and Changes-only test fixtures/expectations that become obsolete. Migrate every caller; do not leave success-shaped empty responses, compatibility aliases, or deprecated exports.
- Preserve unrelated Composer dock improvements, drafts, attachments, dictation, Steering, conversation history, responsive navigation, theme behavior, and accessibility. The Computer entry continues to expose the desktop viewer/control surface, not an arbitrary webview or a promise to manage browsers.
- Retire only obsolete tests. Keep or relocate behavior coverage for shared layout, selection cleanup, accessibility, and Computer functionality before removing mixed-purpose Changes test suites.

### Desktop provisioning and projection

- Use one pure-headless Sway session per running Bot Desktop Session. Do not add a compositor selector, full Omarchy/UWSM session, host-workspace projection, or SSH-based pseudo-isolation; do not retain a Cage production path.
- Reuse the Bot Screen management module, Bot Screen runtime-adapter seam, computer worker, application-unit supervision, Screen Projection module, and Computer Broker. Implement Sway lifecycle, view-only WayVNC projection, and native Sway IPC window control behind those existing interfaces. Preserve the existing Broker-authorized human input path instead of accepting RFB input.
- Provision on the first graphical operation or requested desktop view, not simply on Bot creation or conversation selection without a desktop request. Concurrent first-use requests for one Bot must converge on one current session.
- Each client displays only its selected Screen. Switching or closing releases that client's old projection, stale content, and input authority without cancelling background work, destroying the old desktop, or completing an outstanding Takeover. Cleanup considers remaining viewers and graphical tasks before stopping resources still in use.
- Preserve low-frequency lossless Computer Preview and explicit read-only fallback. The target expanded Web Control route is an on-demand, view-only WayVNC RFB projection carried through the Bot Client's daemon connection; it must not expose a Bot's private VNC socket directly or accept RFB input/clipboard. Human keyboard, pointer, and paste remain on the existing Broker-authorized path. Stop viewer-driven capture/transport when no viewer or graphical task needs it. Agent-requested screenshots remain valid without an open viewer.
- Keep the persistent neutral application surface distinct from applications launched onto it. Application exit/failure is not compositor failure. Application behavior and profile policy are not redesigned; the plugin is responsible for correctly supplying the intended graphical endpoint and cleaning up only its owned runtime.
- Preserve generation, geometry, held-input release, stale-message rejection, per-Screen Takeover, and capacity-admission protections. Closing the Computer Surface is not a destructive stop: the same live pages/windows must be visible on reconnect. Only an explicit destructive stop may end Sway and its applications; do not introduce idle eviction that discards applications or unsaved work.

### Diagnose and repair real failures

- Treat the user's Screen error and prior host disruption as observed failures, not unverified reports to recheck for their own sake. Establish a safe, tight feedback loop for the affected startup/control path using existing error artifacts and controlled reproduction only where it does not risk the live Host Session.
- Do not preselect a startup root cause or assume the host disruption shares it. Trace the actual failing stage through the public desktop request, provisioning, projection, and supervision interfaces; minimize the failing scenario before choosing a source fix.
- Correct the responsible module and add a regression at the highest existing seam that actually exercises the failure. A generic successful startup fixture, a changed error message, disabling desktop capability, or a read-only fallback cannot substitute for fixing interactive Screen startup.
- Keep normal UI failure states clear and useful while preserving bounded, redacted diagnostics for the failing stage. Do not expose credentials or replace unavailable output with stale interactive pixels. Retry remains scoped to the affected Bot and respects existing runtime generation rules.
- Host graphical environment and services remain immutable. Child environments do not overwrite global user-manager or D-Bus activation state; runtime shutdown targets only verified plugin-owned child groups or transient application units. Resolve prerequisites with existing binaries, repository-managed dependencies, or private portable artifacts; no host package update, compositor/bar restart, or global environment repair is implicitly authorized.

### Resource and documentation cutover

- Measure desktop infrastructure separately from Agent/application workloads, distinguish daemon and test-harness work where measurement permits, and publish whole-scenario totals as well. If a harness shares the daemon process, label the combined cost instead of inventing a split.
- Use matched idle, selected-view, background-work, and repeated-switch scenarios. Keep workload, resolution, frame-rate policy, and measurement conditions comparable; report unavailable attribution explicitly. Do not infer savings from compositor count alone or treat a historical simultaneous-stream gate as a normal-use budget.
- The implementation must demonstrate on-demand graphical startup, viewer-driven capture/encoder release, and absence of stale per-client resources. No numerical normal-use budget or guaranteed savings were agreed during this conversation; acceptance must present measured costs honestly, and resource concerns cannot be resolved by silently disabling agreed parallel desktop work.
- Consolidate current glossary/product requirements and this specification before retiring obsolete normative material. Preserve still-valid requirements from mixed documents, update all incoming references, and keep ADR rationale and primary experimental evidence with explicit historical scope.
- Verify historical recoverability before deleting old specifications or tickets; local scratch material is not assumed to be tracked. Retain necessary evidence that would otherwise be lost. Do not keep parallel current specifications or compatibility behavior merely because an old ticket or snapshot expects it.
- Documentation/specification completion is not runtime completion. Implementation status must continue to expose unresolved startup, host-safety, resource, or manual-acceptance items until the corresponding evidence exists.

## Testing Decisions

### Confirmed seams

- The user confirmed two automated/real-runtime levels plus a mandatory hands-on acceptance gate: browser/public-daemon behavioral verification; real desktop smoke and resource verification; and the user's own experience check before final delivery.
- Prefer the existing highest user-facing seam: the browser against the actual web application and daemon, with public HTTP requests for deterministic setup and assertions that do not require a UI interaction. Observe Agent requests through the existing worker protocol seam rather than testing a private cwd helper in isolation.
- Use the existing real desktop runtime seam only for facts that browser simulations and scripted workers cannot establish: actual Cage readiness, capture/input behavior, process lifecycle, host integration, and resource consumption. Extend the existing platform/load scenarios rather than adding a second desktop harness or a collection of mock-only unit suites.
- A good test fails on an observable regression: wrong work-directory ownership, wrong Screen receiving input, cancelled background work after a view switch, lingering encoder work after the last viewer closes, deleted shared files, or a real startup failure. Do not test source text, private helper names, incidental command assembly, implementation-specific React structure, or arbitrary performance constants.

### Existing prior art and its limits

- Browser conversation/create-Bot, Threads/drafts, Computer sheet, permanent deletion, managed attachments/dictation, and responsive/accessibility scenarios provide the highest existing user-flow coverage. Computer tests currently simulate peer connections and intercept many desktop requests; their passing status alone is not real projection or host-safety evidence.
- The daemon integration harness boots the real daemon with temporary storage, a random port, scripted workers, and an injectable Bot Screen runtime adapter. Its existing worker observations expose session-open/session-resume options, including cwd; the Bot mailbox tests already assert target-Bot default cwd and explicit source Thread cwd preservation.
- Working-tree HTTP tests use temporary real repositories and include useful public-interface and non-mutation patterns, but their Changes-specific capability assertions become obsolete. Preserve mixed-purpose behavioral coverage before deleting the retired tests.
- Bot Screen lifecycle tests cover deletion, restart reconciliation, reprovision generations, capacity refusal, isolated fatal roles, and application-vs-desktop outcomes. Their fake runtime adapter is appropriate for deterministic state transitions, not physical host protection.
- The existing two-Cage smoke exercises real sibling-screen pixels/input, profiles used by the fixture, and cleanup. It does not directly assert original host top-bar or shortcut usability. The standard integration harness also disables host application units; its passing result cannot stand in for the production supervision path.
- The capacity/load harness already exercises production web projection, resource sampling, static-preview and active-video stages, reconnects, deletion/provision cycles, and runtime outcomes. Reuse its process-role accounting and real transport path, but add the selected-view/background-work matrix instead of presenting four simultaneously active streams as normal use.
- The existing Web browser/public-daemon seam is also the current proof of shared client behavior for future Tauri reuse. This correction must not introduce shell-specific business behavior; actual Tauri build, WebView, and native lifecycle coverage belongs to that later delivery and is not claimed by the current browser suite.

### Shared Workspace and preservation scenarios

- Drive initial user messages, new Threads, another Bot using the same Agent, continued turns, and existing target-Bot mail flows through the real daemon interface. Inspect worker-observed cwd and Native Session identity to prove a common default without conversation merging.
- Launch an isolated test daemon from a directory that is neither its test user's shared workspace nor its product-data location. Repeat with another launch directory and on restart; the shared default must remain stable and must not resolve to source or installed program files.
- Use temporary homes and workspaces, not the user's real work directory. Prove fresh creation, reuse with existing sentinel files, non-Git operation, explicit Thread directory preservation, failure without source fallback, and shared-file survival after Bot deletion.
- Extend the existing worker observation mechanism or test-only executable worker fixture for any missing cwd evidence. If exercising actual file output is necessary, perform it only within isolated fixture directories and verify both the shared result and untouched source/install sentinels.
- Validate supported native session continuation without deleting native data or silently substituting a fresh session. Do not assert that a supplied resume option changed a backend's cwd unless the adapter's official behavior or an appropriate conformance scenario proves it.
- Include supported computer-worker launch context where it uses the default, while keeping arbitrary application behavior and browser login state outside these tests.

### Interface removal and preserved UI behavior

- Exercise the real browser UI to verify Changes is absent and no Changes requests or polling occur during initial load, Bot/Thread switching, Computer viewing, or panel closing. Verify retired public endpoints follow the daemon's ordinary missing-interface behavior rather than returning fake clean data.
- Exercise retained Computer entry, compact Preview, expanded control, fallback/error states, Bot Settings exclusivity, Composer behavior, desktop and narrow navigation, light/dark themes, keyboard focus, and reduced motion.
- Remove obsolete Changes-only assertions and fixtures after retaining the independent layout, selection, accessibility, and Computer behavior they previously covered. Do not reintroduce the feature to satisfy an old snapshot.

### Desktop failure, lifecycle, and projection scenarios

- Before a source fix, establish a safe red-capable command or scenario for the actual reported failure pattern. Existing user observations are not to be challenged or re-triggered on the host merely for confirmation. Minimize and preserve a regression only at a seam that reaches the real failure; document any missing seam honestly.
- Exercise first graphic/view activation, concurrent activation for one Bot, two independent Bots sharing one Agent, and multiple Threads using one Bot Screen. An unused Bot must not acquire a graphical runtime solely through creation.
- Through real projection where required, switch A to B while A performs observable background work. Assert the old view disconnects, no stale A pixels/input appear under B, B uses its own endpoint, and A's work continues.
- Close the last viewer and verify that viewer-driven capture and encoding stop while applications and explicit Agent screenshot requests remain usable. With another viewer still attached, closing one must not destroy the resources that viewer still requires.
- Exercise compact-to-expanded-to-compact transitions, repeated switching/reconnection, held-input release, stale-generation rejection, outstanding Takeover across navigation, and explicit return to Bot. Preserve existing per-Screen human exclusion without serializing unrelated Screen work.
- Exercise source-scoped startup failure, application failure, infrastructure failure, retry, capacity rejection, targeted teardown, and daemon reconciliation. Failures must not produce partial orphan runtimes, mislabel an application exit, cancel unrelated Bots, or erase shared files.

### Host safety and resource evidence

- The real verification path must exercise production-style child supervision with private runtime/profile artifacts and targeted cleanup. A path that disables host application units can remain a deterministic test seam but cannot be the sole evidence for the deployment path that interacts with the user manager.
- Establish host state observations before safe testing and observe top-bar availability, shortcuts, normal focus/physical input, and activation-environment integrity through Bot desktop start, use, view switches, controlled child failure, and cleanup. Do not alter the Host Session or replace actual usability evidence with sibling-only screenshots or service existence.
- If automation cannot safely verify a host interaction, state the exact evidence gap and include the interaction in the mandatory human check. No host update, global environment import, blanket process kill, compositor restart, or graphical-service restart is authorized by the test plan. If a prerequisite cannot be supplied safely, stop that scenario and report it as unmet, not passed.
- Measure: several Bots with no graphical use; retained Bot Desktop Sessions without viewers; several independent background sessions with exactly one selected projection; expanded versus compact viewing; repeated A/B switches; and all viewers closed while work continues.
- Record process/resource ownership, PSS memory, CPU sampling duration and interpretation, capture/encoding activity, retained application state, startup/switch behavior, and teardown residue. Attribute application/Agent workloads separately from plugin infrastructure; identify any combined daemon/harness measurement and unavailable attribution.
- Compare matching before/after scenarios and report the full totals alongside categories. Demonstrate removal of unnecessary background projection work without suppressing autonomous tasks or silently reducing concurrency. Do not invent an acceptable numerical threshold or assert a saving not measured.

### Mandatory human experience gate

- After automated checks and safe real-runtime verification, the user must personally confirm that the original Omarchy top bar, existing shortcuts, and ordinary desktop use remain functional while using the plugin.
- The user must also exercise viewing and switching Bots while background work continues and confirm that the observed behavior follows the accepted model.
- Record automated outcomes, real-runtime measurements, and human acceptance separately. A successful automated run does not satisfy this human gate; final end-to-end acceptance remains pending until the user's confirmation is recorded.

## Out of Scope

- Browser selection or installation per Bot; browser profiles, Cookie storage/synchronization, login sharing, account isolation, and application-internal concurrency policy. Existing fixture profiles may provide test isolation without becoming a product requirement.
- Plugin-managed file/task locks, shared-workspace serialization, Git worktree management, repository creation, causal file authorship, review workflows, artifact dashboards, or replacing Changes with another panel.
- A per-Bot filesystem workspace, separate machine/container per Bot, new native Agent permission layer, or claims of adversarial isolation under a shared Unix user.
- A full Omarchy/UWSM session per Bot, host Hyprland workspaces as isolated Screens, one shared focus/input state that serializes all desktop work, or a transport rewrite to VNC/SSH as a substitute for graphical isolation.
- Memory implementation, memory schemas, browser/app data migration, native-session deletion, or relocation of existing conversation databases and managed media.
- New Agent adapters, redesigned Bot identity, new mailbox behavior, scheduling features, or changes to native Agent capabilities beyond supplying the accepted work and display context.
- Host OS/package upgrades, Omarchy updates, global tool upgrades, graphical-session restarts, host environment import/repair, or destructive cleanup of unrelated work.
- Shipping Tauri/native packaging, native shell integrations, remote pairing, auto-update, new platform support promises, authentication/remote-access redesign, new network exposure, a new design system, or arbitrary-URL browsing functionality. Preserving Web reuse and client/execution separation for the future Tauri Bot Client is in scope.
- Hardware encoder/driver changes, arbitrary new capacity promises, unmeasured resource guarantees, or idle eviction that discards applications or unsaved work.
- Implementing runtime changes, running desktop scenarios, deleting old specifications, or generating implementation tickets as part of publishing this specification. These are subsequent implementation/ticketing work, not completed by this document.

## Further Notes

- This specification synthesizes the confirmed design conversation and does not reopen the product choices. The user explicitly selected automatic/public-interface checks plus real desktop/resource verification **and a mandatory hands-on experience gate**.
- Authority: [CONTEXT-MAP](../../CONTEXT-MAP.md), the [Workspace glossary](../../docs/contexts/workspace/CONTEXT.md), [Agent Integration glossary](../../docs/contexts/agent-integration/CONTEXT.md), [Computer Control glossary](../../docs/contexts/computer-control/CONTEXT.md), [current product model](../../docs/workspace-redesign.md#shared-workspace-and-plugin-boundary), and [system ADR 0009](../../docs/adr/0009-share-work-files-isolate-bot-screens.md).
- [Computer ADR 0009](../../docs/contexts/computer-control/adr/0009-adopt-sway-bot-desktops.md) is the production Sway/view-only-WayVNC/native-IPC stack with existing Broker-authorized human input. [Computer ADR 0008](../../docs/contexts/computer-control/adr/0008-run-cage-bot-desktops.md) is historical Cage evidence. [Deletion ADR 0006](../../docs/adr/0006-bot-deletion-is-local-only.md) and [Takeover ADR 0003](../../docs/adr/0003-hold-takeover-at-computer-tool-boundary.md) retain native-data and human-handoff guarantees. This work does not silently revise the separately documented remote-access security policy.
- The user additionally confirmed the Web frontend's future Tauri desktop delivery. [System ADR 0010](../../docs/adr/0010-reuse-web-client-in-tauri.md) records that evolution contract; implementation of the desktop shell remains outside this effort.
- Test prior art: [daemon integration harness](../../tests/integration/helpers/harness.ts), [Computer browser flows](../../tests/e2e/specs/10-computer-sheet.spec.ts), [deletion browser flows](../../tests/e2e/specs/11-permanent-deletion.spec.ts), [responsive/accessibility coverage](../../tests/e2e/specs/13-responsive-accessible-visual-qa.spec.ts), [mailbox worker observations](../../tests/integration/bot-mailbox.test.ts), [Screen lifecycle](../../tests/integration/bot-screen-lifecycle.test.ts), and [capacity/load harness](../../tests/integration/bot-screen-capacity.load.test.ts). These are prior art, not claims that this specification's new acceptance already passes.
- The [historical capacity report](../bot-screen-media-desktop/capacity-report.json) is retained as a baseline. The four-Screen active row includes about 193 MiB compositor PSS, 569 MiB encoder PSS, 964 MiB worker/application PSS, and 356 MiB combined daemon/harness PSS. Its roughly 2 GiB/4.13-core total must not be presented as compositor-only cost or a measured shared-environment saving.
- Documentation consolidation supersedes the Changes scope of [the capability-panel specification](../workspace-capability-panel/spec.md) while retaining unrelated Composer and Computer requirements. Older [Bot Screens](../bot-screens/spec.md), [media/desktop](../bot-screen-media-desktop/spec.md), and [conversation-workspace](../ai-teammate-workspace/spec.md) specifications must not override the current model. Still-valid homes and historical evidence are accounted in [the requirement map](requirement-map.md); those files were retained, not deleted.
- The current implementation still contains the launch-directory fallback and Changes capability. User-reported Screen startup and host disruption remain unresolved by this specification; no root cause, runtime repair, host-safety pass, resource improvement, or human acceptance is claimed here.
- The effort spans directory resolution, interface removal, desktop lifecycle/projection, diagnosis, real-world acceptance, and documentation consolidation. The next flow is tracer-bullet ticket decomposition with explicit blocking edges, not a wholesale parallel rewrite or another product interview. Each implementation slice must preserve the accepted model and leave honest evidence of what it completed.
