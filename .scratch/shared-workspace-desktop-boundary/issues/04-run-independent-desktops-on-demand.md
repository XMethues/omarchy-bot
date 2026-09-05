# 04: Run independent Bot Desktop Sessions on demand

**What to build:** Bots that have not used graphical capability do not acquire running desktop stacks. A first desktop action or requested view starts the owning Bot's lightweight session, and multiple Bots can then operate independently even when they share an Agent and work files.

**Blocked by:** 03: Restore host-safe single-Bot desktop startup.

**Status:** resolved

**Source specification:** [Shared Workspace and Bot Desktop Boundary Correction](../spec.md).

**Specification coverage:** Stories 1–3, 36–46, 50, 77.

- [x] Creating a Bot or selecting a conversation without requesting desktop use creates no Cage session, application surface, capture process, or encoder for that Bot. Persistent Screen identity is not confused with running graphical infrastructure.
- [x] The first graphical tool operation or requested Computer view provisions one pure-headless Cage Bot Desktop Session for the owning Bot, using the working single-Bot path from the blocker.
- [x] Concurrent first-use requests, including an Agent action and a viewer request, converge on one current runtime instead of launching duplicate sessions or racing their identities.
- [x] Several Threads of one Bot use that Bot's Screen identity; a new Thread or Native Session does not allocate another graphical session.
- [x] Two user-created Bots referencing the same Agent retain distinct identities, Native Sessions, display endpoints, window state, focus, pointer, and keyboard state. Agent-worker reuse does not collapse Bot desktops.
- [x] Real fixture applications launched for A and B appear only on their intended Screens. Input to one leaves the other's useful application state and input unaffected; agreed parallel desktop work is not replaced with a global queue.
- [x] The plugin supplies correct display/routing context without choosing browser products, designing profile or login sharing, or installing an application per Bot.
- [x] The neutral Bot Desktop remains available between applications. An application closing or failing is distinguished from a compositor/application-surface failure and does not unnecessarily reprovision a healthy desktop.
- [x] One Bot's provisioning failure is scoped and honest, while a healthy sibling can continue. It leaves no partially admitted runtime or stale binding.
- [x] Existing admission limits remain intact: capacity refusal happens without disturbing admitted Screens or leaving partial resources. No higher capacity is asserted from an unmeasured assumption.
- [x] Tests reuse public-daemon activation and the existing injectable runtime seam for deterministic races/lifecycle outcomes, then exercise independent real desktop/input behavior through the existing private-runtime smoke seam.
- [x] Verification includes unused Bots, first use by action and by view, concurrent activation, same-Bot multiple Threads, same-Agent multiple Bots, application exit, and capacity failure. Existing tests may satisfy already-correct behavior; no source-text or incidental process-count test substitutes for the observable contract.
- [x] All real processes are private, explicitly targeted, and cleaned up without host updates, global environment imports, full Omarchy sessions, or unrelated process termination.

## Scope

This ticket establishes activation and independent desktop operation. It does not decide viewer lifetime, stop applications when a viewer leaves, add file locks, or claim that multiple simultaneously encoded streams are the user's normal-use budget. The Shared Workspace default can be delivered independently; explicit fixture work contexts keep this slice verifiable without inventing a dependency on that separate implementation.

## Answer

On-demand activation and independent Bot Desktop Sessions were already the working public-daemon contract after tickets 01–03. This slice added missing lifecycle coverage and fake-runtime seams; it did not change Cage startup, Shared Workspace policy, Changes removal, capacity, or ticket 03's release/retry/`last_failure` behavior.

**Already true (no manager/runtime change):**
- Creating a Bot allocates a persistent Screen identity (`bot_surfaces`) in `stopped` with no adapter `start()`. Listing the Bot, opening Threads, sending ordinary messages, and polling `/api/computer/state` still leave the runtime absent. Public state continues to present unused Screens as `starting` / "Screen starting." without provisioning.
- First `GET /api/computer/snapshot`, projection `projectionSource()`, `open_app` / other `screens.act` computer tools, and Agent `computer:*` turns call `open()` / `#readyRuntime()` and start one session on ticket 03's path.
- Concurrent first-use (snapshot + `open_app`) shares one `#start` entry and one generation. New Threads keep the same `surfaceId`; a second Thread's computer tool does not start another runtime.
- Two Bots on Agent `pi` keep distinct Surfaces, Native Sessions (`fake://…` worker observations), input authority, and action routing. Application exit/failure stays `ready`; compositor/desktop/helper/worker failures stay Surface-scoped. Capacity refusal is unchanged (limit 1 in tests; no higher claim). A failed `adapter.start()` deletes the entry, exposes `last_failure` on public 503/state, and does not occupy the admission slot.

**Changed:**
- `FakeBotScreenRuntimeAdapter` can delay `start()`, count start attempts, and fail one Surface's provision so races and sibling isolation are deterministic.
- `tests/integration/bot-screen-lifecycle.test.ts` now covers unused Bot + Threads, concurrent view+action, same-Agent independence, and provision-failure capacity release.

**Tests:**
- `bun run typecheck` — passed
- `bun test tests/integration/bot-screen-lifecycle.test.ts tests/integration/computer.test.ts` — 34 pass, including the four new on-demand cases and existing unused-poll, first-view, application-vs-desktop, sibling isolation, and capacity tests

**Unmet real-desktop gaps:**
- Existing two-Cage smoke (`OMARCHY_BOT_REAL_CAGE_SMOKE=1`) was not run: `zenity` is not on PATH. `grim` and ImageMagick `compare` are present. System `cage` / `wlr-randr` are not on PATH; the app-owned portable bundle under `~/.local/share/omarchy-bot/runtime/cage/` exists but was not started. No host package install or compositor restart was performed.
- Independent real pixels/input therefore remain evidenced only by the existing private-runtime smoke prior art, not by a new run in this slice.
- Viewer-driven capture/encoder release, idle eviction, and host top-bar/shortcut usability are out of scope (ticket 05 and later human gate).
