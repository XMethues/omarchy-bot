# Wayland computer-use backend support and replacement options

Research date: 2026-09-06. **Historical research.** No production cutover, host setup, package installation, or alternative-runtime launch was performed for this comparison. Production compositor is [Computer ADR 0009](../contexts/computer-control/adr/0009-adopt-sway-bot-desktops.md). The body below is not rewritten.

## Answer

`computer-use-linux` does support Wayland. That is not a promise that every compositor supplies every operation. Its own current support matrix explicitly says **Sway / generic wlroots: no dedicated backend yet**, and that exact window listing/focus is unavailable unless another backend applies. GNOME, KWin, Hyprland and COSMIC have compositor-specific window backends. The previous explanation should name the missing Sway window adapter, not imply that Wayland itself is unsupported. [U1][U2]

The installed npm package is `@agent-sh/computer-use-linux` **0.5.0** (`~/.pi/agent/npm/node_modules/@agent-sh/computer-use-linux/package.json`). The previous isolated experiment's MCP initialization also reported 0.5.0. GitHub's latest formal release remains **v0.5.0, 2026-08-31**. Current default-branch HEAD was **c9ab855e5d35420faafadc41a7ab0474b26358a2**, committed 2026-09-05. An executed byte-for-byte comparison found `src/windowing/backends/i3.rs` identical at that HEAD and v0.5.0; both require `let window_id = self.window?;`. There is no released upgrade that supplies the missing Sway adapter. [U3][U4]

There are alternatives, but none inspected is a demonstrated drop-in replacement for the entire current Bot desktop contract. The smallest candidate change for the already-exercised Sway experiment is existing community Sway-adapter work; the most directly relevant different headless-session project is WayDriver. Neither is accepted or runtime-validated here.

## Required boundary

- A Bot Screen needs independent windows, focus, pointer and keyboard state; a Screen Projection is only a viewing connection.
- A Bot Desktop Session must not operate the Host Session's physical devices or depend on a host graphical-session restart.
- Shared Workspace files remain shared. Temporary private browser profiles used in experiments are not a new product policy.
- Capture, input, window management and accessibility are separate capabilities. VNC transports pixels/input; it is not a compositor window-management API.
- Same-UID socket/environment separation is accidental-routing protection, not an adversarial security boundary.

These are the current project boundaries, not requirements introduced by a replacement library. [P1][P2]

## What upstream's Wayland support means

| Capability | Upstream route | Constraint for a private headless Bot desktop |
| --- | --- | --- |
| Window listing / focus | GNOME Shell extension or Introspect; COSMIC helper; KWin D-Bus scripting; Hyprland IPC; i3 IPC; X11/EWMH | Requires the matching compositor API. Current registry has no Sway backend. |
| Screenshot | GNOME Shell D-Bus, screenshot portal, `gnome-screenshot` fallback | Being a Wayland client alone does not provide one of these services. Screenshot portals may prompt. |
| Pointer input | RemoteDesktop portal, with ydotool/uinput fallback paths | Do not route a Bot through the Host Session's global input devices. A private Wayland socket does not scope global uinput by itself. |
| Literal text | Portal input, then `wtype` on compatible Wayland compositors, then other fallback paths | `wtype` compatibility does not establish window-list/focus compatibility. |
| Accessibility | AT-SPI | Depends on an accessible bus and what each application exposes; not a universal compositor window inventory. |

Sources: upstream's implementation description, safety contract and support matrix [U1], plus the actual backend registry [U2]. Upstream explicitly says manual validation was on GNOME Wayland; other backends have parser/contract coverage and remain dependent on the actual session API. Do not convert that into a claim of full Sway desktop validation.

### Relation to the completed local experiment

The earlier experiment used two private pure-headless Sway 1.12 sessions, WayVNC 0.10.1 and noVNC 1.7.0. Real Brave/Alacritty windows, native Sway IPC enumeration/focus, independent VNC input, Unicode clipboard paste, viewer switching/reconnection and background continuation were exercised. That proves those specific compositor/transport paths, not the `computer-use-linux` integration.

The installed backend returned unavailable/empty window output. The COSMIC helper explicitly reported listing and activation unavailable. Adding a temporary real `i3-msg` plus explicit private `I3SOCK` changed the diagnostic from missing client to `i3 returned no windows`; it did not make the parser accept native Wayland nodes. The current i3 parser is X11-shaped; Sway native nodes are addressed by their container IDs. The experiment evidence and prototype source are retained at `local://wayvnc-desktop-experiment.json`; temporary runtimes and processes were removed.

