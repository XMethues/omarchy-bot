# Lightweight Bot desktop runtime stacks

Research date: 2026-09-06. **Historical research** that selected Sway. This report combines primary-source screening with one bounded, private local experiment described below; it is not a production decision or full benchmark. Production compositor is [Computer ADR 0009](../contexts/computer-control/adr/0009-adopt-sway-bot-desktops.md). The body below is not rewritten. It applies the hard gates and experiment method in [Wayland computer-use backend support and replacement options](wayland-computer-use-backends.md#research-framework-for-a-lightweight-bot-desktop). No host package was installed, no Host Session service or compositor was changed, and no production Bot runtime was migrated.

## Decision

No inspected stack passes every runtime hard gate without further work. Continue with two development candidates, in this order:

1. **Headless Sway + WayVNC + native Sway IPC adapter** — primary direction. It is closest among runnable candidates to Omarchy's Wayland/wlroots model. The earlier two-session experiment proved real browser/terminal pixels, VNC input and clipboard, reconnect, background continuation, and native Sway window enumeration/focus. The installed Agent backend still needs a narrow native Sway adapter and full lifecycle conformance.
2. **TigerVNC Xvnc + IceWM + EWMH control plus a correct Unicode text route** — fallback direction. The new bounded experiment proved a private virtual display, real applications, Agent screenshots/clicks, exact EWMH window list/focus, RFB reconnect and live-state continuity. It also found a correctness blocker: `computer-use-linux` 0.5.0 reported X11 `type_text` success while the requested Chinese text was dropped or corrupted. The stack cannot pass until literal text uses a verified UTF-8 clipboard/paste or equivalent route and reports failure honestly.

Do not advance **minimal Xfce** merely because it is familiar. Its experiment inherited the same X11 Unicode blocker, added session/configuration processes and more measured infrastructure memory, and exposed more portable-session bootstrap assumptions without improving Agent control. Keep **Openbox** only as an IceWM substitute if IceWM itself causes a demonstrated blocker. Defer LXQt/labwc, Xfce/labwc, private Hyprland/Hypruse and WayDriver/Mutter until their stated prerequisites change. Retain current Cage only as the production single-application baseline.

This decision follows the user's strict priority order: correctness and Host Session/multi-Bot isolation first; similarity to Omarchy's Wayland/Hyprland environment second; total measured runtime cost third. Package sizes remain maintenance context, never runtime-memory claims.

## Status vocabulary

- **PASS — source eligible:** primary sources expose a credible route for every hard gate. It still has no runtime score until the controlled experiment passes.
- **PROVISIONAL PASS:** source architecture is credible, but one or more integration assumptions must be proved before the stack may be called a gate pass.
- **REJECT:** a named source-level property conflicts with a hard gate.
- **DEFER:** no contradiction is proved, but a required complete-stack capability or headless prerequisite is not credible enough to spend the first experiment round on it.

A projection disconnect is not a desktop stop. Live-state continuity requires leaving the display server/compositor, window manager/session manager, and applications alive while disconnecting only the viewer or projection component. Restarting them and relying on browser restore is not equivalent.

## Eligibility matrix

Gate numbers refer to the seven hard gates in the framework.

| Complete stack | Display / session lifecycle | Projection; input and clipboard | Window enumeration / focus | Browser and terminal path | Disconnect and teardown model | Maintenance / license evidence | Source result and explicit unknowns |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Current Cage baseline:** private Cage + application + existing projection/control route | Cage describes itself as a Wayland kiosk that runs one maximized application. Cage owns the Wayland display; XWayland is compile-time optional. [CAGE] | Existing project stack, not re-specified here. Cage itself is not a projection transport or general automation API. | No general multi-window inventory/control contract follows from a single-app kiosk. | Native Wayland application; optional XWayland. | Keeping Cage/application alive while projection disconnects is architecturally possible, but this report adds no runtime evidence. | Cage upstream; MIT license in source. | **REJECT as the target general Bot desktop on G4**: it intentionally narrows the surface to one application. **Retain as baseline**, not a new experiment candidate. Unknown: whether the product can permanently select a truthful single-surface replacement contract instead of requiring general window semantics. |
| **Headless Sway + WayVNC + native Sway IPC** | One Sway process per Bot, with private `XDG_RUNTIME_DIR`, `WAYLAND_DISPLAY`, `SWAYSOCK`, configs and app profiles. Sway IPC is a Unix socket whose path is explicitly carried in `SWAYSOCK`; `GET_TREE` supplies the native tree and `RUN_COMMAND` controls it. [SWAY-IPC] | WayVNC attaches to a running wlroots Wayland session, creates virtual input devices, exposes one display over RFB, and explicitly allows a headless session. RFB clipboard must be exercised end to end. [WAYVNC] | `GET_TREE` plus native container IDs and Sway commands are a credible exact list/focus contract. Do not use the installed X11-shaped `computer-use-linux` i3 parser as a substitute. | Native Wayland plus optional Arch `xorg-xwayland` path. [ARCH-SWAY] | Viewer disconnect need not stop Sway or applications. WayVNC is a separate attachable process; whether the product stops/restarts only projection and cleanly reaps every private process/socket remains an experiment item. | Arch: Sway 1:1.12-4, MIT; WayVNC 0.10.1-1, ISC. [ARCH-SWAY][ARCH-WAYVNC] | **PROVISIONAL PASS.** Credible G1–G7 routes, and prior project evidence covers important cases, but the product-level Agent adapter, failure semantics, process-tree cleanup, literal Unicode, and two-Bot reconnect sequence remain unproved. This is the primary experiment. |
| **TigerVNC Xvnc + IceWM + EWMH/wmctrl-compatible controller** | One Xvnc per Bot on a unique X display, with private Xauthority/config/state and a supervised IceWM session. Xvnc is both an X server and VNC server and uses a virtual rather than physical screen. [XVNC][VNCSESSION] | RFB is built into Xvnc. Xvnc defaults `AcceptKeyEvents`, `AcceptPointerEvents`, and `AcceptCutText` on. [XVNC] | EWMH defines `_NET_CLIENT_LIST` and `_NET_ACTIVE_WINDOW`; IceWM's own compliance file marks both supported. [EWMH][ICEWM-COMP] | Native X11, which is the direct path for X11 browser and terminal builds. OpenGL/DRI3 and browser acceleration/feature behavior are unknown until exercised. | Xvnc `MaxDisconnectionTime` defaults to 0, meaning it does not terminate merely because no client is connected; `MaxIdleTime` also defaults to 0. Thus source configuration permits the same live X server and apps to survive viewer disconnect. Explicit stop must supervise Xvnc, IceWM, applications, and session helpers. [XVNC] | Arch: TigerVNC 1.16.2-5, GPL-2.0-only; IceWM 4.1.0-1, LGPL-2.0-only. IceWM released 4.1.0 on 2026-08-06. [ARCH-TIGER][ARCH-ICEWM][ICEWM] | **PROVISIONAL PASS.** Strong source route for all gates and the smallest initial X11 comparator, but no project runtime proof. Unknowns: RFB clipboard fidelity, keyboard layouts/modifiers, browser sandbox/GPU behavior, noVNC bridge behavior, same-UID display routing, exact process-tree cleanup, and total PSS/CPU. |
| **TigerVNC Xvnc + Openbox + EWMH/wmctrl-compatible controller** | Same Xvnc/session isolation as IceWM; supervised `openbox-session`. | Same Xvnc RFB path. | EWMH is the selected contract; compatibility must be verified against `_NET_SUPPORTED`, `_NET_CLIENT_LIST`, and `_NET_ACTIVE_WINDOW` in the actual session. Openbox is an X11 WM but its stale upstream documentation gives less current compliance evidence than IceWM. | Native X11. | Same Xvnc connection-independent lifetime. | Arch: Openbox 3.6.1-14, GPL-2.0-or-later; package is maintained but upstream release is old. [ARCH-OPENBOX] | **PROVISIONAL PASS, reserve only.** No source contradiction, but IceWM has a more current release and explicit compliance matrix. Unknowns are the same as IceWM plus actual EWMH compliance on packaged Openbox. Do not duplicate the first-round experiment unless IceWM fails. |
| **TigerVNC Xvnc + minimal Xfce (xfce4-session, Xfwm4, panel only if needed) + EWMH controller** | Unique Xvnc display and private config/cache/state plus Xfce session. `vncsession` can select a session from `/usr/share/xsessions`; a custom user-owned supervisor may be preferable to avoid host-global service policy. [VNCSESSION] | Xvnc provides projection/input/clipboard. | Xfwm4 is explicitly the X11 window manager; EWMH supplies list/activate semantics. Verify actual `_NET_SUPPORTED` rather than assuming every hint. [XFCE-WL][EWMH] | Native X11. Xfce terminal/browser compatibility is conventional but must be exercised here. | Same Xvnc defaults allow continued server lifetime with no viewer. Xfce helpers increase the cleanup surface; only runtime process-tree observation proves G6. | Current Arch `xfce4` group has 14 packages, including xfce4-session 4.20.4-1 and xfwm4 4.20.0-2. [ARCH-XFCE] | **PROVISIONAL PASS.** Most mature Xfce route by upstream's own status: X11 remains supported, Xfwm4 is X11-only, and Wayland parity is not a current target. Unknowns: minimal component set, D-Bus singleton/state isolation under same UID, actual cost, session logout behavior, and full cleanup. Third shortlisted experiment. |
| **TigerVNC Xvnc + LXQt + Openbox** | Concrete X11 stack: unique Xvnc display, `lxqt-session`, Openbox, and private LXQt config/cache/state. Arch's LXQt group itself includes Openbox. [ARCH-LXQT] | Xvnc RFB. | X11 EWMH controller against Openbox. | Native X11. | Xvnc can outlive viewer disconnect; LXQt session helpers remain alive. | Arch LXQt group currently contains 25 packages at mostly 2.4.0 plus Openbox; upstream is active. [ARCH-LXQT] | **DEFER on priority/cost, not incompatibility.** This is a credible complete LXQt stack, but it adds a broad DE layer without a demonstrated correctness advantage over the Xfce fallback or minimal IceWM comparator. Unknown minimal subset and total runtime cost. |
| **LXQt 2.4 + labwc + WayVNC + foreign-toplevel controller** | Concrete Wayland stack: private labwc compositor/output/socket, `startlxqtwayland`/`lxqt-session`, private configs, XWayland where needed. LXQt supports labwc as a stacking compositor; labwc supplies the compositor rather than LXQt itself. [LXQT-WL][LABWC] | WayVNC is compatible with wlroots compositors and creates virtual inputs; Wayland clipboard route is compositor/RFB dependent. | labwc documents `wlr-foreign-toplevel-management`; that protocol lists every opened toplevel and offers seat-scoped `activate`, but activation is a request without a guarantee. A real controller such as `wlrctl`/equivalent must prove stable identities, errors and focus result. [LABWC][WLR-TOPLEVEL] | Native Wayland and optional XWayland (Arch labwc declares XWayland optional). Chromium/Electron may require Ozone flags. [ARCH-LABWC][LXQT-WL] | Keep labwc/LXQt/apps alive and detach WayVNC/viewer only; supervise compositor, session and D-Bus children on destructive stop. | Arch: labwc 0.20.2-1, GPL-2.0-only; LXQt group 2.4.x; WayVNC 0.10.1-1 ISC. [ARCH-LABWC][ARCH-LXQT][ARCH-WAYVNC] | **DEFER.** Source control API is credible enough not to reject, but it is a second wlroots stack with more DE services than Sway and no project runtime proof. Reconsider if Sway's Agent adapter fails or a stacking UI is required. Unknowns: headless launch recipe, controller quality/identity semantics, exact focus confirmation, D-Bus isolation, clipboard, and cost. |
| **Xfce 4.20/4.21 components + labwc + WayVNC + foreign-toplevel controller** | `startxfce4 --wayland` currently launches `xfce4-session` from labwc by default, but the roadmap marks the instructions partly outdated and says Xfce's own `xfwl4` is under heavy development and not stable. Xfwm4 does not participate: it is X11-only. [XFCE-WL] | WayVNC/labwc RFB route. | labwc's foreign-toplevel protocol is credible for an external controller, independent of incomplete Xfce desktop window-list features. The Xfce roadmap still says xfdesktop window listing needs an X11/Wayland abstraction. [LABWC][XFCE-WL][WLR-TOPLEVEL] | Many core components are marked Wayland-capable, but upstream explicitly says preliminary/minimally usable, no 4.22 X11 feature-parity target, some panel-plugin support merely means it does not crash, and some applications/features remain unsupported. [XFCE-WL] | Architecturally detach WayVNC only. Lifecycle and session-manager behavior are unproved. | Current Arch Xfce group is 4.20.x; labwc 0.20.2-1. [ARCH-XFCE][ARCH-LABWC] | **DEFER, source-level maturity concern.** Control API is credible enough to avoid rejection, but Xfce itself says Wayland is still stabilizing. Prefer Xvnc/X11 Xfce for the fallback comparison. Unknowns include session reliability, plugin set, XWayland mix, clipboard, private D-Bus, and total cost. |
| **Private Hyprland + virtual/headless output + WayVNC + Hypruse** | Would require a second independent Hyprland process, private runtime/socket/config/state and a usable virtual output without attaching to the Host Session. Hyprland exposes `hyprctl` for compositor control; Hypruse consumes an already-running session. [HYPRCTL][HYPRUSE] | Hypruse supplies native input/screenshot routes; a live drawer still needs a projection transport. WayVNC may be usable only if the private compositor exposes the required wlroots protocols. | Hypruse uses `hyprctl -j` for clients/workspaces and dispatch for focus/manipulation, which is a strong native contract. [HYPRUSE] | Closest to Omarchy, with native Wayland and XWayland. | In principle keep private Hyprland/apps alive and detach projection. No independent lifecycle implementation is supplied by Hypruse. | Hyprland and Hypruse are actively maintained; Hypruse MIT. Exact stack version must be pinned before experiment. | **DEFER at source level.** Correct window control does not solve private headless startup. The previous project attempt found the installed Hyprland/Aquamarine headless prerequisite unresolved; current official material documents virtual outputs/vGPU scenarios, not a known-good pure-headless second session on this host. Never attach Hypruse to the Host Session. Unknowns: zero-physical-output boot, NVIDIA/Aquamarine behavior, WayVNC protocol support, two concurrent private compositors, and cleanup. |
| **WayDriver + headless Mutter + private D-Bus/PipeWire/WirePlumber + its MCP** | WayDriver owns a headless Mutter process and per-session runtime root plus private D-Bus, PipeWire and WirePlumber; its MCP starts/lists/kills sessions. [WAYDRIVER-SRC][WAYDRIVER-MCP] | Mutter RemoteDesktop input and PipeWire capture. Its generated report viewer/video is not an interactive RFB/WebRTC Computer drawer. | MCP `focus` targets an AT-SPI element, not a compositor-wide toplevel; published tools do not include general `list_windows`/`activate_window`. [WAYDRIVER-MCP] | Upstream positions it as isolated GTK4 application testing. Generic browser/terminal and arbitrary multi-app desktop behavior are outside the demonstrated scope. | Sessions persist in the MCP's in-memory map until `kill_session`, but no detach/reconnect live interactive projection contract is published. | Rust, Apache-2.0; release v0.3.10 and source pinned in the existing note. Upstream says runtime needs roughly eight system services and recommends Docker. [WAYDRIVER-MCP][WAYDRIVER-SRC] | **REJECT as currently specified on G3–G5; defer as a different testing product.** It lacks a credible interactive drawer projection and compositor-wide window contract. Could be reconsidered only with explicit replacement product semantics, browser/terminal scope, and a live projection layer. |

## Why Xvnc preserves a session across a viewer disconnect

TigerVNC's wording is unusually direct:

- Xvnc is a normal X server to applications and an RFB server to viewers, with a **virtual screen rather than a physical one**. Applications therefore belong to the Xvnc process/display, not to a particular viewer connection. [XVNC]
- `MaxDisconnectionTime` means “terminate when no client has been connected for N seconds” and defaults to `0`; `MaxIdleTime` likewise defaults to `0`. With those defaults, a viewer disconnect is not a server termination trigger. [XVNC]
- Input and clipboard are server parameters (`AcceptKeyEvents`, `AcceptPointerEvents`, `AcceptCutText`) and default on. [XVNC]

That is **source eligibility**, not proof that this product's noVNC bridge, supervisor or session scripts behave correctly. A wrapper that kills Xvnc when its websocket closes would defeat the upstream capability. The experiment must disconnect the drawer, verify an unseen GUI task continues, reconnect to the same X display, and observe the same page/window/unsaved-field state.

Use one display number and Xauthority file per Bot, bind RFB to a private route/localhost or Unix-socket bridge, and give browser/session components private config/cache/state paths. This is same-UID routing isolation, not a security sandbox.

## Why X11 gives a mature, narrow window-control contract

EWMH is a display-scoped X11 contract rather than a desktop-environment-specific API:

- `_NET_CLIENT_LIST` and `_NET_CLIENT_LIST_STACKING` enumerate all windows managed by the window manager.
- `_NET_ACTIVE_WINDOW` reports the active window and defines a client message requesting activation; the window manager may refuse the request.
- `_NET_SUPPORTED` lets the controller discover which hints the active window manager implements. [EWMH]

A controller such as wmctrl can implement list/focus without parsing desktop-specific shell state, but correctness requires checking `_NET_SUPPORTED`, selecting the intended private `DISPLAY`/Xauthority, sending the request, then observing `_NET_ACTIVE_WINDOW` (or returning a truthful refusal). “Command exited zero” alone is not focus proof.

IceWM is the preferred minimal comparator because its current upstream compliance file explicitly marks `_NET_CLIENT_LIST`, `_NET_CLIENT_LIST_STACKING`, and `_NET_ACTIVE_WINDOW` supported. [ICEWM-COMP] Openbox remains credible but has a much older upstream release, so its packaged behavior should be treated as an experiment rather than assumed.

## Xfce: why Xvnc/X11 is the more mature route

Current Xfce upstream is explicit rather than ambiguous:

- Xfce 4.20's plan was **preliminary** Wayland support, “minimally usable,” without promising all existing features. For 4.22, stabilization continues and X11 feature parity is not yet the target. [XFCE-WL]
- `xfwm4` is “not planned” for Wayland; the future counterpart is `xfwl4`, which upstream calls under heavy development and not stable. Xfce intends to retain X11 compatibility for the foreseeable future. [XFCE-WL]
- The roadmap still lists missing/partial pieces: xfdesktop's all-toplevel list needs an abstraction; some settings belong to the compositor; active-window screenshots are unavailable; some panel plugin “yes” entries mean only that they do not crash; some apps/features are unsupported. [XFCE-WL]
- Labwc can host released Xfce Wayland components and supports the foreign-toplevel protocol, so this is a **deferral**, not a claim that Xfce-on-Wayland cannot run. [LABWC]

By contrast, Xvnc presents a standard X display, runs released Xfwm4, and permits the standard EWMH window contract. This makes Xvnc/X11 the more mature *eligibility route for this product's complete contract*. It does not establish that X11 is faster, smaller, safer, or bug-free; those are experiment questions.

## LXQt and labwc are layers, not interchangeable candidates

LXQt is a desktop environment/session, not the display server. Its official Wayland documentation requires `lxqt-wayland-session`, launches via `startlxqtwayland`, and asks the user to choose a compositor. It lists labwc, Wayfire and KWin as supported stacking compositors and says a working taskbar should use `wlr-foreign-toplevel-management`. Some settings/components remain disabled or compositor-owned. [LXQT-WL]

Labwc is an Openbox-inspired wlroots stacking compositor. Its integration guide describes panels and desktop components as separate clients. It implements layer-shell for panels and foreign-toplevel management for listing applications and requesting actions. [LABWC] Thus the credible Wayland LXQt candidate is the full **labwc + LXQt session/components + WayVNC + foreign-toplevel controller + XWayland where required** stack, not “LXQt” by itself.

The protocol makes the control limitation explicit: it publishes title, app ID, state and lifecycle for every toplevel and defines `activate(seat)`, but does not guarantee the compositor will activate it. [WLR-TOPLEVEL] The runtime adapter must confirm the activated state and surface rejection/timeouts honestly.

## Headless Hyprland constraint

Hyprland's native `hyprctl`/Hypruse route is attractive because it resembles the Host Session and provides compositor-native client/workspace state. That is not enough for eligibility. The stack must first start a **second private compositor** with a usable virtual output while never consuming the host's physical input or controlling its real Hyprland instance.

Official Hyprland material discusses virtual outputs and virtual-GPU setups, and `hyprctl` can control a running compositor, but it does not constitute proof of a reliable pure-headless private-session bootstrap on this NVIDIA Omarchy host. [HYPRCTL][HYPR-VGPU] Hypruse is an automation server for an existing Hyprland desktop, not a compositor/session provisioner. [HYPRUSE] Therefore this stack is deferred behind a narrowly scoped prerequisite experiment; it must never be “proved” by connecting to the Host Session.

## WayDriver scope boundary

WayDriver is the most complete source-owned headless lifecycle among the deferred alternatives: its Mutter backend owns private D-Bus, headless Mutter, PipeWire and WirePlumber children, and its state routes RemoteDesktop and ScreenCast calls within that session. [WAYDRIVER-SRC] Its MCP supports multiple sessions and explicit kill. [WAYDRIVER-MCP]

Its published product boundary is nonetheless GTK4 application testing. `dump_tree`, XPath queries, element actions, AT-SPI element focus, text/key/pointer actions and screenshots are well-defined, but a compositor-wide window inventory/activation API and interactive live drawer transport are absent from the documented tool set. The static HTML/WebM report viewer is not a live projection. [WAYDRIVER-MCP] Do not equate its high-level accessibility control with a complete arbitrary browser/terminal desktop contract.

## Experiment order and promotion rules

### Round 1

Run identical controlled scenarios only for:

1. Sway + WayVNC + native Sway adapter.
2. Xvnc + IceWM + EWMH adapter.
3. Xvnc + minimal Xfce/Xfwm4 + the same EWMH adapter.

Promote a stack to **runtime hard-gate pass** only after two simultaneous private sessions demonstrate:

- correct browser and terminal pixels, pointer, keyboard, literal Unicode and clipboard;
- truthful window list and focus with positive confirmation and real error behavior;
- no cross-Bot or Host Session routing;
- drawer disconnect while graphical work continues, followed by exact live-state reconnect;
- explicit destructive stop with complete process/socket/private-state cleanup;
- repeatable measurements using the framework's whole-process-tree PSS, SwapPSS, CPU, startup, first-frame and reconnect method.

### Conditional round 2

- Replace IceWM with Openbox only if IceWM has a correctness/compatibility blocker attributable to the WM.
- Try LXQt + labwc only if Sway's stacking/user-experience limitations matter or its native adapter cannot be maintained.
- Try Xfce + labwc only after a specific X11 blocker makes the still-stabilizing Wayland path worthwhile.
- Try private Hyprland + Hypruse only after a standalone prerequisite proves two pure-headless private Hyprland sessions on the actual host without physical-device or Host Session access.
- Revisit WayDriver only if the product intentionally accepts an accessibility-first application-test contract and adds a credible interactive live projection/window contract.

No source screen can choose the resource winner. Arch package installed-size metadata excludes running applications, shared pages, portals, media services and projection processes; use it only to verify availability/version/license. The final choice follows observed correctness/isolation first, then Wayland/Omarchy closeness, then measured total cost.

## Bounded local Xvnc experiment

The experiment used temporary, unpacked official Arch packages only: TigerVNC 1.16.2-5, IceWM 4.1.0-1, Openbox 3.6.1-14 and Xfce 4.20 components. Nothing was installed into the host. Three concurrent Xvnc servers used displays `:117`, `:118` and `:119`, private homes/runtime directories, private D-Bus sockets, Unix-only RFB sockets, 1280×720×24 virtual screens and no X TCP listener. Each ran a real private-profile Brave window and Alacritty terminal. This was one session per stack, not the required two sessions of each stack.

### Exercised behavior

| Behavior | Openbox | IceWM | Minimal Xfce components |
| --- | --- | --- | --- |
| Xvnc virtual display and Unix RFB handshake | Pass | Pass | Pass |
| Real Brave and Alacritty windows | Pass | Pass | Pass |
| `computer-use-linux` 0.5.0 list/focus through X11/EWMH | Pass; exact focus result confirmed | Pass; exact focus result confirmed | Pass; exact focus result confirmed |
| Agent screenshot | Pass after supplying its required `gnome-screenshot` helper and private compiled GSettings schema | Same | Same |
| Agent coordinate click | Pass through X11 XTEST | Pass through X11 XTEST | Pass through X11 XTEST |
| Agent literal Chinese `type_text` | **Fail**: visible text differed from the request despite an `ok: true` result | **Fail**: visible text differed from the request despite an `ok: true` result | **Fail**: Chinese text was omitted while the ASCII portion appeared, despite `ok: true` |
| RFB pointer and ASCII key events | Pass on the Openbox instance | Not separately repeated; same Xvnc route | Not separately repeated; same Xvnc route |
| Disconnect/reconnect and live state | Pass | Pass | Pass |
| Cross-session focus routing | Openbox focus changed without changing the IceWM focused window | Pass for the paired observation | Not separately paired |

For each stack, two completed RFB 3.8 handshakes separated by disconnect returned the same 1280×720 desktop. Reconnected Agent screenshots retained the unsaved field contents; the visible JavaScript counters continued increasing while no viewer was connected. This validates connection-independent **live process retention**, not cold teardown/restore. Five subsequent Unix-socket RFB handshakes had medians of 0.56 ms (Openbox), 0.84 ms (IceWM), and 0.69 ms (Xfce). These are local protocol handshakes only, not first usable frame or Computer drawer latency.

The Xfce run was deliberately minimal and is not full `xfce4-session` conformance. The uninstalled portable session first assumed an absolute `/usr/bin/iceauth`; manually supervised Xfwm4 also used a compiled `/usr/share/xfwm4` resource prefix. The experiment kept the host immutable by running individual private components and patching only a temporary Xfwm4 copy's resource prefix. Those observations increase packaging/supervision risk; they are not defects in a normally system-installed Xfce session.

### Disconnected steady-state resource observation

Three equal 10-second observations were taken after the real browser and terminal workloads were running and no RFB client remained connected. Values below are medians. “Infrastructure” includes Xvnc, the WM/desktop components and private D-Bus; “applications” includes the candidate's Brave and Alacritty process trees. CPU is percent of one core.

| Stack | Infrastructure processes | Infrastructure PSS | Infrastructure SwapPSS | PSS + SwapPSS | Infrastructure CPU | Application PSS + SwapPSS | Application CPU |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Xvnc + Openbox | 3 | 1.13 MiB | 30.24 MiB | 31.37 MiB | 0.0% | 221.62 MiB | 1.0% |
| Xvnc + IceWM | 3 | 4.20 MiB | 24.33 MiB | 28.53 MiB | 0.4% | 223.82 MiB | 1.5% |
| Xvnc + minimal Xfce components | 6 | 23.11 MiB | 36.68 MiB | 59.79 MiB | 0.1% | 245.23 MiB | 1.8% |

These are short, swap-heavy observations on one loaded workstation, not capacity claims. They exclude a persistent web projection bridge/viewer, do not measure cold start or first frame, and cannot be compared numerically with the earlier Sway experiment because the workloads and observation conditions differ. They do establish that Xfce did not provide a resource advantage over either minimal X11 WM in this run.

### Runtime conclusion

The X11 family now has concrete evidence for isolation routing, EWMH control, screenshots and live reconnect, but fails the correctness-first Unicode gate through the currently installed Agent backend. Xfce does not remove that shared backend defect. The result therefore strengthens the Sway-first order rather than selecting Xvnc immediately: Sway is closer to Omarchy and its earlier VNC Unicode clipboard path worked, while its missing native Agent window adapter is narrow and already has community implementation evidence. A production choice still requires identical two-session, full projection, lifecycle cleanup, cold-start/first-frame and resource experiments after each candidate's adapter blocker is fixed.


## Explicit unknowns shared by every surviving stack

- Whether the production supervisor can create collision-free per-Bot runtime, socket, display, Xauthority, D-Bus and application-profile paths and reliably route every tool call to them.
- Whether a projection worker can be stopped on drawer close without stopping or suspending GUI work, then reconnect to the same session and exact live state.
- Browser GPU/backend behavior on this NVIDIA host, including XWayland versus native Wayland behavior.
- Literal Unicode/IME, compose sequences, key-up state, physical modifiers, clipboard MIME negotiation and large clipboard payloads through the actual client/bridge.
- Accessibility coverage for real browser and terminal content.
- Full process-tree ownership and cleanup, including D-Bus-activated helpers and application descendants.
- Cold-start and reconnect distributions, whole-stack PSS/SwapPSS, idle/active CPU and projection-only cost. No comparative resource number is asserted here.
- Same-UID isolation is routing isolation only; none of these stacks is an adversarial security sandbox without a stronger process/container boundary.

## Primary sources

- **[CAGE]** Cage README: <https://github.com/cage-kiosk/cage/blob/master/README.md>; license: <https://github.com/cage-kiosk/cage/blob/master/LICENSE>.
- **[SWAY-IPC]** Sway IPC protocol (`SWAYSOCK`, `RUN_COMMAND`, `GET_TREE`): <https://github.com/swaywm/sway/blob/master/sway/sway-ipc.7.scd>.
- **[WAYVNC]** WayVNC README (wlroots attachment, virtual inputs, RFB, headless session): <https://github.com/any1/wayvnc/blob/master/README.md>.
- **[XVNC]** TigerVNC Xvnc manual (virtual X screen, input/clipboard and disconnect defaults): <https://tigervnc.org/doc/Xvnc.html>.
- **[VNCSESSION]** TigerVNC session manual: <https://tigervnc.org/doc/vncsession.html>.
- **[EWMH]** freedesktop.org Extended Window Manager Hints 1.5, root-window properties and messages: <https://specifications.freedesktop.org/wm-spec/latest/ar01s03.html>.
- **[ICEWM]** IceWM README/release/license: <https://github.com/ice-wm/icewm/blob/master/README.md>.
- **[ICEWM-COMP]** IceWM EWMH/ICCCM compliance matrix: <https://github.com/ice-wm/icewm/blob/master/COMPLIANCE>.
- **[XFCE-WL]** Xfce Wayland development roadmap and current component status: <https://wiki.xfce.org/releng/wayland_roadmap>; Xfce 4.20 roadmap: <https://wiki.xfce.org/releng/4.20/roadmap>.
- **[LXQT-WL]** LXQt Wayland session architecture/status: <https://lxqt-project.org/wiki/Wayland-Session.html>; LXQt 2.3 release: <https://lxqt-project.org/release/2025/11/05/release-lxqt-2-3-0/>.
- **[LABWC]** labwc integration architecture and protocols: <https://labwc.github.io/integration.html>; upstream repository/license: <https://github.com/labwc/labwc>.
- **[WLR-TOPLEVEL]** wlroots foreign-toplevel management protocol XML: <https://gitlab.freedesktop.org/wlroots/wlr-protocols/-/raw/master/unstable/wlr-foreign-toplevel-management-unstable-v1.xml>.
- **[HYPRCTL]** official Hyprland `hyprctl` documentation: <https://wiki.hypr.land/Configuring/Advanced-and-Cool/Using-hyprctl/>.
- **[HYPR-VGPU]** official Hyprland virtual-GPU documentation: <https://wiki.hypr.land/Configuring/Advanced-and-Cool/Virtual-GPU/>.
- **[HYPRUSE]** Hypruse README and implementation overview: <https://github.com/IlyasKhallouki/hypruse/blob/7dd11acae0a5631825907f0ba8340dd4088998c4/README.md>; input implementation: <https://github.com/IlyasKhallouki/hypruse/blob/7dd11acae0a5631825907f0ba8340dd4088998c4/src/hypruse/input.py>; IPC implementation: <https://github.com/IlyasKhallouki/hypruse/blob/7dd11acae0a5631825907f0ba8340dd4088998c4/src/hypruse/hyprctl.py>.
- **[WAYDRIVER-MCP]** WayDriver MCP tools, scope and runtime services: <https://waydriver.io/guide/mcp-server.html>.
- **[WAYDRIVER-SRC]** pinned WayDriver Mutter lifecycle source: <https://github.com/BohdanTkachenko/waydriver/blob/25766f126de811e7f066c410c7fd735bb6e55e84/crates/waydriver-compositor-mutter/src/lib.rs>; session lifecycle: <https://github.com/BohdanTkachenko/waydriver/blob/25766f126de811e7f066c410c7fd735bb6e55e84/crates/waydriver-mcp/src/tools/lifecycle.rs>; Apache-2.0 license: <https://github.com/BohdanTkachenko/waydriver/blob/25766f126de811e7f066c410c7fd735bb6e55e84/LICENSE>.
- **[ARCH-TIGER]** Arch TigerVNC 1.16.2-5 metadata/license/dependencies: <https://archlinux.org/packages/extra/x86_64/tigervnc/>.
- **[ARCH-SWAY]** Arch Sway 1:1.12-4 metadata/license/XWayland option: <https://archlinux.org/packages/extra/x86_64/sway/>.
- **[ARCH-WAYVNC]** Arch WayVNC 0.10.1-1 metadata/license: <https://archlinux.org/packages/extra/x86_64/wayvnc/>.
- **[ARCH-ICEWM]** Arch IceWM 4.1.0-1 metadata/license: <https://archlinux.org/packages/extra/x86_64/icewm/>.
- **[ARCH-OPENBOX]** Arch Openbox 3.6.1-14 metadata/license: <https://archlinux.org/packages/extra/x86_64/openbox/>.
- **[ARCH-XFCE]** Arch `xfce4` group versions/components: <https://archlinux.org/groups/x86_64/xfce4/>.
- **[ARCH-LXQT]** Arch `lxqt` group versions/components: <https://archlinux.org/groups/x86_64/lxqt/>.
- **[ARCH-LABWC]** Arch labwc 0.20.2-1 metadata/license/XWayland option: <https://archlinux.org/packages/extra/x86_64/labwc/>.
