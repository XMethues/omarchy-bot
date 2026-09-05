# Current vs historical documentation

Status: current routing map (2026-09-05). This accounts for still-valid requirements and historical evidence. Runtime tickets 01–07 have landed; mandatory human host acceptance remains open.

Read this map when an older specification, ticket, or research note appears to prescribe Changes, a single Shared Screen, nested Hyprland, per-Bot browser/profile/login policy, or four-stream capacity as current acceptance.

## Current authority

| Kind | Document | Role |
| --- | --- | --- |
| Implementation specification | [Shared Workspace and Bot Desktop Boundary Correction](spec.md) | Current accepted implementation contract. Tickets 01–08 are resolved; ticket 09 human host acceptance remains unmet. |
| Product model | [workspace-redesign.md](../../docs/workspace-redesign.md#shared-workspace-and-plugin-boundary) | Directory, ownership, Computer Surface, host-safety/resource evidence, and implementation gaps. |
| Cross-context decisions | [ADR 0009](../../docs/adr/0009-share-work-files-isolate-bot-screens.md), [ADR 0010](../../docs/adr/0010-reuse-web-client-in-tauri.md) | Shared files vs isolated Screens; Web-to-Tauri reuse. |
| Routing | [CONTEXT-MAP.md](../../CONTEXT-MAP.md) | Context and current-vs-historical entry. |
| Glossaries | [Workspace](../../docs/contexts/workspace/CONTEXT.md), [Agent Integration](../../docs/contexts/agent-integration/CONTEXT.md), [Computer Control](../../docs/contexts/computer-control/CONTEXT.md) | Definitions only. |
| Current compositor | [Computer ADR 0008](../../docs/contexts/computer-control/adr/0008-run-cage-bot-desktops.md) | On-demand pure-headless Cage. |
| Deletion / Takeover | [ADR 0006](../../docs/adr/0006-bot-deletion-is-local-only.md), [ADR 0003](../../docs/adr/0003-hold-takeover-at-computer-tool-boundary.md) | Native-data survival; tool-scoped handoff. |

Do not change these product choices from older tickets. Do not treat this documentation cutover as Screen-startup repair, host-safety proof, measured savings, or human acceptance.

## Vocabulary

Glossaries define terms. Specs and ADRs hold rules and acceptance.

| Term | Glossary | Avoid treating as |
| --- | --- | --- |
| Bot | [Workspace](../../docs/contexts/workspace/CONTEXT.md) | Agent inventory, a desktop session |
| Agent | [Agent Integration](../../docs/contexts/agent-integration/CONTEXT.md) | A user-created teammate |
| Thread | [Workspace](../../docs/contexts/workspace/CONTEXT.md) | Native Session, Bot Screen |
| Native Session | [Agent Integration](../../docs/contexts/agent-integration/CONTEXT.md) | Thread, Bot Desktop Session |
| Shared Workspace | [Workspace](../../docs/contexts/workspace/CONTEXT.md) | Plugin checkout, Bot Screen, Git sandbox |
| Host Session | [Computer Control](../../docs/contexts/computer-control/CONTEXT.md) | A Bot Desktop Session |
| Bot Screen | [Computer Control](../../docs/contexts/computer-control/CONTEXT.md) | Hyprland workspace, security sandbox |
| Bot Desktop Session | [Computer Control](../../docs/contexts/computer-control/CONTEXT.md) | Native Session, viewer connection |
| Screen Projection | [Computer Control](../../docs/contexts/computer-control/CONTEXT.md) | Desktop ownership, Shared Screen |
| Bot Client | [Workspace](../../docs/contexts/workspace/CONTEXT.md) | Agent runtime, Host Session |

## Recoverability

No historical specification or ticket was deleted. Tracked `.scratch` files remain in git. Unique measurements, experiment notes, and ticket Answers stay in place as historical evidence. The parent specification under this directory was untracked at cutover and is the current implementation spec, not a deletion candidate.

## Document accounting

| Document | Disposition | Still-valid home / evidence fate |
| --- | --- | --- |
| [capability-panel spec](../workspace-capability-panel/spec.md) | Mixed; Changes retired | Composer, Computer Surface, layout, accessibility → [workspace-redesign](../../docs/workspace-redesign.md) and [parent spec](spec.md). Changes/Git/cwd-fallback → retired. Delivery Answer is historical; removal is still an implementation gap. |
| [capability-panel 01](../workspace-capability-panel/issues/01-extract-computer-surface-content.md) | Historical Computer extract | Computer Surface hostable content → workspace-redesign Computer, parent stories 29, 51–65. |
| [capability-panel 02](../workspace-capability-panel/issues/02-ship-compact-composer-dock.md) | Historical Composer delivery | Composer dock → workspace-redesign Composer/Voice, parent story 30. |
| [capability-panel 03](../workspace-capability-panel/issues/03-open-browser-in-capability-panel.md) | Mixed | Computer Surface, Bot Settings exclusivity, narrow one-panel, projection cleanup → current Computer/IA docs. “Browser” tab pairing with Changes → retired. |
| [capability-panel 04](../workspace-capability-panel/issues/04-show-working-tree-summary.md) | Fully superseded | No current product requirement. Historical delivery only. Do not preserve or reintroduce Changes. |
| [capability-panel 05](../workspace-capability-panel/issues/05-open-bounded-file-diff.md) | Fully superseded | No current product requirement. Do not replace Changes with a review or artifact panel. |
| [capability-panel 06](../workspace-capability-panel/issues/06-complete-refresh-and-responsive-acceptance.md) | Mixed | Composer, Computer, responsive/accessibility → current docs. Changes refresh/polling/diff state → retired. |
| [bot-screens spec](../bot-screens/spec.md) | Mixed; nested Hyprland retired | Per-Bot Screen identity, independent input, Preview/Web Control/Takeover, local deletion, non-adversarial isolation → ADR 0008/0009, workspace-redesign Computer, parent spec. Nested Hyprland mechanism and per-Bot application-profile policy → historical. Four-stream capacity → evidence only. |
| [bot-screens issues 01–11](../bot-screens/issues/) | Historical delivery | Resolved implementation record. Do not revive nested Hyprland, Shared Screen, or profile/login policy from their acceptance lines. |
| [media/desktop spec](../bot-screen-media-desktop/spec.md) | Mixed; Hyprland-until-Cage retired | Cage, PNG/H.264, neutral Bot Desktop, viewer ≠ session lifetime → ADR 0008/0009, parent spec. Per-Bot browser/profile/login → retired. Four-stream gate → historical evidence. Experiment notes remain evidence. |
| [media/desktop issues 01–08](../bot-screen-media-desktop/issues/) | Historical delivery | Cage/H.264 cutover record. Sibling smoke and capacity rows are not current Host Session or normal-use-cost acceptance. |
| [capacity-report.json](../bot-screen-media-desktop/capacity-report.json) | Historical evidence | Baseline measurements only. Not an accepted normal-use budget or host-safety pass. |
| [ai-teammate-workspace spec](../ai-teammate-workspace/spec.md) | Mixed; Shared Screen retired | Bot/Agent identity, Composer, drafts, attachments, dictation, steering, migration, Computer glyph/Takeover, Astryx/a11y → workspace-redesign and related current specs. Global Shared Screen serialization and emergency control → retired. Archive/Activity already superseded elsewhere. Tauri exclusion superseded by ADR 0010. |
| [ai-teammate-workspace issues](../ai-teammate-workspace/issues/) | Historical conversation delivery | Still-valid conversation behavior lives in workspace-redesign. Shared Screen tickets are not current desktop instructions. |
| [Computer ADR 0007](../../docs/contexts/computer-control/adr/0007-provision-nested-hyprland-per-bot.md) | Historical decision | Retained rationale: Bot-owned Surfaces, private sockets, independent input, non-adversarial isolation (now in 0008/0009). Nested Hyprland / parent-Wayland mechanism retired. Measurements are historical capacity evidence. |
| [Computer ADR 0001](../../docs/contexts/computer-control/adr/0001-computer-broker-backend.md) | Mixed | MCP computer-worker backend remains. Single-Shared-Screen backend is historical. |
| [Computer ADR 0004](../../docs/contexts/computer-control/adr/0004-hide-single-screen-input-arbitration.md) | Mixed | Hide coordination details remains. Global Shared Screen serialization is historical. |
| [Computer ADR 0005](../../docs/contexts/computer-control/adr/0005-project-shared-screen-over-webrtc.md) | Fully superseded | Shared Screen projection model retired. Current transport/compositor: ADR 0008. |
| [feasibility research](../../docs/research/omarchy-bot-screen-feasibility.md) | Historical evidence | Nested-Hyprland probes retained. Production compositor is Cage (ADR 0008). |
| [GitHub issues research](../../docs/research/github-open-issues-implementation-details.md) | Historical notes | Dated 2026-09-04. Do not implement Changes from its #5 recommendation. Composer/Computer seams remain in current docs. |
| [multi-bot computer research](../../docs/research/multi-bot-computer-control.md) | Historical evidence | Grok-style per-Bot screens and contextual Takeover informed ADR 0003/0009; not a Changes or profile-policy source. |

## Mixed-document requirement maps

### Capability-panel specification

| Source | Disposition | Current home |
| --- | --- | --- |
| Stories 1–13, 46; Composer implementation/testing | Retained | [workspace-redesign Composer and Voice](../../docs/workspace-redesign.md#7-composer); parent stories 30, 33 |
| Stories 14, 17, 19; Bot Settings exclusivity; narrow one-panel | Retained | [workspace-redesign IA / Bot Settings](../../docs/workspace-redesign.md#2-information-architecture); parent stories 31–32 |
| Stories 16, 39–42; Computer Surface not an iframe/webview | Retained | [workspace-redesign Computer](../../docs/workspace-redesign.md#10-computer); parent stories 29, 51–65 |
| Story 44 projection/selection cleanup (Computer) | Retained | Parent stories 51–54 |
| Story 45 compact rail, not an IDE | Retained as Computer constraint | Parent story 28; workspace-redesign plugin boundary |
| Astryx-only; no Board/Tailwind | Retained | [workspace-redesign visual system](../../docs/workspace-redesign.md#12-visual-system); [technology-selection](../../docs/technology-selection.md) |
| Cage/H.264; no nested Hyprland revival | Retained | ADR 0008, ADR 0009 |
| Stories 15, 20–38, 43, 47–48; Git cwd fallback; Changes API/UI/polling | Retired | Do not reintroduce. Removal landed in ticket 02. |

### Bot Screens specification

| Source | Disposition | Current home |
| --- | --- | --- |
| One Bot Screen identity; many Threads; Bots sharing an Agent stay separate | Retained | ADR 0009; workspace-redesign Computer; parent stories 36–39 |
| Independent pixels, focus, pointer, keyboard; concurrent Bots | Retained | ADR 0008/0009; parent stories 40–41 |
| Preview read-only; Expanded Web Control; Takeover/return; incomplete Takeover stays unfinished | Retained | workspace-redesign Computer; ADR 0003; parent stories 57–65 |
| Switch projection without cancelling the other Bot | Retained | ADR 0009; parent stories 51–55 |
| Deletion removes plugin-owned runtime; Native Sessions survive | Retained | ADR 0006, ADR 0009; parent story 75 |
| Host Session stays one Omarchy/UWSM login; no child autostart/import-environment | Retained | ADR 0008/0009; parent stories 44, 68–73 |
| Isolation is routing, not an adversarial sandbox | Retained | ADR 0008/0009; parent story 76 |
| ADR 0004 unauthenticated-remote-access posture | Retained | [ADR 0004](../../docs/adr/0004-defer-web-control-transport-security.md) |
| Nested Hyprland / parent-Wayland bootstrap / `hyprctl` readiness | Retired | Historical in ADR 0007. Current: ADR 0008 |
| Per-Bot browser/Electron profile or login-sharing policy | Retired | ADR 0009; parent story 7. Private runtime directories remain plugin-owned |
| Four concurrent 1080p streams as default capacity or host-safety proof | Historical evidence | [capacity-report.json](../bot-screen-media-desktop/capacity-report.json); current acceptance: [required evidence](../../docs/workspace-redesign.md#required-host-safety-and-resource-evidence) |

### Media and desktop specification

| Source | Disposition | Current home |
| --- | --- | --- |
| Cage sole compositor; pure-headless; no dual runtime | Retained | ADR 0008; parent desktop decisions |
| PNG Preview, H.264 Web Control, HTTP snapshot fallback | Retained | ADR 0008; workspace-redesign Computer; parent stories 57–59, 65 |
| Neutral persistent Bot Desktop; app exit ≠ Screen death | Retained | workspace-redesign Computer; parent stories 42–43 |
| Stop expanded encoding when unused; Agent screenshots without a viewer | Retained | ADR 0009; parent stories 56, 60 |
| Independent per-Bot input; viewer switch ≠ session destroy | Retained | ADR 0009; parent stories 40, 51–55 |
| “Nested Hyprland remains production until Cage passes” | Historical | Cage cutover recorded in media/desktop ticket 08 and ADR 0008 |
| Per-Bot browser/profile/Cookie/login policy | Retired | ADR 0009; story 20 already marked superseded |
| Four-Screen active-stream gate as normal-use cost | Historical evidence | capacity-report.json; parent stories 77–84 |
| JPEG/H.264/wayvnc/Cage prototype numbers in Further Notes | Historical evidence | Keep with stated limits; not current acceptance |

### AI teammate workspace specification

| Source | Disposition | Current home |
| --- | --- | --- |
| User-created Bots; immutable Agent; many Bots per Agent | Retained | workspace-redesign Bot and Agent; [ADR 0002](../../docs/adr/0002-user-created-bots-reference-agents.md) |
| Sidebar, Header, Composer, drafts, attachments, dictation, steering | Retained | workspace-redesign §§2–8 |
| Native Agent capabilities and inventory | Retained | workspace-redesign Native Agent; [agents-integration](../../docs/agents-integration.md) |
| Migration/provenance | Retained | workspace-redesign Migration boundary |
| Computer glyph; contextual Takeover; no lease UI | Retained | workspace-redesign Computer; ADR 0003 |
| Accessibility, themes, Astryx | Retained | workspace-redesign visual system |
| Stories 12–15 archive/restore | Already superseded | [bot-activity-lifecycle](../bot-activity-lifecycle/spec.md); ADR 0006 |
| Stories 60–62 compact Activity | Already superseded | [ordered-rich-transcript](../ordered-rich-transcript/spec.md); [ADR 0007](../../docs/adr/0007-preserve-ordered-agent-blocks.md) |
| Stories 77–83 Shared Screen serialization / emergency control | Retired | Per-Bot Screens: ADR 0008/0009; parent stories 40, 61 |
| Out of scope “independent per-Bot Screens” | Historical exclusion | Now required by ADR 0009 and the parent spec |
| Out of scope “Tauri client” as permanent exclusion | Superseded | [ADR 0010](../../docs/adr/0010-reuse-web-client-in-tauri.md); no native scaffolding now |

## What this cutover does not claim

- Shared Workspace default is implemented.
- Changes is removed from the running product.
- Screen startup or host-disruption root causes are known.
- Host top-bar/shortcut safety or normal-use resource savings are proven.
- The user has completed hands-on acceptance.
- Tauri packaging, WebView codecs, or native lifecycle are verified.
