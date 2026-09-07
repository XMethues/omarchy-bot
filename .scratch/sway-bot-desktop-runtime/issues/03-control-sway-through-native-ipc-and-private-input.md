# 03: Control Sway through native IPC and private input

**Parent:** [#8](https://github.com/XMethues/omarchy-bot/issues/8)

**What to build:** Give an Agent complete, truthful control of its own Sway Bot Screen without a viewer: direct screenshots, native window discovery and verified focus, private pointer/keyboard/Unicode input, and correctly routed application launches.

**Blocked by:** 02: Start one private Sway Bot Desktop Session on demand.

**Status:** resolved

- [x] `observe`, screenshot, window listing, window focus, click, scroll, key, type, application launch, and URL launch work without a Screen Projection.
- [x] Native Sway tree traversal returns ordinary and floating application toplevels while excluding workspaces and layout-only nodes.
- [x] Window results use Sway container identities and include title, application identity, PID when available, focused state, bounds, workspace, and Wayland/X11 client type.
- [x] Focus requests resolve to exactly one window, execute only through the intended private Sway IPC endpoint, and succeed only after a fresh tree confirms the requested container is focused.
- [x] Missing IPC, stale IDs, ambiguous selectors, refusals, and timeouts return errors rather than successful empty data.
- [x] Screenshots and pointer coordinates target only the intended private output.
- [x] Pointer, scroll, physical key transitions, shortcuts, and literal Unicode use the existing private virtual-input path; no physical-device, global uinput, host portal, or unrelated compositor fallback is allowed.
- [x] Literal Chinese and mixed Unicode text are visibly exact in real browser and terminal fields; inability to guarantee exact delivery fails honestly.
- [x] Input actions require matching Bot, Turn, Surface, and runtime-generation authority before mutation.
- [x] Application and URL launches inherit the intended Bot display and Shared Workspace working directory.
- [x] Agent-facing action names and Bot Desktop Session identity remain stable and generic rather than exposing Cage-era assumptions.

## Answer

Native Sway control is now on `SwayBotScreenRuntime.act()`. A small in-repo i3-ipc client (`apps/daemon/src/modules/computer/swayIpc.ts`) speaks only to the adapter-discovered private socket: `GET_TREE` (4) and `RUN_COMMAND` (0), never `process.env.SWAYSOCK`, `i3-msg`, or another Surface. Tree walk returns `con` / `floating_con` toplevels that have `app_id`, an X11 `window`, or `xdg_shell`/`xwayland`; workspaces and layout-only splits are omitted. Window ids are `String(node.id)` with title, optional `appId`/`pid`, `focused`, `rect` bounds, nearest workspace name, and `clientType` `x11`|`wayland`. `ComputerActPayload.windowList` now types those optional fields.

`list_windows` and `observe` use that tree (observe also uses the existing grim `capture()`). Missing or hung IPC throws; they never return a successful empty list. `focus_window` resolves exactly one listed toplevel (`id`, else title/`appId`), sends `[con_id=…] focus` on the same socket, then re-reads the tree and succeeds only if that container is focused.

`click` / `scroll` / `key` / `type` never reach the computer worker. Matching `inputAuthority.surfaceId` is required first. Each Agent input action allocates a fresh runtime epoch (incremented past any web-set epoch), calls `setInputAuthority`, sends helper events, and `releaseInput`s in `finally`. `type` is paste-only with the exact UTF-8 payload; helper paste failure throws. `open_app` / `open_url` / `notify` still go to `startedComputerWorker.act` (private `WAYLAND_DISPLAY` + `SWAYSOCK`, existing Shared Workspace cwd). Action names stay generic. Agent copy no longer presents Cage as the current runtime.

Unicode checkbox: the paste path records exact `你好, world` and throws when the helper cannot deliver it. Live browser/terminal field visibility remains ticket 09's real-Sway smoke.

Tests: `tests/integration/bot-screen-sway-control.test.ts` (fake sway + scriptable i3-ipc + recording helper). Required runs all passed: control, existing sway-runtime, Pi conformance, agent-computer-tool, and `bun run typecheck`. Production `main.ts` is still Cage. No WayVNC, no ticket 04/05 work.
