# 06: Prove Cage isolation and lifecycle

**What to build:** Make multiple Cage Bot Screens satisfy the complete Bot-owned lifecycle contract. Users can run two independent desktops concurrently, recover one failed Screen without disturbing its sibling, restart the daemon safely, and permanently delete a Bot without leaving compositor, desktop, helper, worker, application, socket, profile, or runtime residue.

**Blocked by:** 05 / Launch a persistent Cage Bot Desktop.

**Status:** resolved

- [x] Two concurrent Cage Bot Screens display distinct pixels and maintain independent application state, focus, cursor, keyboard state, and per-Bot profiles.
- [x] Pointer motion, click, drag, scroll, keys, shortcuts, and paste addressed to Bot A do not affect Bot B or move/input the Shared Screen.
- [x] Different Surfaces operate concurrently while operations belonging to one Surface retain their existing serialization and Computer Broker authority rules.
- [x] Application failure leaves the owning Bot Desktop and Screen ready or reports an application-specific outcome rather than falsely reporting compositor death.
- [x] Bot Desktop, input-helper, computer-worker, capture-helper, encoder, and compositor failures each produce explicit Surface-scoped lifecycle outcomes and leave sibling Screens usable.
- [x] Daemon restart reconnects a valid supervised runtime or removes an invalid process tree and reprovisions at a fresh runtime generation.
- [x] Reprovision invalidates stale geometry, WebRTC media, controller epochs, queued input, and worker bindings before the Screen returns to ready.
- [x] Permanent Bot deletion cancels active work and removes the complete supervised process tree, private socket, runtime directory, Bot-owned profile, and persisted Surface relationship before returning success.
- [x] Repeated provision/destroy cycles allocate fresh Surface/runtime facts and leave no residual processes, sockets, files, or memory growth.
- [x] The real two-Screen platform smoke proves isolation with captures and visible input outcomes; lifecycle integration coverage verifies recovery and deletion through the existing manager boundary.

## Answer

Cage now supervises its compositor lifetime separately from the persistent Bot Desktop process, while launched applications remain owned by the Surface-bound computer-worker unit. Application exit and launch errors leave the Screen ready; Desktop, input-helper, computer-worker, and compositor exits retain distinct outcomes, fail only their owning Surface, close capture/input bindings, and reprovision at a fresh runtime generation. Manager recovery either reconnects an adapter-confirmed complete runtime or removes the old generation before provisioning another, and stale sources, capture streams, geometry/controller envelopes, queued input, and worker generations cannot cross that boundary.

Permanent deletion now awaits Screen Projection shutdown before destroying the runtime, then removes every Surface unit/process group, private Wayland socket and runtime tree, per-Bot profile, and persisted relationship before success. Lifecycle coverage exercises all fatal roles with an unaffected sibling, valid and invalid daemon restart, stale binding rejection, direct deletion, and repeated provision/destroy cycles. The opt-in real Cage smoke runs two concurrent Screens with distinct applications and private profiles, proves separate pixels/focus/cursor/keyboard behavior across pointer, click, drag, scroll, shortcut, paste, and held-key transitions, verifies the Shared Screen remains unchanged, closes applications without losing Screen readiness, repeats provisioning, and checks process, unit, runtime, socket, profile, and stale-source cleanup.
