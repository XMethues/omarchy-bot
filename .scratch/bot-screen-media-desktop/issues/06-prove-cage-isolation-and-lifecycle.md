# 06: Prove Cage isolation and lifecycle

**What to build:** Make multiple Cage Bot Screens satisfy the complete Bot-owned lifecycle contract. Users can run two independent desktops concurrently, recover one failed Screen without disturbing its sibling, restart the daemon safely, and permanently delete a Bot without leaving compositor, desktop, helper, worker, application, socket, profile, or runtime residue.

**Blocked by:** 05 / Launch a persistent Cage Bot Desktop.

**Status:** ready-for-agent

- [ ] Two concurrent Cage Bot Screens display distinct pixels and maintain independent application state, focus, cursor, keyboard state, and per-Bot profiles.
- [ ] Pointer motion, click, drag, scroll, keys, shortcuts, and paste addressed to Bot A do not affect Bot B or move/input the Shared Screen.
- [ ] Different Surfaces operate concurrently while operations belonging to one Surface retain their existing serialization and Computer Broker authority rules.
- [ ] Application failure leaves the owning Bot Desktop and Screen ready or reports an application-specific outcome rather than falsely reporting compositor death.
- [ ] Bot Desktop, input-helper, computer-worker, capture-helper, encoder, and compositor failures each produce explicit Surface-scoped lifecycle outcomes and leave sibling Screens usable.
- [ ] Daemon restart reconnects a valid supervised runtime or removes an invalid process tree and reprovisions at a fresh runtime generation.
- [ ] Reprovision invalidates stale geometry, WebRTC media, controller epochs, queued input, and worker bindings before the Screen returns to ready.
- [ ] Permanent Bot deletion cancels active work and removes the complete supervised process tree, private socket, runtime directory, Bot-owned profile, and persisted Surface relationship before returning success.
- [ ] Repeated provision/destroy cycles allocate fresh Surface/runtime facts and leave no residual processes, sockets, files, or memory growth.
- [ ] The real two-Screen platform smoke proves isolation with captures and visible input outcomes; lifecycle integration coverage verifies recovery and deletion through the existing manager boundary.
