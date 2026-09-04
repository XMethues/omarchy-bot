# 08: Cut over the production Bot Screen

**What to build:** Make the validated Cage Bot Desktop and hybrid PNG/H.264 Screen Projection the sole production Bot Screen path. Users retain the same Bot-owned Computer Preview, Web Control, Takeover, snapshot, isolation, recovery, and deletion behavior while obsolete Hyprland, `hyprctl`, Alacritty, and expanded image-stream machinery are removed completely.

**Blocked by:** 07 / Pass the Cage and H.264 capacity gate.

**Status:** resolved — Cage and hybrid PNG/H.264 are the sole production Bot Screen stack

- [x] Cage is the production-default and only runtime implementation; no dormant runtime selector, Hyprland fallback, or dual provisioning path remains.
- [x] Production setup no longer requires Hyprland, `hyprctl`, generated Hyprland configuration, a parent Wayland bootstrap, or Alacritty for Bot Screen readiness.
- [x] Computer Preview uses the low-frequency lossless image path, Expanded Web Control uses the H.264 media track, and HTTP snapshot remains the explicit read-only fallback.
- [x] The obsolete expanded PNG/JPEG pump, protocol fields, browser assembly path, tests, configuration, and dependencies are removed without compatibility aliases.
- [x] Every daemon, protocol, API client, browser, fake peer, platform smoke, load harness, setup instruction, and operational document uses the final transport and runtime contracts.
- [x] A new Computer Control ADR supersedes only the compositor-specific mechanism in the nested-Hyprland ADR and preserves per-Bot Surface ownership, private sockets, headless outputs, independent input/focus, measured capacity, and the non-adversarial-isolation boundary.
- [x] The checked-in capacity approval references the passing Cage/H.264 final-stack report and retains explicit behavior for unsupported capacity rows.
- [x] Fresh installation, daemon restart, Bot creation, Web Control, Takeover, Bot switching, failure recovery, and permanent deletion work without legacy binaries present.
- [x] Non-loopback product copy and protocol metadata retain the repository's explicit unauthenticated/insecure-remote-access posture and do not imply that H.264 or private Wayland sockets add authentication.
- [x] Final verification passes the complete applicable integration, Web E2E, two-Screen platform smoke, and approved capacity gates with no orphaned legacy code, processes, sockets, configuration, or documentation.

## Answer

Production now instantiates the pure-headless Cage Bot Desktop adapter directly. The runtime selector, nested-Hyprland adapter and smoke, generated compositor configuration, parent-Wayland bootstrap, `hyprctl`/Alacritty assumptions, and expanded image transport are gone rather than retained behind aliases or fallbacks. Computer Preview sends low-frequency PNG frames, Expanded Web Control sends only the H.264 WebRTC media track, and HTTP PNG snapshot remains read-only fallback. The schema-v3 approval points to the passing final-stack report, authorizes four 1080p Screens by default and eight at 720p, and rejects eight at 1080p before partial provisioning.

Computer Control ADR 0008 records the Cage mechanism while retaining per-Bot Surface ownership, private sockets, headless outputs, independent input/focus, measured admission, cleanup, and the non-adversarial isolation boundary. Setup and protocol copy continue to state that non-loopback control is unauthenticated: private Wayland sockets and WebRTC media encryption do not authenticate remote peers.

Validation from the repository root:

```bash
bun run typecheck
```

Passed.

```bash
bun test tests/integration/bot-screen-config.test.ts tests/integration/bot-screen-cage-runtime.test.ts tests/integration/bot-screen-lifecycle.test.ts tests/integration/computer-worker-launch.test.ts tests/integration/screen-projection.test.ts tests/unit/h264-encoder.test.ts tests/unit/bot-screen-capacity-report.test.ts apps/web/src/lib/screenProjection.test.ts
```

Passed 59 focused tests.

```bash
OMARCHY_BOT_REAL_CAGE_SMOKE=1 \
OMARCHY_BOT_CAGE_BIN=/tmp/cage-portable.sh \
OMARCHY_BOT_WLR_RANDR_BIN=/tmp/wlr-randr-portable.sh \
OMARCHY_BOT_CAGE_SMOKE_PROFILE=720p \
PATH=/tmp/compositor-portable/usr/bin:/home/colin/.local/share/mise/installs/bun/latest/bin:/usr/local/sbin:/usr/local/bin:/usr/bin \
XDG_RUNTIME_DIR=/run/user/1000 \
bun test tests/integration/bot-screen-cage.smoke.test.ts
```

Passed the real two-Screen Cage smoke: 1 test and 48 assertions.

```bash
bunx playwright test -c tests/e2e tests/e2e/specs/10-computer-sheet.spec.ts
```

Passed all 12 Computer Surface E2E tests.

```bash
OMARCHY_BOT_REAL_SCREEN_LOAD=1 \
OMARCHY_BOT_CAGE_BIN=/tmp/cage-portable.sh \
OMARCHY_BOT_WLR_RANDR_BIN=/tmp/wlr-randr-portable.sh \
OMARCHY_BOT_LOAD_BROWSER_BIN=/home/colin/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome \
OMARCHY_BOT_LOAD_MATRIX=1,2,4,8 \
OMARCHY_BOT_LOAD_FALLBACK=1 \
OMARCHY_BOT_LOAD_DURATION_MS=15000 \
OMARCHY_BOT_LOAD_LAN_INTERFACE=eno1 \
OMARCHY_BOT_LOAD_REPORT=/home/colin/Projects/omarchy-bot/.scratch/bot-screen-media-desktop/capacity-report.json \
OMARCHY_BOT_LOAD_APPROVAL=/home/colin/Projects/omarchy-bot/apps/daemon/src/bootstrap/bot-screen-capacity-approval.json \
bun test tests/integration/bot-screen-capacity.load.test.ts
```

Passed the complete 1/2/4/8-at-1080p plus eight-at-720p final-stack gate: 1 test in 231.60 seconds. The supported rows are 1, 2, and 4 Screens at 1080p and 8 Screens at 720p; the completed 8-Screen 1080p row remains explicitly unsupported.
