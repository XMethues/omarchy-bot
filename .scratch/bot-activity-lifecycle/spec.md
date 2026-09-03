# Binary Bot activity and direct deletion

Status: resolved

## Problem Statement

Omarchy Bot currently gives one Bot status field six unrelated meanings: whether a Turn is executing, whether work is waiting, whether the user is needed, whether the last Turn failed, and whether the referenced Agent is ready. A persistent Bot can therefore look unavailable or idle for reasons that do not answer the user's real question: is this Bot still working?

The presentation compounds that ambiguity. Selected and historical avatars animate, the live avatar sits beside output rather than after it, waiting states disappear from the working treatment, and errors can appear in the transcript or away from the Composer. The result does not provide one stable relationship between Bot Activity, avatar motion, unread attention, Agent Readiness, and Turn state.

Bot lifecycle has the same problem. A Bot can be archived and restored before it can be permanently deleted, even though the intended model has no disabled or archived Bot. Permanent deletion may also attempt to remove an Agent-owned Native Session, crossing an ownership boundary that varies by Agent and is unsupported by the current production Agent.

## Solution

Give Bot Activity one public meaning. A Bot is `active` while any of its Threads has an Active Turn and `inactive` otherwise. Waiting remains active; completion, cancellation, and failure are terminal. Agent Readiness, unread attention, current selection, ambient avatar motion, detailed Turn state, and contextual errors stay independent.

Use Grok-inspired placement without copying Grok's unknown internal state machine. The Sidebar uses a dedicated activity point. The selected Thread renders one temporary working avatar below its live output, and completed history keeps its content without repeating a Bot avatar beside each response. Persistent active/inactive text is unnecessary.

Remove archive and restore. A Bot exists until the user confirms permanent deletion. Deletion first stops its Active Turns, then removes only data owned by Omarchy Bot. Agent-owned Native Sessions remain untouched and are explicitly excluded from any privacy-erasure claim.

## User Stories

