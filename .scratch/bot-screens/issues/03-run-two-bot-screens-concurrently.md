# 03: Run two Bot Screens concurrently

**What to build:** Allow two Bots—including two Bots backed by the same Agent—to operate independent Bot Screens at the same time. Each Surface has its own compositor, Computer Broker and computer worker, while turns belonging to one Bot still serialize against that Bot's Screen.

**Blocked by:** 02: Provision one real headless Bot Screen.

**Status:** resolved

- [x] Two ready Bots own distinct runtime directories, Wayland sockets, headless outputs, profiles, computer workers, Broker state, cached observations, and Surface-scoped lease rows.
- [x] Simultaneous observe and input operations on different Surfaces do not queue behind one another; concurrent turns for the same Surface remain serialized.
- [x] Distinct applications, pixels, focus, pointer and keyboard state remain isolated between both Bot Screens and from the physical Shared Screen.
- [x] A request carrying another Bot's Surface, lease, token, runtime generation, or worker context fails closed without dispatching input.
- [x] Failure or restart of one Surface's worker does not stop the other Surface's active operation.
- [x] Integration coverage with deterministic workers and a real Hyprland smoke scenario prove concurrent routing and isolation.

## Answer

`BotScreenManager` owns a runtime and worker per Surface while `ComputerBroker` serializes only within that Surface, and the worker protocol validates owner, generation, and input authority before dispatch. Focused Computer integration proves cross-Surface concurrency, same-Surface ordering, fail-closed context checks, and isolated worker failure; the two-Screen real Hyprland smoke proves distinct pixels and input without changing the sibling Screen or host pointer.
