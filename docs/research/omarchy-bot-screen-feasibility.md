# Per-Bot independent screen feasibility on Omarchy/Hyprland

**Research date:** 2026-09-03<br>
**Verdict:** **Conditional yes** for multiple concurrent independent Bot Screens under one Unix login, but **not** as multiple full Omarchy/UWSM graphical sessions. The supported shape is one real Omarchy/UWSM login session plus one nested compositor process per Bot. For strict separation from the Shared Screen, each nested Hyprland must bootstrap through Aquamarine’s Wayland backend, create its own headless output, remove its parent-visible `WAYLAND-*` output, and accept capture/input only through its own child Wayland socket. This strict headless transition is source-supported and locally verified. Two concurrent nested Hyprland instances with separate clients, input, and screenshots have been proven locally.

A pure headless Hyprland launch is **not currently supported**: Hyprland 0.56.2 has no backend-selection option, Aquamarine’s headless backend supplies no DRM/render fd, and Aquamarine requires another implementation to provide an allocator. Old `WLR_BACKENDS=headless Hyprland` recipes do not apply because current Hyprland uses Aquamarine, not wlroots.

## Investigated versions

| Component | Version/revision |
|---|---|
| Omarchy | `4.0.0.alpha`, `f99d33a` |
| Hyprland | `v0.56.2`, `efb50993780079460b0cbed1363e2166a2de1d9f` |
| Aquamarine | `v0.14.0`, `a79fb21b2e2a82dd061a6d071802bcf38bd5c383` |
| xdg-desktop-portal-hyprland | `v1.4.1`, `cc8e5ef8fb2acef3db488b9a33b0c48c2a4ee204` |
| xdg-desktop-portal | `1.22.1`, `1d20fadc304f6601452b5db65ed91197dba77041` |
| UWSM | `v0.26.7`, `ab5ec16d96ed1f77c3c7ff2e3f07ed42caf23f2d` |
| systemd | `v261.2`, `4925d9f` |
| PipeWire | `1.6.8`, `b741e0c74f5436f0c925f7741140db0efd32cf4e` |
| Wayland | `1.26.0`, `87cc8a8728a923fc57938faa81ba0e74f34ecdc7` |
| wlroots | `0.19.2`, `8c9e6b7c9f3c5344f456e97dc29dcd8d8a5f015b` |
| Weston | `15.0.0`, `c9c305121cfb3427182eaf3761961094b1196b99` |
| wayvnc | `0.11-dev`, `e0a2392` |

## Local proof (parent-reported, separate from upstream evidence)

The main research process reported this successful probe on the installed Hyprland 0.56.2/Aquamarine 0.14.0 stack:

- two Hyprland child processes ran concurrently, both initially connecting to parent `WAYLAND_DISPLAY=wayland-1`;
- they exposed independent server sockets `wayland-2` and `wayland-3`;
- a separate Alacritty client ran in each child;
- `wtype` targeted each child independently;
- `grim` screenshots proved `SCREEN_A_ONLY` appeared only on A and `SCREEN_B_ONLY` only on B.
- A child created `BOT-PROBE`, removed parent-visible `WAYLAND-1`, remained alive with only `BOT-PROBE` at 1920×1080@60, and disappeared from the parent client list; Alacritty plus `wtype HEADLESS_BOT_SCREEN_OK` and `grim -o BOT-PROBE` proved headless child keyboard input and capture.
- A temporary client using Hyprland's output-bound `wlr-virtual-pointer` protocol then exercised two headless children concurrently. Moving A to `(100,120)` left B at `(959,539)` and the host at `(1280,720)`; moving B to `(700,400)` left A and the host unchanged. A click changed focus only inside A, wheel events visibly scrolled only A's terminal, and a press–move–release visibly selected text only inside A.
- Concurrent stress clients each submitted 5,000 absolute pointer events plus a final position and completed a compositor round trip in 0.07 seconds. A settled at `(111,222)`, B at `(777,333)`, and the host remained at `(1280,720)`.
- With two child compositors and three Alacritty clients, each idle Hyprland process reported about 368 MiB RSS but only 112 MiB proportional set size and 0.1% CPU. `nvidia-smi` reported 1,958 MiB total GPU memory both before and after child teardown, so this probe did not resolve incremental GPU memory.