1. As an Omarchy Bot user, I want Bot Activity to have one meaning, so that I can understand it without learning implementation states.
2. As an Omarchy Bot user, I want every Bot to be either active or inactive, so that there is no offline state for a persistent teammate.
3. As an Omarchy Bot user, I want a Bot to become active when any of its Threads starts a Turn, so that background work is visible.
4. As an Omarchy Bot user, I want a Bot to remain active while a Turn waits for my input, so that waiting work is not mistaken for finished work.
5. As an Omarchy Bot user, I want a Bot to remain active while a Turn waits for computer access, so that resource contention is not mistaken for inactivity.
6. As an Omarchy Bot user, I want a Bot to become inactive only after all its Turns complete, are cancelled, or fail, so that the aggregate state is truthful.
7. As an Omarchy Bot user, I want separate Threads of one Bot to continue working concurrently, so that switching conversations does not stop background work.
8. As an Omarchy Bot user, I want the Sidebar to aggregate all active Threads for a Bot, so that activity remains visible when I open another conversation.
9. As an Omarchy Bot user, I want the chat working avatar to represent only the selected Thread, so that activity from another Thread is not shown under the wrong conversation.
10. As an Omarchy Bot user, I want Agent Readiness kept separate from Bot Activity, so that setup or runtime failures do not invent a third Bot state.
11. As an Omarchy Bot user, I want creation to continue rejecting a non-ready Agent, so that every newly created Bot starts from a usable configuration.
12. As an Omarchy Bot user, I want sending disabled when the selected Agent is known not ready, so that the interface does not accept work it cannot start.
13. As an Omarchy Bot user, I want the specific Agent Readiness problem shown above the Composer, so that I know why sending is unavailable and how to recover.
14. As an Omarchy Bot user, I want persistent active and inactive text omitted, so that the workspace remains visually quiet.
15. As an Omarchy Bot user, I want a dedicated point on an active Sidebar Bot, so that activity is visible without conflating it with unread attention.
16. As an Omarchy Bot user, I want an inactive Sidebar Bot to have no activity point, so that the point has one reliable meaning.
17. As an Omarchy Bot user, I want unread badges to remain independent from activity, so that unseen output is not confused with ongoing work.
18. As an Omarchy Bot user, I want generated Sidebar avatars to keep their DiceBear-native ambient motion even while inactive, so that character motion is not treated as a work signal.
19. As an Omarchy Bot user, I want uploaded Sidebar avatars allowed to remain static, so that custom images do not require fabricated internal animation.
20. As an Omarchy Bot user, I want selecting an inactive Bot to highlight its row without adding an activity point, so that navigation state and work state stay separate.
21. As an Omarchy Bot user, I want the conversation Header avatar to remain static, so that the identity control does not duplicate activity motion.
22. As an Omarchy Bot user, I want one temporary working avatar below the selected Turn's current output, so that the conversation has a clear live endpoint.
23. As an Omarchy Bot user, I want new text and tool Activity to appear above the working avatar, so that the marker follows the bottom of the growing response.
24. As an Omarchy Bot user, I want generated working avatars to use DiceBear's working or streaming animation, so that their native character motion remains available.
25. As an Omarchy Bot user, I want uploaded working avatars to use a restrained pulse, so that they still communicate current work.
26. As an Omarchy Bot user, I want the temporary chat avatar to omit a redundant activity point, so that one element does not encode the same state repeatedly.
27. As an Omarchy Bot user, I want pointer hover on the temporary avatar to reveal the Bot name and working state, so that I can inspect its meaning without permanent text.
28. As a keyboard user, I want focusing the temporary avatar to reveal the same working explanation, so that the transient marker remains understandable without hover.
29. As a screen-reader user, I want working start and end transitions announced, so that avatar motion is not the only activity signal.
30. As a motion-sensitive user, I want activity motion disabled under reduced-motion preference, so that state remains available without unwanted animation.
31. As an Omarchy Bot user, I want the working avatar removed as soon as the Turn reaches a terminal state, so that stopped work never appears active.
32. As an Omarchy Bot user, I want historical Bot messages to render without avatars, so that completed conversation reads as content rather than repeated identity chrome.
33. As an Omarchy Bot user, I want historical text, attachments, tool Activity, and necessary System content preserved, so that removing avatars does not remove conversation evidence.
34. As an Omarchy Bot user, I want a failed Turn to become inactive immediately, so that failure is never represented as continuing work.
35. As an Omarchy Bot user, I want Turn, send, model-provider, and Agent Readiness errors in a contextual card immediately above the Composer, so that errors appear where I can act on them.
36. As an Omarchy Bot user, I want applicable Retry and Close actions on the error card, so that recovery is direct.
37. As an Omarchy Bot user, I want an unresolved error card to remain until I close it, retry successfully, or send a new Turn, so that errors do not disappear before I handle them.
38. As an Omarchy Bot user, I want transient operational failures omitted from permanent message history, so that the conversation is not polluted by duplicate errors.
39. As an Omarchy Bot user, I want a Sidebar right-click menu containing Edit Profile and a final red Delete item, so that management actions stay compact.
40. As an Omarchy Bot user, I want the existing conversation Header Profile entry to remain, so that the current Bot is still easy to edit.
41. As an Omarchy Bot user, I want Settings to offer the same permanent deletion operation, so that Bot management is available from both established surfaces.
42. As an Omarchy Bot user, I want deletion to use an ordinary confirmation that names the Bot, so that the destructive action is deliberate without requiring typed-name ceremony.
43. As an Omarchy Bot user, I want deletion of a working Bot to warn that all its work will stop, so that cancellation is not surprising.
44. As an Omarchy Bot user, I want confirmed deletion to cancel every Active Turn and wait for terminal state, so that no hidden work survives its Bot.
45. As an Omarchy Bot user, I want cancelling the confirmation to leave the Bot and its work unchanged, so that opening a destructive dialog has no side effect.
46. As an Omarchy Bot user, I want permanent deletion to remove the Bot's Threads, messages, Turns, managed attachments, avatar data, drafts, events, state, leases, and local Agent-session mappings, so that Omarchy Bot does not retain ownerless data.
47. As an Omarchy Bot user, I want deletion to leave the shared Agent and every other Bot unchanged, so that one teammate cannot damage another.
48. As an Omarchy Bot user, I want deletion to work while the Agent is non-ready, so that local cleanup is not blocked by an unrelated runtime.
49. As an Omarchy Bot user, I want confirmation to state that Agent-owned Native Sessions may remain, so that deletion is not misrepresented as Agent-data erasure.
50. As an Omarchy Bot user, I want local cleanup failures reported honestly and retryably, so that partial work is never presented as successful deletion.
51. As an existing development user, I want archived Bots restored to normal visibility before archive storage is removed, so that the clean cutover never deletes them silently.
52. As an Omarchy Bot user, I want archive and restore removed from every surface, so that Bots do not retain a hidden lifecycle state.
53. As an Omarchy Bot user, I want a deleted selected Bot to fall back to another Bot or the empty workspace, so that navigation never points at removed data.

## Implementation Decisions

