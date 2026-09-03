# 02: Provision one real headless Bot Screen

**What to build:** Let a user open Computer for one Bot and obtain a real, independently managed headless Bot Screen rather than the physical Shared Screen. The Surface starts lazily, reports honest lifecycle state, runs a graphical application under its Bot-owned profile, and produces a real read-only Computer Preview.

**Blocked by:** 01: Scope Computer Surface to durable Bot Screen identity.

**Status:** resolved

- [x] First preview or computer use lazily starts one supervised minimal nested Hyprland runtime for the owning Bot.
- [x] The child uses a private mode-0700 runtime directory, a Bot-owned config/state/cache profile, and an explicit environment without importing into the global user environment.
- [x] The child creates its named 1920×1080 headless output, removes the parent-visible bootstrap output, and never starts the full Omarchy/UWSM autostart configuration.
- [x] The Computer Surface reports plain-language starting, ready, and unavailable states from actual runtime readiness.
- [x] The Computer Preview displays a fresh capture from the assigned child socket/output and remains read-only.
- [x] A real platform smoke scenario proves the child is absent from the host client list, its preview has distinct pixels, and test teardown leaves no child process or runtime socket.

## Answer

`HyprlandBotScreenRuntime` now lazily provisions the owning Surface as supervised compositor, application, input, and worker units with private runtime and profile directories, and exposes readiness and direct child-output capture through `BotScreenManager`. The focused Computer integration covers honest starting, ready, unavailable, and preview behavior; the real Hyprland smoke proves mode-0700 isolation, no host client leakage, distinct non-host pixels, and complete runtime teardown.