The standalone MCP probe returned initialization but not subsequent tool responses through the experiment's hub stdin path. It is not counted as successful MCP conformance. NoVNC's successful Chinese clipboard experiment is not evidence that every VNC MCP client's text implementation works.

## Existing Sway work: not necessarily a new adapter from scratch

[PR #24](https://github.com/agent-sh/computer-use-linux/pull/24) proposed a Sway adapter using `swaymsg -t get_tree`, `SWAYSOCK` and `[con_id=N] focus`. Its source accepts native `app_id`, uses the container `id` as the window identity, and walks ordinary and floating nodes. [S1]

However:

- GitHub API reports **closed, merged=false**, closed 2026-06-21.
- Its author left manual Sway validation unchecked.
- The maintainer requested passing CI and addressed reviews before a focused review, then closed the PR. [S2]
- It also bundles natural-language discovery, clipboard, macros, OCR and skill changes. Those are not needed merely to supply our missing Sway window adapter.

**Recommendation:** if continuing the Sway direction, review and validate the narrowly scoped Sway implementation and pursue an upstreamable change. Do not install the whole fork/PR blindly or call it released support. This addresses window semantics only; capture/input compatibility still needs end-to-end Agent verification.

## Replacement comparison

### Hypruse: strongest inspected Hyprland-specific option

- Project: [IlyasKhallouki/hypruse](https://github.com/IlyasKhallouki/hypruse).
- Latest release observed: **v0.10.0, 2026-08-31**; inspected HEAD **7dd11acae0a5631825907f0ba8340dd4088998c4**. Python; MIT. [H1]
- Provides native window/workspace state and manipulation through `hyprctl`, screenshots through `grim`, input through Wayland virtual-pointer/virtual-keyboard mechanisms and `wtype`, plus optional AT-SPI-based tools. The inspected input and IPC code substantiate these routes; this is not only a README claim. [H2][H3]
- Does not require ydotool, root or portals for those native routes. Its input implementation also contains named-seat handling; do not flatten that into a claim that every possible invocation uses the physical seat. [H2]
- **Limit:** requires an already-running Hyprland session; it does not provision the independent pure-headless compositor. Choosing it does not solve the previously identified installed Hyprland/Aquamarine headless-start prerequisite. Connecting it to the real Omarchy session is not an acceptable workaround. [H1][H3]
- **Assessment:** a serious alternative for an explicitly selected Hyprland session, not a direct replacement for current Cage or experimental Sway desktops. No Hypruse runtime conformance was performed here.

### WayDriver: most relevant different headless-session project

- Project: [BohdanTkachenko/waydriver](https://github.com/BohdanTkachenko/waydriver), with `waydriver-mcp`.
- Latest GitHub release observed: **waydriver-v0.3.10, 2026-07-03**; inspected HEAD **25766f126de811e7f066c410c7fd735bb6e55e84**. Rust; Apache-2.0. [W1]
- Actually implements a headless Mutter compositor backend with private D-Bus, PipeWire and WirePlumber processes. Input uses Mutter RemoteDesktop; capture uses Mutter/PipeWire. MCP exposes session start/list/kill, accessibility-tree inspection, element actions, text/keys, pointer operations and screenshot capture. [W2][W3][W4]
- **Important difference:** its main purpose is GTK4 application testing. MCP `focus` is AT-SPI element focus, not a documented compositor-wide `list_windows`/`activate_window` replacement. Generic browsers, terminals, inaccessible surfaces and arbitrary multi-application desktop behavior need validation rather than inference from the GTK test examples. [W2]
- Its MCP owns compositor/app lifecycle and reports screenshots/video. Adopting it would change more than our worker's window adapter. Its report viewer is a test-artifact viewer, not proof of an interactive live Computer Surface replacement. [W2][W4]
- The documentation lists a substantial runtime dependency set and recommends container distribution. No claim of lower cost than Cage/Sway is established. The compositor source notes process-global `XDG_RUNTIME_DIR` mutation in capture paths; do not embed it into the daemon on the assumption that all session state is local. A separate process/container boundary and multi-session routing require evaluation. [W2][W3]
- **Assessment:** worth evaluating if replacing the headless session stack is desired. It is not yet a verified general Bot Desktop Session backend, and does not use Sway or Hyprland.

### MCP-VNC: available pixel/input backend, not a full window backend

- Project: [hrrrsn/mcp-vnc](https://github.com/hrrrsn/mcp-vnc).
- Latest release observed: **v1.0.2, 2025-08-04**; inspected HEAD **1681419a0a04051cf9d167d763d374c1c6111f81**, committed 2025-08-15. TypeScript; MIT. [V1]
- Exposes screenshots, coordinate mouse actions, keys and text against a configured VNC server. A VNC server can represent a Wayland desktop; the MCP client need not implement compositor protocols. [V1]
- The exposed tool set does not include compositor window enumeration, exact window activation or AT-SPI. Existing window semantics would still need another implementation. [V1]
- The inspected client opens a fresh connection per operation, waits for a full framebuffer, and configures host/port with `path: null`; it is not an unchanged match for the Unix-socket-only WayVNC experiment. No throughput/latency comparison was run. [V2]
- Its key mapper falls back to `charCodeAt(0)` and includes US-keyboard shift mappings. Unicode/layout handling needs direct testing; the noVNC clipboard result cannot be transferred to this client. [V3]
- **Assessment:** a real off-the-shelf MCP pixel/input option, with older observed release activity and missing window semantics. Not a complete drop-in replacement and not selected without protocol/input tests.

### Wayland-MCP: reject the inspected input route for this boundary

- Project: [kurojs/wayland-mcp](https://github.com/kurojs/wayland-mcp), inspected HEAD **281a433f9954e5e7061e06dcccbaa181f4cab67a**, committed 2026-05-23. Python. README declares GPL3; GitHub's API did not classify the license.
- Advertises screenshot/VLM analysis and input, including broad Wayland desktop compatibility. However, its setup instructions require privileged evemu setup, group/udev changes and setuid configuration. [K1]
- The actual mouse implementation scans writable `/dev/input` devices and sends `evemu-event` to a selected physical event device. `WAYLAND_DISPLAY` does not bind this path to a Bot's private compositor. [K2]
- **Assessment:** reject as configured for independent headless Bot input; it conflicts with Host Session protection. It was not installed or executed.

## Decision guidance

1. Correct the explanation: upstream supports Wayland, but **not the Sway window interface required by our experiment**. Latest formal release and current HEAD do not remove this gap.
2. If retaining experimental Sway, existing community Sway code is the most narrowly scoped avenue. It still needs review, actual Agent conformance and an upstream maintenance path; this research does not select a permanent fork.
3. If replacing the whole headless-session implementation is acceptable, WayDriver is the most directly aligned inspected alternative to evaluate, with explicit GTK/application-lifecycle, dependency, multi-session and viewing limitations.
4. If a safe independent Hyprland session becomes available, Hypruse is worth evaluating as a native Hyprland tool backend. Do not operate the Host Session to bypass that prerequisite.
5. VNC-based MCP can replace pixel/input operations, not our truthful window contract by itself. A VNC conversion must not make unsupported window queries appear to be successful empty lists.

No alternative in this note was newly launched. No host package manager, setup script, compositor restart or production Bot migration was performed. The executable research checks were upstream version/release queries, source retrieval, PR state/comments, and the exact current-versus-release i3-source comparison. These are source-research evidence, not desktop runtime conformance.

## Research framework for a lightweight Bot desktop

The comparison unit is a complete **Bot Desktop Runtime Stack**, not a desktop-environment name. Each candidate must name its session lifecycle manager, display server/compositor/window manager, X11/Wayland application path, capture/projection transport, input and clipboard route, window inspection/control API, accessibility route, private state directories and teardown mechanism. Comparing Xfce, Sway and VNC directly would compare different layers.

### Hard gates

A candidate is rejected before scoring if it cannot:

1. run as a private Bot Desktop Session without controlling or restarting the Host Session, using physical input devices, or requiring host-global graphical configuration;
2. run two Bot sessions concurrently with explicit per-session display/socket/runtime/profile routing;
3. run real browser and terminal applications and provide pixels, pointer, keyboard and clipboard;
4. truthfully enumerate and focus windows, or supply an explicitly selected replacement contract rather than returning a successful empty result;
5. keep graphical work running when the Computer drawer disconnects and show the same live page/window state when it reconnects;
6. cleanly terminate its complete process tree and private sockets/state when an explicit destructive stop is requested;
7. operate without root/setuid/device-rule changes and have a reviewable maintenance and license path.

Same-UID separation remains routing isolation, not an adversarial security boundary. Cold restart with application relaunch does not satisfy live-state recovery.

### Scored dimensions

Only candidates passing the hard gates are scored. The initial weighting is deliberately correctness-first:

| Dimension | Weight | Evidence required |
| --- | ---: | --- |
| Functional and Agent-control completeness | 25 | Exercised capture, input, clipboard, window list/focus and error semantics |
| Host safety and multi-Bot isolation | 20 | Two simultaneous private sessions; no Host Session socket/device use |
| Lifecycle and live-state continuity | 15 | Drawer disconnect, unseen background work, exact reconnect state and explicit teardown |
| Resource and performance cost | 15 | Comparable cold start, first frame, reconnect, aggregate process-tree PSS/SwapPSS and CPU |
| Real-application compatibility | 10 | Browser, terminal, X11/Wayland paths, Unicode/IME and accessibility limitations |
| Operations and maintenance | 10 | Dependency size, packaging, configuration, upstream activity, API stability and license |
| Computer Surface experience | 5 | Connection progress, resize, pointer/keyboard latency and failure/recovery behavior |

“Lightweight” therefore means low total cost **after** correctness and isolation gates, not the smallest compositor RSS. Application processes, projection workers, D-Bus/portal/media services and swapped memory are included.

### Controlled experiment

Every surviving stack receives the same private paths, 1280×720 target, frame-rate cap, browser profile, browser page, terminal workload and two-Bot concurrency test. Measure at least:

1. cold request to desktop ready, first usable frame and Agent-control ready;
2. connected idle and active interaction;
3. drawer disconnected with no work;
4. drawer disconnected while a visible counter/download-like graphical task continues;
5. reconnect latency and preservation of page, focused window, unsaved field text and background progress;
6. window enumeration/focus, pointer, physical modifiers, literal Unicode text and clipboard in both Bots;
7. cross-Bot input/window leakage;
8. explicit stop, complete process/socket cleanup and subsequent clean start.

Use repeated cold and reconnect runs and report distributions rather than a single best sample. Resource accounting covers each candidate's entire process tree, application workload and projection bridge separately, including resident PSS, SwapPSS and aggregate CPU over equal observation windows. Source claims establish eligibility; only executed scenarios establish runtime conformance.

### Decision output

The final matrix will report hard-gate pass/fail, raw measurements, scored dimensions, unverified gaps and an operational risk register. It will recommend one primary stack, one fallback with a stated trigger, and explicit rejects. The candidate shortlist is created only after this framework; adding a familiar desktop name alone is insufficient.

## Proposed revision: demand-driven lightweight desktops

The user proposed selecting a minimal desktop runnable on Omarchy and clarified two activation triggers: an instruction requiring the Bot to operate the desktop, or opening its Computer drawer. The user also requires reopening to recover the previous page/window state, referencing observed Grok behavior without claiming to know its implementation. Evaluate cold-start/resume latency, active cost, idle cost and state preservation together. This records the clarified product direction, not a production cutover or an amendment to the accepted ADR.

- “Runs independently on an Omarchy host” must not be conflated with an officially supported alternative Omarchy desktop environment. Do not replace the Host Session or launch another full Omarchy session.
- Prefer a minimal compositor/window manager and only the services required for real applications. Sway is the already-exercised lightweight Wayland candidate, but its Agent window adapter remains unresolved. WayDriver's headless Mutter is a fuller alternative, not a measured lighter one. No cross-candidate benchmark establishes an absolute lightest desktop.
- Demand sources are opening the Computer drawer and a Bot task requiring graphical interaction. Selecting a conversation, ordinary chat, and pure file/CLI work are not desktop-start triggers.
- Closing/switching the drawer releases viewing demand and its capture/transport resources; it must not interrupt a background graphical task or destroy the page/window state expected on reopening.
- Graphical-task demand must cover the whole multi-action operation, including reasoning between actions and explicitly continuing GUI work; releasing after each individual tool RPC would repeatedly destroy the working desktop.
- Stopping the desktop closes its GUI applications. Saved Shared Workspace files and conversations persist, but unsaved application memory, in-progress browser work, and exact window state do not automatically survive.
- The conservative implementation candidate is to retain the desktop/application processes after viewing and graphical-task demand end, while releasing projection resources. A quiescent private-session suspension may reduce idle CPU, but needs validation and is not equivalent to releasing all memory. Do not silently suspend work such as a still-running GUI download.
- Cold teardown followed by application relaunch is not a general substitute for state preservation. Browser session restore, process checkpointing and VM snapshots have different coverage and costs; none was verified or selected here.
- A “connecting desktop” UI message is a useful interaction reference, not evidence that another product cold-boots its compositor on every activation.

The activation trigger is now clarified; current `Bot Activity` still means an Active Turn and must not become the desktop power switch. Treat “close” as closing/disconnecting the drawer, with recoverable desktop state, rather than unconditional process destruction. Full runtime teardown or a new suspension/checkpoint mechanism remains a separate implementation decision. The replacement runtime and its memory/startup trade-off have not been selected.

## Sources

- [P1] [Host Session and Bot Desktop Session glossary](../contexts/computer-control/CONTEXT.md).
- [P2] [Shared work files and isolated Bot Screens](../adr/0009-share-work-files-isolate-bot-screens.md).
- [U1] [Pinned upstream README, support matrix and safety contract](https://github.com/agent-sh/computer-use-linux/blob/c9ab855e5d35420faafadc41a7ab0474b26358a2/README.md#support-matrix).
- [U2] [Pinned backend registry and dispatch](https://github.com/agent-sh/computer-use-linux/blob/c9ab855e5d35420faafadc41a7ab0474b26358a2/src/windowing/registry.rs).
- [U3] [v0.5.0 release](https://github.com/agent-sh/computer-use-linux/releases/tag/v0.5.0) and [current HEAD](https://github.com/agent-sh/computer-use-linux/commit/c9ab855e5d35420faafadc41a7ab0474b26358a2).
- [U4] [Current i3 parser](https://github.com/agent-sh/computer-use-linux/blob/c9ab855e5d35420faafadc41a7ab0474b26358a2/src/windowing/backends/i3.rs) and [v0.5.0 parser](https://github.com/agent-sh/computer-use-linux/blob/v0.5.0/src/windowing/backends/i3.rs).
- [S1] [PR #24](https://github.com/agent-sh/computer-use-linux/pull/24) and [proposed Sway implementation](https://github.com/Stijnman/computer-use-linux/blob/2ddf9ecdc1f0643ccc7b124ac97238de7126dc92/src/windowing/backends/sway.rs).
- [S2] [Maintainer review prerequisite](https://github.com/agent-sh/computer-use-linux/pull/24#issuecomment-4684475296) and [closure comment](https://github.com/agent-sh/computer-use-linux/pull/24#issuecomment-4763474236).
- [H1] [Hypruse pinned README](https://github.com/IlyasKhallouki/hypruse/blob/7dd11acae0a5631825907f0ba8340dd4088998c4/README.md) and [v0.10.0 release](https://github.com/IlyasKhallouki/hypruse/releases/tag/v0.10.0).
- [H2] [Hypruse native input](https://github.com/IlyasKhallouki/hypruse/blob/7dd11acae0a5631825907f0ba8340dd4088998c4/src/hypruse/input.py).
- [H3] [Hypruse IPC implementation](https://github.com/IlyasKhallouki/hypruse/blob/7dd11acae0a5631825907f0ba8340dd4088998c4/src/hypruse/hyprctl.py).
- [W1] [WayDriver pinned README](https://github.com/BohdanTkachenko/waydriver/blob/25766f126de811e7f066c410c7fd735bb6e55e84/README.md) and [v0.3.10 release](https://github.com/BohdanTkachenko/waydriver/releases/tag/waydriver-v0.3.10).
- [W2] [Official MCP tools and runtime requirements](https://waydriver.io/guide/mcp-server.html).
- [W3] [Mutter compositor implementation and runtime-root caveat](https://github.com/BohdanTkachenko/waydriver/blob/25766f126de811e7f066c410c7fd735bb6e55e84/crates/waydriver-compositor-mutter/src/lib.rs).
- [W4] [MCP session lifecycle implementation](https://github.com/BohdanTkachenko/waydriver/blob/25766f126de811e7f066c410c7fd735bb6e55e84/crates/waydriver-mcp/src/tools/lifecycle.rs).
- [V1] [MCP-VNC tool list](https://github.com/hrrrsn/mcp-vnc/blob/1681419a0a04051cf9d167d763d374c1c6111f81/README.md) and [v1.0.2 release](https://github.com/hrrrsn/mcp-vnc/releases/tag/v1.0.2).
- [V2] [VNC connection and encoding implementation](https://github.com/hrrrsn/mcp-vnc/blob/1681419a0a04051cf9d167d763d374c1c6111f81/src/vnc/client.ts).
- [V3] [VNC key mapping](https://github.com/hrrrsn/mcp-vnc/blob/1681419a0a04051cf9d167d763d374c1c6111f81/src/vnc/keyboard.ts).
- [K1] [Wayland-MCP setup and advertised capabilities](https://github.com/kurojs/wayland-mcp/blob/281a433f9954e5e7061e06dcccbaa181f4cab67a/README.md).
- [K2] [Wayland-MCP physical input selection](https://github.com/kurojs/wayland-mcp/blob/281a433f9954e5e7061e06dcccbaa181f4cab67a/wayland_mcp/mouse_utils.py).
