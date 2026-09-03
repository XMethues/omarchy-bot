# 09: Own Bot Screen lifecycle and recover failures

**What to build:** Make Bot lifecycle own every Bot Screen resource and expose isolated, recoverable failures. Direct deletion, daemon restart and process crashes produce explicit outcomes without orphaning runtime state or affecting another Bot; Agent-owned Native Sessions remain outside local deletion.

**Blocked by:** 08: Complete same-turn Takeover.

**Status:** resolved

- [x] Deleting an active Bot cancels and settles its active turns, then tears down compositor, worker, capture/input helper, media/controller state, sockets, runtime files, artifacts, coordination and persisted Surface data before removing the Bot row.
- [x] Bot Screen deletion remains local to Omarchy Bot and does not remove Agent-owned Native Sessions.
- [x] Daemon restart reconnects to valid supervised runtimes when possible or recreates them with a new runtime generation; in-memory pending tools fail honestly.
- [x] Compositor, helper, worker and media failures transition only the owning Surface to an explicit unavailable/failed state while other Bot Screens continue.
- [x] Every stale runtime, geometry and controller generation is rejected after recovery.
- [x] Repeated provision, direct deletion, fresh-Bot creation and crash cycles leave no orphan process, socket, unit, capture stream, held input or persistent coordination row.
- [x] Integration and real-platform lifecycle scenarios verify restart reconciliation, failure isolation and cleanup.

## Answer

`BotScreenManager` now owns restart reconciliation, isolated failure transitions, generation rollover, and awaited destruction of each Surface, with `HyprlandBotScreenRuntime` cleaning its supervised units, sockets, helpers, runtime tree and profile before direct Bot deletion commits. Focused lifecycle and permanent-deletion integration proves active-turn cancellation, reconnect/recreate behavior, stale-generation rejection, retryable cleanup failure, repeated delete/fresh-provision cycles, sibling isolation, and preservation of Agent-owned Native Sessions; the real Hyprland smoke proves complete removal of owned runtime and profile directories.
