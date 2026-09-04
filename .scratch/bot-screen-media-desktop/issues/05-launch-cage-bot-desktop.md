# 05: Launch a persistent Cage Bot Desktop

**What to build:** Allow one Bot Screen to run on a pure-headless Cage compositor and present a persistent neutral Bot Desktop instead of an Alacritty sentinel. The user can observe and control the Screen, launch a real application, interact with its transient dialogs, and close the application without destroying the Bot Screen.

**Blocked by:** 02 / Decouple Bot Screen runtime lifecycle.

**Status:** ready-for-agent

- [ ] A selectable Cage runtime launches in a private mode-0700 runtime with a pure headless backend and no dependency on the host Wayland display, full Omarchy session, or global activation environment.
- [ ] The selected 1080p or 720p profile creates an explicit output whose logical geometry, video geometry, scale, and geometry generation match the public Bot Screen contract.
- [ ] A minimal persistent Bot Desktop commits a neutral surface and becomes the runtime's application-readiness proof; Alacritty is not required.
- [ ] The Bot Desktop remains alive when a launched application exits and does not itself add panels, wallpaper services, portals, notification daemons, or clipboard bridges.
- [ ] The computer worker launches applications only into the owning Bot Screen's Wayland socket and per-Bot config/state/cache profile.
- [ ] The active application fills the usable output appropriately, and transient dialogs remain visible, focused, capturable, and controllable.
- [ ] The existing output-bound virtual pointer/keyboard helper reaches ready state and supports motion, buttons, scroll, key transitions, and one-way paste on Cage.
- [ ] Fresh snapshot capture returns the Cage Bot Screen's pixels and never captures the Shared Screen.
- [ ] Runtime readiness requires the Cage socket, output, committed Bot Desktop surface, input helper, and computer worker.
- [ ] Nested Hyprland remains the production default in this ticket; Cage is selectable for the real smoke and subsequent lifecycle work without duplicating product-level APIs.
