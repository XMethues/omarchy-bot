# Current GitHub issues: implementation details

Research date: 2026-09-04

Scope: the three open issues currently listed for `XMethues/omarchy-bot`: [#2](https://github.com/XMethues/omarchy-bot/issues/2), [#3](https://github.com/XMethues/omarchy-bot/issues/3), and [#5](https://github.com/XMethues/omarchy-bot/issues/5).

## Executive decisions

| Issue | Current state | Recommendation |
| --- | --- | --- |
| [#2 Bot-to-bot in-app mailbox](https://github.com/XMethues/omarchy-bot/issues/2) | Not implemented. The current Thread and Agent-worker contracts cannot represent durable peer delivery or attribution. | Implement after a Workspace/Agent Integration ADR fixes the v1 conversation, delivery, retry, and deletion semantics. Use target-owned, user-visible Threads plus a durable delivery queue; do not turn this into A2A/RPC. |
| [#3 Bot Screen transport/Desktop](https://github.com/XMethues/omarchy-bot/issues/3) | Its transport and compositor assumptions are superseded. Cage, PNG preview, H.264 Expanded Web Control, persistent neutral Bot Desktop, and removal of Alacritty are already implemented and verified. | Close as superseded/resolved. Do not implement its nested-Hyprland or data-channel-frame direction. Track richer Desktop chrome separately only if the newer neutral-Desktop decision is intentionally changed. |
| [#5 Composer dock + Changes/Browser panel](https://github.com/XMethues/omarchy-bot/issues/5) | Not implemented, but it fits existing Astryx and Computer Surface seams. | Implement incrementally. Composer chrome is a small web-only cut. Browser v1 should host the existing Computer Surface. Changes v1 should report the effective Thread Git working tree, explicitly without Agent attribution. |

Recommended order:

1. Close #3 with links to the superseding ADR, resolved implementation tickets, and capacity approval.
2. Ship #5 Composer chrome.
3. Refactor the existing Computer Surface into #5's Browser tab without changing its protocol.
4. Add #5's Git-backed Changes API and UI.
5. Resolve #2's domain decisions in an ADR, then implement its persistence/worker/UI vertical slice.

# Issue #2 — Bot-to-bot in-app mailbox

## Confirmed current seams and gaps

The issue's premise is compatible with the product model: a Bot has a stable ID and references one Agent, while multiple Bots may use the same Agent (`docs/contexts/workspace/CONTEXT.md`, `docs/contexts/agent-integration/CONTEXT.md`, `docs/adr/0002-user-created-bots-reference-agents.md`, `packages/protocol/src/api.ts` `BotDto`). Addressing must therefore use `botId`, never `agentId`.

The current conversation model is deliberately narrower than peer mail:

- `packages/domain/src/thread.ts` says a Thread owns exactly one Bot. `Thread.botId` is singular.
- The same file says messages carry no per-author Bot identity. `Author` is only `{kind: "user" | "bot" | "system"}`.
- `packages/protocol/src/api.ts` enforces that Bot output uses ordered Response/Thinking/Tool/Event records; a Bot cannot currently author a text message.
- `apps/daemon/src/modules/threads/threads.ts` stores only `author_kind`; it cannot identify a peer Bot author.
- `apps/daemon/src/modules/turns/turns.ts` treats an active turn on the same Thread as Steering and otherwise starts/resumes the Thread's one Native Session.
- `packages/agent-contract/src/agent-protocol.ts` has no Bot-mail request. Worker-originated daemon requests currently cover the Computer tool only.
- `workers/pi/src/computer-tool.ts` and `workers/pi/src/worker.ts` provide the reusable pattern: a custom Agent tool sends an immutable Turn-bound request to the daemon and receives a bounded result.
- `apps/daemon/src/modules/events/eventLog.ts` is a durable UI replay log, not a work queue. It has no claim, retry, or delivered state.
- `apps/daemon/src/modules/bots/bots.ts` increments unread attention for Bot responses. No operation currently records an inbound peer message as target-Bot attention.

The old `0001-initial` schema in `apps/daemon/src/persistence/db.ts` once had `threads.kind` and `messages.author_bot_id`, but migration `0002-user-created-bots` intentionally replaced that model with the current one-Bot Thread model. Reusing those old column names without a new domain decision would silently reintroduce an abandoned architecture.

## Recommended v1 domain shape

Use the option already allowed by [issue #2](https://github.com/XMethues/omarchy-bot/issues/2): a **user-visible system Thread on the target Bot**. Do not make an existing conversational Thread multi-owner in v1.

One peer send creates one target-owned Thread containing:

1. a typed, visible inbound peer-mail record;
2. one fresh target Turn;
3. the target Bot's ordinary ordered output records.

A reply is another send in the opposite direction, exactly as the issue specifies. This deliberately favors correct isolation and current invariants over a unified two-party transcript. A later product revision may group these delivery Threads in the UI without changing delivery semantics.

Recommended message projection:

```ts
interface PeerMailPayload {
  type: "peer_mail";
  deliveryId: string;
  senderBotId?: string;       // absent after sender deletion
  senderName: string;         // immutable display snapshot
}
```

Persist the inbound record as a system text message with this typed payload. `ChatPanel` already renders system text through Astryx `ChatSystemMessage` (`apps/web/src/components/ChatPanel.tsx`). Add a peer-mail rendering branch so the user sees `From <Bot name>` and the exact body, while leaving ordinary system notes unchanged. This preserves the rule that Agent-generated Bot output remains ordered Response/Thinking/Tool/Event records.

Each delivery gets a new Thread and a fresh `session.open`, not `session.resume`. This gives the target only:

- its own Bot instructions;
- the one inbound body and sender identity;
- no sender Thread history, messages, Native Session, or memory.

This is the smallest design that can prove the issue's privacy acceptance condition using current Agent boundaries.

## Durable delivery state

A queue cannot be reconstructed safely from the UI event log. Add one daemon-owned SQLite table, justified specifically by claim/retry semantics:

```sql
CREATE TABLE bot_mail_deliveries (
  id TEXT PRIMARY KEY,
  sender_bot_id TEXT REFERENCES bots(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL,
  target_bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  source_turn_id TEXT NOT NULL,
  source_tool_call_id TEXT NOT NULL,
  thread_id TEXT NOT NULL UNIQUE REFERENCES threads(id) ON DELETE CASCADE,
  inbound_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  target_turn_id TEXT REFERENCES turns(id),
  state TEXT NOT NULL CHECK (state IN ('queued','dispatching','delivered','failed')),
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_turn_id, source_tool_call_id)
);
```

Required invariants:

- Enqueue, target Thread creation, inbound message insertion, and delivery row insertion are one SQLite transaction.
- The daemon acknowledges the sender only after that transaction commits.
- `(source_turn_id, source_tool_call_id)` makes a retried worker request idempotent.
- Dispatch claims `queued` atomically. A startup reconciliation returns orphaned `dispatching` rows to `queued` unless a linked target Turn already exists.
- A target Agent that is not ready leaves the delivery queued. Retry is triggered at daemon startup, after enqueue, and on an Agent Readiness transition to `ready`; it is not a busy poll.
- Target deletion cascades its queued work. Sender deletion must not delete the target-owned visible Thread; `sender_name` preserves attribution while `sender_bot_id` becomes null.
- Attachments remain out of v1. Current managed attachments are Bot-owned and accepted only on user text messages (`packages/protocol/src/api.ts`, `apps/daemon/src/modules/attachments/attachments.ts`); transferring ownership needs a separate explicit contract.

## Agent tool and worker protocol

Add a custom tool named for the product operation, for example `send_bot_message`, with only:

```ts
{ targetBotId: string; text: string }
```

Do not accept `senderBotId` from tool arguments. The daemon derives it from the immutable active Turn binding, as Computer requests derive Bot/Turn/Surface authority today (`AgentComputerTurnContext` in `packages/agent-contract/src/agent-protocol.ts`; `TurnService.onAgentComputerRequest` in `apps/daemon/src/modules/turns/turns.ts`).

Concrete changes:

- `packages/agent-contract/src/agent-protocol.ts`: add `AgentBotMailRequest`, cancel/result shapes if cancellation is supported, and include the request in `WorkerOutbound`.
- `apps/daemon/src/supervision/workerClient.ts`: route the new request with its own bounded handler; do not overload Computer request handling.
- `apps/daemon/src/modules/turns/turns.ts`: validate that request session, Turn, tool-call identity, and source Bot match the live context.
- New `apps/daemon/src/modules/mail/botMail.ts`: own enqueue, idempotency, claim/reconcile, dispatch, and attention. Keep this state machine out of `ThreadsService`.
- `workers/pi/src/bot-mail-tool.ts`: define the Pi custom tool following `computer-tool.ts`; register it beside the Computer tool in `workers/pi/src/worker.ts`.
- Future Agent adapters must implement the same worker contract only when they can expose the custom tool honestly. Do not report it as a native Agent capability and do not add an application approval gate; [issue #2](https://github.com/XMethues/omarchy-bot/issues/2) explicitly preserves native Agent behavior.

The tool result should contain only a delivery ID and an acknowledgement such as `Queued for <target name>`. It must never contain the target's later response.

One unresolved requirement must be made explicit: the current Pi tool seam can acknowledge a tool and then the native Agent may continue generating. It does not expose a generic “complete this Turn successfully now” operation. Prompt guidance can tell the Bot to end after a successful send, but a hard forced end would require Agent-specific lifecycle support or an abort, and abort would falsely mark the Turn cancelled. Treat “deliver, then return” as the required non-blocking semantic; if immediate forced Turn completion is mandatory, resolve that capability gap before coding.

## Target wake flow

1. Source Bot calls `send_bot_message`.
2. `WorkerClient` forwards a Turn-bound request.
3. `BotMailService.enqueue` validates a distinct existing target Bot that is not being deleted, snapshots its current sender name, creates the target Thread/message/delivery atomically, records target attention, and returns the ack.
4. After the ack path is independent, `BotMailService` claims the delivery.
5. The dispatcher creates a target Turn and calls a dedicated `TurnService.startPeerMailTurn` path.
6. That path always opens a fresh Native Session with the target Bot's instructions, then sends only a daemon-authored envelope such as `Message from Bot <name> (<id>):\n\n<body>` to the worker.
7. Normal worker events append target Response/Thinking/Tool/Event records to the visible target Thread.
8. The worker's `message.send` acknowledgement marks the delivery `delivered`; a later target Turn failure remains visible as an ordinary failed Turn. Failures before worker acceptance remain retryable or become explicitly `failed`.

Creating a new target Thread per delivery also avoids converting peer input into Steering. It follows existing behavior in which work in separate Threads can start independently and does not invent a parallel abort path.

## Public API and web behavior

No public A2A endpoint is needed. Existing Thread/message APIs make the exchange readable. Add only typed DTO support needed by the UI and, if useful for operational display, a target-Bot mailbox status endpoint. Keep the daemon listener policy unchanged; [issue #2](https://github.com/XMethues/omarchy-bot/issues/2) requires localhost product behavior, not discovery or JSON-RPC.

Update:

- `packages/domain/src/thread.ts`: typed peer-mail payload guard.
- `packages/protocol/src/api.ts`: peer-mail payload/request acknowledgement schemas and conditional Message validation.
- `packages/api-client/src/index.ts`: only if a mailbox-specific read/status endpoint is introduced.
- `apps/web/src/components/ChatPanel.tsx`: visible peer sender rendering.
- `apps/web/src/components/HistoryDialog.tsx`: no special store; target-owned Threads already appear in history.
- `apps/daemon/src/modules/bots/bots.ts`: `recordPeerMessage` updates recency, preview, unread count, and `unreadThreadId` for the target.
- `apps/web/src/lib/events.ts`: existing `thread.created`, `message.appended`, Turn, and `bot.attention` invalidations should remain sufficient; add no hidden mailbox event stream.

## Acceptance verification

Add focused integration scenarios with fake workers:

- persist and ack before target execution completes;
- daemon restart between ack and dispatch still starts exactly one target Turn;
- duplicate source tool request returns the same delivery and creates no duplicate Thread/message/Turn;
- target worker receives target instructions plus exactly one inbound mail envelope, never source transcript/history;
- target not ready remains queued and wakes after readiness becomes `ready`;
- source and target may use the same Agent without confusing Bot identity;
- target response and inbound mail are both returned by existing Thread/message APIs;
- target unread/attention points to the peer-mail Thread;
- sender deletion preserves target transcript attribution; target deletion removes queued work;
- active unrelated target work is neither steered nor aborted;
- attachments and self-send are rejected in v1.

Add one browser behavior case only for the new visible sender treatment and unread navigation. Document the 1:1 send tool and expected asynchronous transcript flow in `README.md`, as required by the issue.

# Issue #3 — Bot Screen transport and Bot Desktop

## The issue is superseded by the current repository

The issue says to keep nested Hyprland and WebRTC data-channel frames. That is no longer the accepted architecture.

`docs/contexts/computer-control/adr/0008-run-cage-bot-desktops.md` now requires:

- pure-headless Cage as the sole production compositor;
- one private Wayland socket/output and persistent Bot Desktop per Bot;
- low-frequency lossless PNG for Computer Preview;
- H.264 WebRTC media for Expanded Web Control;
- HTTP PNG only as a read-only fallback.

ADR 0008 explicitly supersedes the compositor mechanism in `docs/contexts/computer-control/adr/0007-provision-nested-hyprland-per-bot.md` while retaining Bot ownership, private sockets, independent input/focus, measured capacity, cleanup, and the non-adversarial isolation boundary.

The implementation matches ADR 0008:

- `apps/daemon/src/modules/computer/cageBotScreenRuntime.ts` launches Cage with `WLR_BACKENDS=headless`, a private mode-0700 runtime/profile, explicit geometry, the Bot Desktop, capture helper, input helper, and Surface-bound computer worker.
- `apps/daemon/native/bot-desktop/main.c` commits a persistent neutral fullscreen Wayland surface. No Alacritty process defines readiness or lifetime.
- `apps/daemon/src/modules/computer/screenProjection.ts` keeps PNG preview at one-second intervals and uses the H.264 encoder for expanded mode.
- `apps/daemon/src/modules/computer/h264Encoder.ts` implements Baseline-compatible H.264 access units and the 90 kHz RTP clock declared by `packages/protocol/src/api.ts` protocol version 2.
- `README.md` lists Cage, `wlr-randr`, `grim`, and FFmpeg/libx264 as the production prerequisites and describes the PNG/H.264 split.

The local tracked effort records completed implementation and proof:

- `.scratch/bot-screen-media-desktop/issues/03-stream-expanded-web-control-over-h264.md`: resolved H.264/PNG hybrid transport.
- `.scratch/bot-screen-media-desktop/issues/05-launch-cage-bot-desktop.md`: resolved persistent neutral Desktop and removal of Alacritty as sentinel.
- `.scratch/bot-screen-media-desktop/issues/08-cut-over-production-bot-screen.md`: resolved clean production cutover and legacy path removal.
- `apps/daemon/src/bootstrap/bot-screen-capacity-approval.json`: schema-v3 approval for four 1080p Screens; recorded p50/p95 input-to-visible results are 42.1/68.4 ms.

The experiments requested by #3 are also recorded in `.scratch/bot-screen-media-desktop/spec.md`:

- matched PNG/JPEG measurements and the H.264 prototype are in “Further Notes”;
- the child-socket wayvnc 0.10.1 probe captured the correct output and injected input;
- Cage/labwc/nested-Hyprland resource measurements led to the Cage selection.

## Remaining conflict: richer Desktop chrome

Issue #3 asks for wallpaper, a bar, a launcher, and shortcuts. The newer accepted spec deliberately chose a neutral persistent Desktop with **no panel, wallpaper service, portal stack, notification daemon, clipboard bridge, or runtime controls** (`.scratch/bot-screen-media-desktop/spec.md`, “Implementation Decisions”; resolved ticket 05 repeats that contract).

Therefore no current implementation task should add that chrome under #3. If a richer idle Desktop is still desired, open a new product issue that answers:

- whether chrome is visible only while no application is active;
- how it works with Cage's kiosk/full-output presentation;
- whether it is part of the existing native `omarchy-bot-desktop` client or a service/process;
- which buttons/shortcuts may launch applications and how they stay inside the Surface-bound computer-worker authority;
- the added memory, lifecycle, accessibility, input, and two-Screen isolation gates.

That issue must intentionally amend the neutral-Desktop decision; it must not revive nested Hyprland, a full Omarchy/UWSM session, or VNC.

## Triage action

Close #3 as superseded/resolved, linking ADR 0008, resolved ticket 08, and the checked capacity approval. No product code is required for this GitHub issue.

One documentation cleanup is appropriate: `docs/research/grok-screen-transport.md` still describes the then-current image DataChannel path in its comparison section. Add a historical/superseded note pointing to ADR 0008; do not rewrite the original research evidence as if it had measured the later H.264/Cage stack.

# Issue #5 — Composer dock and Changes/Browser right region

## Composer: existing Astryx API already fits

Current composition is in `apps/web/src/components/ChatPanel.tsx`:

- Astryx `ChatComposer`, `ChatComposerInput`, and `ChatComposerDrawer` already own the editable surface, staged attachments, send, voice, disabled state, and status.
- Attach currently uses `headerActions`; dictation uses `sendActions`.
- Window-scoped draft, attachment restore, drop, voice insertion, Steering, focus, and transcript-attention behavior are application state around the Composer and must remain untouched.

The pinned dependency is `@astryxdesign/core@0.5.2` (`apps/web/package.json`). Its installed `ChatComposerProps` supports `density`, `elevation`, `footerActions`, `sendActions`, `sendButton`, and `xstyle`; its default component radius is 28 px and compact density reduces padding. This directly covers the requested 26–32 px dock without adding Board/Tailwind. The upstream visual reference itself describes a pill Composer and fixed-width changes/code plus browser preview panel ([Board AI Chat](https://www.boardui.com/components/ai-chat)); it is a Pro template, so it is reference material, not source to copy.

Recommended cut in `ChatPanel.tsx`:

- move the existing attach `Button` from `headerActions` to `footerActions`;
- use `density="compact"`;
- choose one edge treatment: `elevation="low"` for the existing light shadow, or `elevation="none"` for the Astryx hairline/focus ring. Recommended: `low`, because it already matches the requested quiet elevated dock and preserves Astryx interaction states;
- retain `sendActions={dictationButton}` and the default `ChatSendButton` so Stop never replaces Send;
- keep `ChatComposerDrawer` exactly where it is for staged files;
- add only semantic-token StyleX overrides in `apps/web/src/lib/styles.ts` if the transcript/dock surface contrast is insufficient. Do not hard-code light/dark colors and do not switch theme packages for this issue.

The default Astryx concentric radius already rounds its 32 px footer buttons. Do not add a second hand-built Composer shell.

## Right region: reuse Layout and Computer Surface

`apps/web/src/routes/index.tsx` already has one Astryx `Layout` with `content` and `end`. `BotSettingsPanel` and `ComputerPanel` are mutually exclusive occupants of `Layout.end`. On narrow screens, `ConversationWorkspace` hides while an end panel is open. Preserve this responsive model.

Recommended state:

```ts
type RightRegion = "closed" | "settings" | "capabilities";
type CapabilityTab = "changes" | "browser";
```

Rules:

- the existing Computer header glyph opens `capabilities/browser`;
- a Changes entry point opens `capabilities/changes`;
- opening Bot Settings closes capabilities and vice versa;
- the capability panel is collapsed by default;
- narrow layouts keep the current full-width end-panel behavior and explicit close/return focus;
- changing Bots clears selected file detail and rebinds Browser to the new Bot Surface before rendering any pixels.

Add `apps/web/src/components/CapabilityPanel.tsx` as the one `LayoutPanel`. Use Astryx `TabList`/`Tab` for Changes and Browser; do not introduce another layout or tab system.

Refactor `apps/web/src/components/ComputerPanel.tsx` so its current projection/controller content can render inside `CapabilityPanel` without nesting a second `LayoutPanel`. Preserve the existing `ComputerPanel` public behavior until all callers/tests move, then remove the obsolete wrapper in the same cutover. The implementation must retain:

- `ScreenProjectionConnection` ownership and Surface-tagged cleanup;
- PNG preview, H.264 expanded view, and HTTP snapshot fallback;
- Takeover/Return to Bot;
- focus return and expanded dialog behavior;
- the exact `ComputerViewDto` and projection URLs.

“Browser” v1 should therefore be the existing Computer Surface, not an iframe/webview. It lets the user observe the Bot's browser inside its Bot Screen, preserves Computer Broker and projection security semantics, and avoids an unrelated URL-navigation/storage/auth surface. Internally keep the domain term **Computer Surface**; “Browser” is only the capability-tab label.

## Changes v1 data source

Use Git working-tree truth only. Do not infer detailed changes from Tool Calls:

- `packages/domain/src/thread.ts` explicitly excludes detailed diffs from `ToolCallSummary` and exposes only optional aggregate additions/deletions.
- The issue asks for file lists and detail, which requires repository state.
- Git's official `status --porcelain` format is stable for scripts and reports index, working-tree, and untracked paths ([git-status documentation](https://git-scm.com/docs/git-status)).

Call the UI **Working tree changes**, not **Agent changes**. Multiple Bots and the user may share a checkout, so current source data cannot attribute a file to one Agent or Turn.

The effective root needs one explicit rule. `ThreadDto` already has optional `cwd`; `TurnService` uses `thread.cwd ?? process.cwd()` for Agent sessions, but current send routes do not set a new Thread cwd. For v1, the daemon should resolve changes with the same server-side rule:

```ts
selectedThread?.cwd ?? process.cwd()
```

The browser must never submit an arbitrary filesystem path. A request may carry `threadId`; the daemon validates that the Thread belongs to the selected Bot and resolves the cwd itself. If that path is not inside a Git worktree, return a typed `not_repository` empty state rather than a generic 500.

Recommended DTOs in `packages/protocol/src/api.ts`:

```ts
type ChangeStatus = "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";

interface WorkspaceChangeDto {
  path: string;             // repository-relative only
  previousPath?: string;
  status: ChangeStatus;
  additions?: number;       // absent for binary/unknown
  deletions?: number;
  binary: boolean;
}

interface WorkspaceChangesDto {
  state: "ready" | "clean" | "not_repository" | "unavailable";
  additions: number;
  deletions: number;
  files: WorkspaceChangeDto[];
  truncated: boolean;
  generatedAt: string;
}

interface WorkspaceDiffDto {
  path: string;
  patch: string;
  truncated: boolean;
}
```

Recommended endpoints:

- `GET /api/bots/:botId/changes?threadId=<id>`
- `GET /api/bots/:botId/changes/diff?threadId=<id>&path=<repo-relative-path>`

Implement a focused `apps/daemon/src/modules/changes/workspaceChanges.ts` and route module. Spawn Git directly with argument arrays; never invoke a shell. Use NUL-delimited porcelain/numstat output so spaces, tabs, newlines, and renames cannot corrupt parsing. Pass pathspecs after `--`.

Required bounds:

- short process timeout;
- bounded stdout/stderr;
- maximum file count with `truncated`;
- bounded diff bytes with `truncated`;
- reject absolute paths, `..`, NUL, and any requested path absent from the current summary;
- `--no-ext-diff` and `--no-color` for detail output;
- explicit handling for unborn repositories and untracked files;
- no mutation commands.

`git diff --numstat` covers tracked staged/unstaged changes relative to `HEAD`; status porcelain supplies untracked/conflicted/rename state. Untracked line counts require capped file reads or a bounded `git diff --no-index /dev/null -- <path>` path. Binary counts remain absent, not fabricated as zero.

Wire the client in `packages/api-client/src/index.ts`, add `changes` to the query invalidation tags in `apps/web/src/routes/index.tsx`, and refetch while the Changes tab is visible. Existing daemon events cannot reliably announce arbitrary filesystem mutations, so use a modest visible-tab interval plus manual refresh; stop polling while collapsed or on Browser.

## Changes UI behavior

`CapabilityPanel` should show:

- summary: `N working tree changes  +X  -Y`;
- clean, not-repository, unavailable, loading, and retry states;
- file rows with repository-relative path, status/New badge, and per-file counts;
- selected detail using Astryx `Code` or the existing readable code primitive;
- a bounded/truncated notice rather than silently clipping.

Do not add staging, committing, editing, terminal, branch controls, repository switching, or an IDE tree in v1.

## Acceptance verification

Composer browser coverage should protect behavior, not CSS internals:

- attach, mic, and send are circular footer actions in light and dark themes;
- Enter/Shift+Enter, attachment drawer/removal, drop, voice insertion, disabled/readiness states, and Steering still work;
- reduced motion and keyboard focus remain valid;
- visual verification at desktop and narrow widths confirms a compact dock rather than stacked header chrome.

Changes service integration coverage should use temporary repositories and assert:

- clean, modified, staged, deleted, renamed, conflicted, untracked, binary, and unborn states;
- filenames containing spaces and unusual characters;
- additions/deletions and New badge truth;
- no-repository response;
- traversal rejection, output truncation, timeout, and Git failure;
- selected Thread must belong to selected Bot.

Workspace browser coverage should assert:

- panel default closed, explicit Changes/Browser tabs, and usable empty/loading/error states;
- a file opens bounded detail;
- Computer glyph opens Browser and existing Preview/Web Control/Takeover behavior remains intact;
- Bot switch clears old diff and old Screen Projection before new content appears;
- desktop keeps conversation plus right rail; narrow layout uses the existing one-panel-at-a-time behavior.

# Cross-issue dependencies and risks

- #5 Browser depends on the current #3 implementation, but that dependency is already complete. It must reuse the Cage/H.264 Computer Surface rather than code against #3's obsolete data-channel/Hyprland wording.
- #5 Changes and #2 both touch daemon protocol/API wiring and `apps/web/src/routes/index.tsx`, but they have no semantic dependency. Implement them as separate vertical cuts to avoid one oversized migration.
- #2 is the only issue that changes the domain model and Agent-worker contract. It needs the strongest migration, restart, idempotency, and deletion proof.
- #5's Git data is workspace state, not Agent provenance. Any future “changes made by this Bot” claim requires causal instrumentation at the tool/Turn layer and cannot be inferred retrospectively from a shared checkout.
- The host graphical session remains out of scope. #3's production Bot Screens use private runtime/profile directories; no issue here requires changing or restarting the host compositor or session services.