The production implementation now proves browser coordinate mapping, held-input cleanup, stale-generation rejection, repeated lifecycle teardown, and sustained final-stack capacity in addition to the platform properties above. Portal-per-child operation remains intentionally untested because production capture and input connect directly to each child Wayland socket.

## Primary-source evidence

| Question | Primary-source evidence | Consequence |
|---|---|---|
| Can Hyprland create distinct concurrent server endpoints? | Hyprland generates a random per-process `HYPRLAND_INSTANCE_SIGNATURE`, creates `$XDG_RUNTIME_DIR/hypr/<signature>`, and selects a free `wayland-1`…`wayland-32` socket before falling back to libwayland auto-allocation ([Compositor.cpp L192-L220](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/Compositor.cpp#L192-L220), [L383-L416](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/Compositor.cpp#L383-L416)). | Separate processes get separate Wayland and Hyprland IPC namespaces even with a shared runtime directory. Private runtime directories make that separation explicit and remove name discovery/collision between Bots. |
| Does current Hyprland support nesting? | Hyprland constructs Aquamarine with mandatory headless, optional DRM, and fallback Wayland implementations ([Compositor.cpp L309-L321](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/Compositor.cpp#L309-L321)). Aquamarine’s Wayland backend calls `wl_display_connect(nullptr)`, verifies `xdg_wm_base`, `wl_compositor`, `wl_seat`, `zwp_linux_dmabuf_v1`, and `wl_shm`, then creates `WAYLAND-1` ([Wayland.cpp L96-L172](https://github.com/hyprwm/aquamarine/blob/v0.14.0/src/backend/Wayland.cpp#L96-L172)). | A child Hyprland is a real compositor with its own socket/state, while its backend is a Wayland client of the host compositor. The local probe confirms this path on the target machine. |
| Can the Bot output be non-visible/headless? | Aquamarine implements `CHeadlessBackend::createOutput`, with a default 1920×1080@60 mode ([Headless.cpp L112-L185](https://github.com/hyprwm/aquamarine/blob/v0.14.0/src/backend/Headless.cpp#L112-L185)). Hyprland’s IPC accepts `output create headless <name>` and `output remove <name>`; Wayland and headless monitors are marked user-created/removable ([HyprCtl.cpp L1761-L1812](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/debug/HyprCtl.cpp#L1761-L1812), [Monitor.cpp L258-L260](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/output/Monitor.cpp#L258-L260)). Destroying a Wayland output removes its parent surface but not the backend connection ([Wayland.cpp L598-L606](https://github.com/hyprwm/aquamarine/blob/v0.14.0/src/backend/Wayland.cpp#L598-L606)). | After bootstrap, create `HEADLESS-*`, configure it, then remove `WAYLAND-*`. The child retains the parent connection/render allocator without projecting Bot pixels into a host toplevel. This precise transition is now proven on the target machine. |
| Can Hyprland run headless without a parent or DRM allocator? | The headless backend returns `-1` for both DRM fd methods and its output swapchain uses the backend’s primary allocator ([Headless.cpp L125-L145](https://github.com/hyprwm/aquamarine/blob/v0.14.0/src/backend/Headless.cpp#L125-L145), [L170-L181](https://github.com/hyprwm/aquamarine/blob/v0.14.0/src/backend/Headless.cpp#L170-L181)). Aquamarine fails startup when no implementation supplies an fd/allocator ([Backend.cpp L158-L177](https://github.com/hyprwm/aquamarine/blob/v0.14.0/src/backend/Backend.cpp#L158-L177)). Hyprland itself leaves `// TODO: headless only` after backend construction ([Compositor.cpp L328-L339](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/Compositor.cpp#L328-L339)). | Pure Aquamarine headless is not a supported Hyprland launch topology. A child needs either DRM/KMS ownership or the nested Wayland backend to supply a render node and allocator. |
| What GPU access does nested Hyprland require? | Aquamarine consumes linux-dmabuf default feedback, resolves the advertised device to a render node (falling back to a primary node), and opens it read/write ([Wayland.cpp L371-L467](https://github.com/hyprwm/aquamarine/blob/v0.14.0/src/backend/Wayland.cpp#L371-L467)). Hyprland publishes linux-dmabuf v5 when DMABUF is available ([ProtocolManager.cpp L253-L262](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/managers/ProtocolManager.cpp#L253-L262)). The kernel states that render nodes omit modesetting and DRM-Master and are intended for render clients independent of a graphics server ([DRM render-node documentation](https://github.com/torvalds/linux/blob/master/Documentation/gpu/drm-uapi.rst#render-nodes)). | All children may open the same render node concurrently; they do not compete for KMS/DRM master. Startup fails if the parent omits required protocols/default feedback or the child cannot open the advertised render node. This is the principal NVIDIA/driver condition. |
| How are pixels captured? | Hyprland registers wlr-screencopy v3 and implements output/region capture ([ProtocolManager.cpp L228-L232](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/managers/ProtocolManager.cpp#L228-L232), [Screencopy.cpp L17-L65](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/protocols/Screencopy.cpp#L17-L65)). The protocol captures a named `wl_output` into a supplied buffer ([XDPH vendored protocol L41-L68](https://github.com/hyprwm/xdg-desktop-portal-hyprland/blob/v1.4.1/protocols/wlr-screencopy-unstable-v1.xml#L41-L68)). | A capture helper connected only to Bot A’s socket can capture only outputs exposed by compositor A; no host/workspace projection is required. |
| How is pointer/keyboard input injected? | Hyprland registers virtual-keyboard and wlr-virtual-pointer managers ([ProtocolManager.cpp L191-L195](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/managers/ProtocolManager.cpp#L191-L195)). The pointer protocol can create a pointer bound to a specific output and accepts relative/absolute motion, buttons, axes, and frames ([wlr-virtual-pointer XML L43-L166](https://github.com/hyprwm/Hyprland/blob/v0.56.2/protocols/wlr-virtual-pointer-unstable-v1.xml#L43-L166)); Hyprland turns those requests into compositor pointer events ([VirtualPointer.cpp L7-L101](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/protocols/VirtualPointer.cpp#L7-L101)). The virtual-keyboard protocol emulates raw keyboard input ([virtual-keyboard XML L31-L106](https://github.com/hyprwm/Hyprland/blob/v0.56.2/protocols/virtual-keyboard-unstable-v1.xml#L31-L106)). | One capture/input helper per child socket gives each Bot its own cursor, focus, and keyboard state. Bind the virtual pointer to that child’s headless output. Do not inject through the host compositor or shared `/dev/uinput`. |
| Can UWSM manage one session per Bot? | systemd explicitly supports only one graphical session per user and identifies the shared D-Bus session bus as the core problem ([DESKTOP_ENVIRONMENTS.md L10-L24](https://github.com/systemd/systemd/blob/v261.2/docs/DESKTOP_ENVIRONMENTS.md#L10-L24)). UWSM binds its compositor units to the shared `graphical-session*.target` hierarchy and exports environment deltas to systemd/D-Bus activation environments ([uwsm.1.scd L129-L166](https://github.com/Vladimir-csp/uwsm/blob/v0.26.7/man/uwsm.1.scd#L129-L166)); `uwsm check may-start` requires graphical-session targets not already active ([L231-L257](https://github.com/Vladimir-csp/uwsm/blob/v0.26.7/man/uwsm.1.scd#L231-L257)). | Run exactly one host UWSM session. Bot compositors are application/transient units inside it, never additional `uwsm start` sessions. |
| Why not run the full Omarchy Hyprland config in every child? | Omarchy’s default autostart imports the entire child environment into the shared user systemd manager and D-Bus activation environment, then starts shell/provision/power/monitor/disk services ([autostart.lua L1-L14](https://github.com/basecamp/omarchy/blob/f99d33a/default/hypr/autostart.lua#L1-L14)). | Concurrent full Omarchy configs would race and overwrite global `WAYLAND_DISPLAY`/`HYPRLAND_INSTANCE_SIGNATURE`, duplicate singleton services, and disturb the Shared Screen. Use a purpose-built minimal Hyprland config that does not import activation environment or start Omarchy session services. |
| How should child lifecycle/env be managed? | `systemd-run` creates transient services/scopes; a scope inherits its caller’s environment, while `--setenv=NAME=VALUE` sets per-unit variables ([systemd-run.xml L58-L78](https://github.com/systemd/systemd/blob/v261.2/man/systemd-run.xml#L58-L78), [L321-L333](https://github.com/systemd/systemd/blob/v261.2/man/systemd-run.xml#L321-L333)). | Use a uniquely named transient user service/scope per Bot and pass explicit variables; never mutate the user manager’s global activation environment. Supervisor teardown should stop the whole per-Bot unit/cgroup. |
| Can each Bot have a separate runtime directory while reaching the host? | Wayland 1.26 accepts an absolute `WAYLAND_DISPLAY`; absolute paths bypass `XDG_RUNTIME_DIR` resolution ([wayland-client.c L1328-L1347](https://gitlab.freedesktop.org/wayland/wayland/-/blob/1.26.0/src/wayland-client.c#L1328-L1347)). | Give every Bot a mode-0700 runtime directory and launch its compositor with the absolute host socket. The child then creates its own `wayland-1` inside its private runtime. |
| Are portals naturally per compositor? | The portal frontend owns the single well-known session-bus name `org.freedesktop.portal.Desktop` ([xdg-desktop-portal README L5-L10](https://github.com/flatpak/xdg-desktop-portal/blob/1.22.1/README.md#L5-L10)). XDPH owns the single name `org.freedesktop.impl.portal.desktop.hyprland`, then calls `wl_display_connect(nullptr)` ([PortalManager.cpp L270-L290](https://github.com/hyprwm/xdg-desktop-portal-hyprland/blob/v1.4.1/src/core/PortalManager.cpp#L270-L290)). Its advertised interfaces are Screenshot, ScreenCast, GlobalShortcuts, and InputCapture—not RemoteDesktop ([hyprland.portal L1-L4](https://github.com/hyprwm/xdg-desktop-portal-hyprland/blob/v1.4.1/hyprland.portal#L1-L4)). | One shared session bus can host only one normal portal frontend/backend binding; it cannot route simultaneous child compositors by `WAYLAND_DISPLAY`. XDPH also provides no RemoteDesktop injection API. |
| What does the XDPH ScreenCast path do? | XDPH captures the selected output through wlr-screencopy, creates a PipeWire `Video/Source`, and returns its node ID ([Screencopy.cpp L254-L323](https://github.com/hyprwm/xdg-desktop-portal-hyprland/blob/v1.4.1/src/portals/Screencopy.cpp#L254-L323), [L1017-L1039](https://github.com/hyprwm/xdg-desktop-portal-hyprland/blob/v1.4.1/src/portals/Screencopy.cpp#L1017-L1039)). XDG InputCapture captures existing device events for an application and cannot be activated immediately; it is not an injection API ([InputCapture XML L22-L55](https://github.com/flatpak/xdg-desktop-portal/blob/1.22.1/data/org.freedesktop.portal.InputCapture.xml#L22-L55)). | Portal ScreenCast can produce per-child PipeWire nodes only if each child gets a private bus and its own portal processes. Input must still use virtual-pointer/keyboard. Direct compositor protocols are simpler and avoid portal selection/activation. |
| Can PipeWire be shared or isolated? | PipeWire’s default socket is `$XDG_RUNTIME_DIR/pipewire-0`; `PIPEWIRE_RUNTIME_DIR` has lookup priority, `PIPEWIRE_REMOTE` selects a socket, and `core.name` sets the server socket name ([protocol.dox L61-L67](https://gitlab.freedesktop.org/pipewire/pipewire/-/blob/1.6.8/doc/dox/internals/protocol.dox#L61-L67), [pipewire.1.md L92-L103](https://gitlab.freedesktop.org/pipewire/pipewire/-/blob/1.6.8/doc/dox/programs/pipewire.1.md#L92-L103), [pipewire.conf.5.md L201-L203](https://gitlab.freedesktop.org/pipewire/pipewire/-/blob/1.6.8/doc/dox/config/pipewire.conf.5.md#L201-L203)). | Distinct node IDs in the host PipeWire graph are enough for routing trusted Bots. If same-UID discovery/access is unacceptable, run separate PipeWire remotes or a PipeWire security context and pass the corresponding remote explicitly. |
| What do wlroots/headless alternatives support? | wlroots documents DRM/libinput native, Wayland/X11 nested, and headless backends ([architecture.md L11-L15](https://gitlab.freedesktop.org/wlroots/wlroots/-/blob/0.19.2/docs/architecture.md#L11-L15)); `WLR_BACKENDS`, `WLR_RENDERER=pixman`, `WLR_RENDER_DRM_DEVICE`, and `WLR_HEADLESS_OUTPUTS` apply to wlroots compositors ([env_vars.md L5-L18](https://gitlab.freedesktop.org/wlroots/wlroots/-/blob/0.19.2/docs/env_vars.md#L5-L18), [L36-L37](https://gitlab.freedesktop.org/wlroots/wlroots/-/blob/0.19.2/docs/env_vars.md#L36-L37)). wayvnc attaches to a wlroots-based session, captures one display, creates virtual input devices, and explicitly supports headless sessions ([README L6-L11](https://github.com/any1/wayvnc/blob/e0a2392/README.md#L6-L11)). | A wlroots compositor plus wayvnc is a valid GPU-optional alternative, but it is a different compositor stack and those `WLR_*` switches do not configure Hyprland/Aquamarine. |
| Is there a single-process compositor+stream alternative? | Weston documents that its VNC backend runs in memory without graphics/input hardware and exposes interaction over RFB ([weston.man L50-L74](https://gitlab.freedesktop.org/wayland/weston/-/blob/15.0.0/man/weston.man#L50-L74)); it accepts an explicit Wayland socket ([L226-L234](https://gitlab.freedesktop.org/wayland/weston/-/blob/15.0.0/man/weston.man#L226-L234)), and the VNC backend accepts address/port/size with one client per instance ([weston-vnc.man L8-L25](https://gitlab.freedesktop.org/wayland/weston/-/blob/15.0.0/man/weston-vnc.man#L8-L25), [L55-L76](https://gitlab.freedesktop.org/wayland/weston/-/blob/15.0.0/man/weston-vnc.man#L55-L76)). | One Weston VNC process per Bot is the simplest fully headless screen+stream+input topology if Hyprland behavior is not required. Weston/wayvnc were not installed in this research environment, so this requires a product/dependency change. |

## Least-complex viable architecture for omarchy-bot

The least change that preserves current Hyprland-targeted behavior and the worker’s `WAYLAND_DISPLAY` routing is:

1. **Keep the physical Omarchy Hyprland/UWSM session as the only graphical session.** Do not run `uwsm start` per Bot.
2. **Create a private runtime directory per Bot** (owned by the login UID, mode 0700), for example `/run/user/$UID/omarchy-bot/$BOT_ID`.
3. **Launch one child Hyprland per Bot as a transient application service**, not a session service. Pass:
   - `XDG_RUNTIME_DIR=<bot-runtime>`;
   - initial `WAYLAND_DISPLAY=/run/user/$UID/<host-wayland-socket>` (absolute, so it reaches the parent despite the private runtime);
   - a minimal per-Bot `--config` with no Omarchy/UWSM/systemd-environment autostart;
   - `PIPEWIRE_RUNTIME_DIR=/run/user/$UID` only if sharing the host PipeWire daemon;
   - distinct `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, and `XDG_CACHE_HOME` if application profile/state separation is required.
4. **Discover readiness from the child runtime**, not the global activation environment. Record that child’s generated Wayland socket and `HYPRLAND_INSTANCE_SIGNATURE`; pass both explicitly to its worker and apps.
5. **For the strict Bot Screen contract**, issue against that child only: `hyprctl output create headless BOT-$BOT_ID`, apply the desired monitor mode, then `hyprctl output remove WAYLAND-1`. Do not merely park the nested parent window on a hidden host workspace: that remains a Shared Screen projection.
6. **Capture from the child socket** with wlr-screencopy (or ext-image-copy-capture) bound to `BOT-$BOT_ID`; encode/WebRTC-stream that buffer or publish a deliberately named PipeWire node.
7. **Inject into the child socket** with output-bound wlr virtual pointer plus virtual keyboard. This maintains independent compositor cursor/focus/key state and avoids host focus.
8. **Own all child processes in the Bot’s unit/cgroup.** Stop the unit on Bot destruction or host graphical-session shutdown; never use `systemctl --user import-environment` for child values.

A schematic launch (the supervisor should use direct argv/environment APIs rather than shell interpolation) is:

```text
systemd-run --user --unit=omarchy-bot-screen-$BOT_ID \
  --property=Type=exec \
  --setenv=XDG_RUNTIME_DIR=$BOT_RUNTIME \
  --setenv=WAYLAND_DISPLAY=/run/user/$UID/$HOST_WAYLAND_DISPLAY \
  --setenv=PIPEWIRE_RUNTIME_DIR=/run/user/$UID \
  Hyprland --config $BOT_HYPRLAND_CONFIG
```

If portal-dependent applications must run inside Bot Screens, wrap each Bot process tree in `dbus-run-session` (which officially creates a bus for the lifetime of a program: [dbus-run-session(1)](https://dbus.freedesktop.org/doc/dbus-run-session.1.html)), and launch one portal frontend/backend pair on that bus with the child `WAYLAND_DISPLAY`. This is a higher-complexity fallback, not the recommended capture/control path, and requires an end-to-end activation/picker/teardown test.

If preserving Hyprland behavior is unnecessary, **one Weston VNC backend process per Bot with a unique `--socket` and `--port` is the least component count** because the compositor, headless output, stream, and remote input transport are integrated. It does not reproduce an Omarchy desktop and is not currently installed.

## Resource cost and scaling

- **GPU/KMS:** nested children share the render node and require no additional DRM master/KMS connector. This is the correct concurrency model for the installed NVIDIA GPU, conditional on dmabuf feedback and render-node open/import succeeding.
- **Output buffers:** Hyprland configures output swapchains to length 3 ([Monitor.cpp L2678-L2697](https://github.com/hyprwm/Hyprland/blob/v0.56.2/src/output/Monitor.cpp#L2678-L2697)). At 1920×1080 XRGB8888, the three scanout-sized buffers alone are `3 × 1920 × 1080 × 4 = 24,883,200` bytes (about 23.7 MiB) per Bot. This is a lower bound: client buffers, renderer targets, capture buffers, textures, Xwayland, and encoder surfaces add memory.
- **CPU/GPU work:** composition and capture scale approximately with active Bot count × output pixels × frame rate. Aquamarine’s default headless mode is 1080p60; use an explicit smaller mode/lower refresh where acceptable.
- **Processes:** minimum per Bot is compositor + worker/capture-input helper + applications. Xwayland is enabled by default in Hyprland 0.56.2; disable it in the minimal config when Bot apps are Wayland-native. A private portal adds `dbus-daemon`, `xdg-desktop-portal`, and XDPH; a private PipeWire graph adds more daemons.
- **PipeWire:** sharing one daemon avoids per-Bot daemon cost, but it is routing isolation rather than a hard same-UID security boundary.

### Measured production envelope

The opt-in final-stack harness is reproducible with:

```bash
OMARCHY_BOT_REAL_SCREEN_LOAD=1 bun test tests/integration/bot-screen-capacity.load.test.ts
```

On the target Ryzen 9 7900X, RTX 2080 Ti, Hyprland 0.56.2/Aquamarine 0.14.0 workstation, the schema-v2 gate used Brave 152.1.94.119, a 16 FPS capture rate, and 15-second phases. The built production web client connected through `https://192.168.10.25:<ephemeral-port>` rather than loopback; each displayed sample was counted only after WebRTC receipt, image decode, a browser paint task, and canvas readback. Projection-session counters independently measured source, encoded and sent frames plus every backpressure, invalid-frame, transport-unavailable and send-failure category.

| Profile | Screens | Source / encoded FPS | Browser-displayed FPS | Input-to-visible p50 / p95 | Capture-to-browser p50 / p95 | Active PSS / RSS | CPU | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1080p | 1 | 16.02 | 16.02 | 106.9 / 141.4 ms | 25 / 31 ms | 581.20 / 1,958.95 MiB | 27.26% | pass |
| 1080p | 2 | 16.13 | 16.13 | 125.0 / 491.9 ms | 29 / 35 ms | 948.03 / 3,727.39 MiB | 54.58% | pass |
| 1080p | 4 | 15.69–15.76 | 15.69–15.76 | 155.0 / 480.4 ms | 34 / 43 ms | 1,606.08 / 7,295.25 MiB | 138.68% | pass |
| 1080p | 8 | 15.41–15.67 | 6.24–6.77 | 259.6 / 561.7 ms | 67 / 97 ms | 2,769.17 / 14,378.85 MiB | 249.19% | fail: display throughput and median latency |
| 720p | 8 | 16.91 | 16.65–16.91 | 96.4 / 460.7 ms | 28 / 42 ms | 2,760.89 / 14,373.09 MiB | 171.70% | pass |

Every row passed an independent operational gate: a sustained static-preview phase at about 1 FPS, simultaneous Broker-owned Agent and Web input, Takeover, two reconnects per Screen, isolated input-helper and compositor crashes where the row had enough Screens, two permanent-delete/fresh-Bot provision cycles with new Surface IDs, and complete removal of runtime directories, profile directories and transient units. The 1/2/4-Screen 1080p rows had zero source, transport, decode, paint, backpressure, invalid-frame, send-failure, target-shortfall and unexplained drops. At eight 1080p Screens the source and encoder remained above 15 FPS, but the browser accumulated 1,079 explicitly accounted paint drops and a 1,011-frame displayed target shortfall. Eight 720p Screens passed with 13 accounted paint drops, no target shortfall and no unexplained loss.

The four-Screen 1080p row therefore justifies the checked-in default-capacity approval of four; the fifth admission fails explicitly without a partial runtime or impact on active Screens. Eight 1080p Screens are not supported, while the selectable 720p profile passed at eight. `nvidia-smi` exposed whole-GPU utilization and memory totals but did not expose attributable graphics-process VRAM for these children, so the report records per-Screen GPU and VRAM as unavailable rather than inferring them.

## Unsupported topologies and blockers

- **No:** multiple `uwsm start`/full Omarchy sessions for the same user. systemd and UWSM activation state are per user, and Omarchy autostart writes compositor variables globally.
- **No:** one host Hyprland workspace or virtual output per Bot. Workspaces/outputs inside one compositor share global focus, pointer, input, IPC, and capture authority; they are not independent Bot Screens.
- **No:** `WLR_BACKENDS=headless Hyprland`. Those variables belong to wlroots; Hyprland 0.56.2 selects Aquamarine implementations in code.
- **No:** portal-only remote control through XDPH. XDPH 1.4.1 does not advertise RemoteDesktop; InputCapture exports events away from the compositor rather than injecting them.
- **Conditional:** nested Hyprland requires host linux-dmabuf support/default feedback and permission to open/import on the advertised render node. There is no documented Aquamarine switch to force Wayland-only and skip its DRM attempt.
- **Conditional:** private-bus portals require explicitly managed activation and noninteractive source selection/restore behavior; the shared user bus cannot distinguish child `WAYLAND_DISPLAY` values.
- **Security boundary:** separate sockets/processes isolate accidental state and routing, but processes under the same UID can normally open each other’s files/sockets and inspect a shared PipeWire graph. Adversarial Bot isolation requires OS sandboxing/separate UIDs or namespaces in addition to compositor separation.

## Remaining production verification

1. If future requirements introduce portals, test one private bus + portal frontend + XDPH per Bot, unattended capture authorization/restore, unique PipeWire node selection, and teardown. The current implementation deliberately keeps portals out of the Bot capture/input path.
2. Repeat the capacity matrix after compositor, browser, driver, encoder, output-profile or capture-rate changes; the measured default is specific to the stack and versions recorded above.