- The Bot domain and public protocol expose a two-value `BotActivityStatus`: `active | inactive`.
- An Active Turn is any Turn not in `completed`, `cancelled`, or `failed`. Both user-input waiting and computer waiting remain active.
- The Bot projection derives activity from all Threads belonging to the Bot. It does not read Agent Readiness or a recent-failure timer.
- Detailed Turn states remain unchanged and continue to drive Turn-specific behavior, notifications, computer handoff, and recovery.
- Agent Readiness remains a separate Agent Integration concept. A known non-ready Agent disables the selected Composer and supplies reason and guidance through the Composer error interface.
- The Sidebar consumes Bot-level aggregate activity. The conversation activity mark consumes the selected Thread's Active Turn, not the Bot aggregate.
- Avatar presentation has distinct modes rather than one selected/working/streaming ladder shared everywhere.
- In the Sidebar, generated avatars keep DiceBear-native ambient animation independently of activity, uploaded avatars may remain static, and a separate point alone carries active/inactive.
- The selected row carries selection styling without changing the avatar's activity point. Unread badges remain independent.
- The conversation Header always uses a static identity avatar.
- Historical Bot messages no longer allocate an avatar slot. Their text, attachments, tool Activity, and necessary System content remain unchanged.
- The selected Thread owns one transient working mark after its live output. Generated avatars use DiceBear working/streaming animation; uploaded images use a restrained container pulse. The mark has no activity point.
- The transient mark remains present through working and both waiting states. It disappears on every terminal state.
- The working mark exposes `{Bot name} is working` on hover and focus and exposes equivalent nonvisual state transitions.
- Reduced-motion preference suppresses both DiceBear activity animation and uploaded-image pulse while retaining static activity and accessible semantics.
- The observed Grok behavior that replaces avatar contents with animated ellipsis dots is explicitly deferred. No speculative Grok state machine is introduced.
- Selected-Thread operational errors use one error-card interface directly above the Composer. The same failure is not inserted into message history.
- The error card owns applicable retry and dismissal behavior and remains until closed, retry succeeds, or a new Turn is sent.
- Bots have no disabled or archived lifecycle state. Archive and restore interfaces, events, data fields, filters, and compatibility paths are removed in one cutover.
- Existing archived rows become visible before archived storage is removed. They are not automatically deleted.
- Permanent deletion is directly available from Settings and a pointer-only Sidebar context menu opened by right-click. The Sidebar menu contains only Edit Profile and a final destructive Delete item.
- The right-click-only Sidebar menu is a deliberate product decision for this release; no keyboard or hover-button trigger is added.
- Delete uses one shared confirmation and cleanup operation for both entry points. It does not require the user to type the Bot name.
- Confirmed deletion first cancels every Active Turn belonging to the Bot and waits for all of them to become terminal.
- The deletion module owns cleanup of Omarchy Bot data and local mappings. It never acquires an Agent worker or modifies Agent-owned Native Sessions.
- The Agent capability inventory no longer advertises native Session deletion, and the worker protocol no longer includes a native Session deletion command.
- Native-session deletion counters, failure stages, and retry checkpoints are removed. Retry state remains only where needed for real local filesystem or database cleanup failures.
- The persistence schema removes archived fields and native-session deletion checkpoint storage. Migration order first restores archived Bots, then removes obsolete schema.
- Successful deletion invalidates the Bot, Thread, message, draft, and navigation projections so stale caches or replay cannot resurrect the Bot.
- Local deletion failure keeps enough visible state for an honest retry and never reports success prematurely.
- Profile editing remains reachable from both the conversation Header and the Sidebar context menu.
- Hide from Sidebar, Sidebar sections, Pin, Mark as unread, Duplicate, and Copy Thread ID do not enter the menu in this release.

## Testing Decisions

- Tests assert externally observable contracts, state transitions, persistence outcomes, and user-visible behavior. They do not assert private helper calls, CSS class names, internal component structure, animation implementation details, or exact migration SQL.
- Two existing high-level seams cover the feature. No new public or test-only seam is introduced.
- The first seam is the daemon HTTP integration harness backed by a real temporary database and the existing fake Agent worker. It covers the domain/protocol contract, persisted state, concurrent Thread aggregation, migration, cancellation, local deletion, and retry behavior.
- The second seam is the Playwright workspace running against the existing E2E daemon and fake Agent. It covers activity presentation, error placement, pointer interactions, confirmation flows, motion preference, responsive layout, and user-visible fallback behavior.
- Daemon integration tests verify inactive creation, active Turn start, both waiting states, each terminal state, multiple concurrent Threads, last-Active-Turn termination, and Agent Readiness changes that do not alter Bot Activity.
- Protocol-facing integration assertions accept only `active` and `inactive` and reject every removed Bot activity literal.
- Existing Bot API and Sidebar attention integration tests are the prior art for Bot projections, ordering, unread independence, and event-driven refresh.
- Existing steering and computer integration tests are the prior art for Active Turn waiting, cancellation, and terminal-state barriers.
- Existing archive/restore integration tests are replaced rather than retained; their active-work confirmation and terminal barrier scenarios move to direct deletion.
- Existing permanent-deletion integration tests are revised to remove the archive prerequisite and native Session cleanup. They continue to verify owned database/file removal, sibling Bot and shared Agent survival, local failure reporting, and retry.
- Migration integration tests verify that previously archived Bots become visible and that obsolete archived and native-deletion storage does not remain part of the public model.
- Agent capability integration and conformance tests verify removal of the native Session deletion capability and command without weakening remaining capability inventory behavior.
- Playwright chat tests verify that the working mark follows streaming text and Activity, remains during waiting, disappears at terminal state, and never appears in an idle selected Thread merely because another Thread is active.
- Playwright avatar tests cover generated and uploaded avatars, Sidebar ambient motion, the independent activity point, static Header identity, historical messages without avatars, hover/focus explanation, and reduced-motion behavior.
- Playwright error tests verify that failures remove the working mark, make the Bot inactive when appropriate, render one card above the Composer, do not create a duplicate history record, and follow the agreed dismissal lifetime.
- Playwright deletion tests cover Sidebar right-click and Settings entry points, ordinary confirmation, active-work warning, cancellation, successful deletion, local cleanup failure, retry, selected-Bot fallback, and empty-workspace fallback.
- Existing chat, profile/avatar, Sidebar attention, archive/restore, permanent-deletion, and responsive visual-quality E2E suites are the prior art. Tests should extend or replace those scenarios rather than create a parallel harness.
- Visual verification covers light and dark themes, desktop and narrow layouts, generated and uploaded avatars, multiple Bots working concurrently, and reduced-motion preference.
- Accessibility checks continue for the working mark, error card, confirmation, Settings action, and resulting workspace. The pointer-only Sidebar context-menu trigger is not silently expanded into a keyboard feature.

## Out of Scope

- Reproducing Grok Bot's internal activity state machine.
- Replacing avatar contents with animated ellipsis dots.
- Adding persistent active/inactive text.
- Adding a Bot enable or disable control.
- Adding archive, restore, reversible Hide, a Hidden section, or other Sidebar sections.
- Adding Pin, Mark as unread, Duplicate, Copy Thread ID, or other Grok context-menu actions.
- Adding a hover ellipsis or keyboard trigger for the Sidebar context menu.
- Serializing Turns across a Bot's Threads or stopping work when the user switches Threads.
- Changing Agent-native approvals, steering, Turn state names, computer handoff, attachments, tool Activity retention, notifications, or unread semantics.
- Deleting, compacting, retaining, exporting, or otherwise managing Agent-owned Native Sessions.
- Claiming that permanent Bot deletion erases Agent-owned data.
- Adding new avatar renderers or modifying DiceBear SVG internals.

## Further Notes

- The accepted domain vocabulary is Bot Activity, Active Turn, Agent Readiness, Bot Lifecycle, Bot Deletion, and Native Session. Online, offline, unavailable, selected, unread, and ambient motion are not synonyms for Bot Activity.
- The decision “Bot activity is binary and independent of Agent readiness” supersedes the prior six-value Bot projection and the previous coupling between selection, activity, and avatar speed.
- The decision “Bot deletion removes only Omarchy Bot data” supersedes archived-only deletion and capability-dependent Native Session cleanup.
- Pi is the only current production Agent adapter and does not support Native Session deletion. The local-only deletion boundary therefore matches present runtime behavior while making the ownership rule explicit for future Agents.
- DiceBear supplies style-defined internal animation, not a general timeline for arbitrary Grok-like morphing. Generated SVGs are rendered as image data, so whole-avatar container motion is the available common treatment for uploaded images.
- Desktop Grok Bot was used only as an interaction reference. The observed useful seams were the transient working mark below live output and the contextual error immediately above the Composer; its undocumented status transitions are not copied.
- The product remains English-only. The working explanation is `{Bot name} is working`.
- The specification was published with `ready-for-agent` triage state, decomposed into six tracer-bullet tickets, and is now resolved with all six tickets complete.