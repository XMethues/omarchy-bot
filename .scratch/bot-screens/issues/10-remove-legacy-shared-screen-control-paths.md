# 10: Remove legacy Shared Screen control paths

**What to build:** Finish the clean cutover by deleting the obsolete global Shared Screen implementation and Emergency Control product paths once every caller uses Bot-owned Screens. The shipped system has one Computer model, no compatibility aliases, and no unscoped fallback capable of touching the physical desktop.

**Blocked by:** 09: Own Bot Screen lifecycle and recover failures.

**Status:** resolved

- [x] The singleton lease, singleton Computer Broker, singleton computer worker, global screenshot cache and unscoped Computer request/event paths are removed.
- [x] Emergency Control UI, API, protocol states, persistence and tests are removed; ordinary process termination remains an operational mechanism outside the Computer Surface.
- [x] Every production Agent, daemon, protocol, client and UI caller supplies and validates Bot/Surface context.
- [x] Obsolete Shared Screen queue, waiting, compatibility adapter, alias, migration scaffold and fallback code is deleted rather than deprecated.
- [x] User-visible Computer states use the accepted Bot Screen vocabulary and expose no PID, socket, lease, token, queue or generation details.
- [x] Tests that asserted the superseded global model are replaced by observable Bot Screen contracts, and the complete affected test suites remain green.

## Answer

The production Computer model now consists only of Surface-scoped `ComputerBroker`, `BotScreenManager`, worker/projection protocols, API routes, and web callers; the singleton Shared Screen and Emergency Control paths, persistence, aliases, and fallbacks are gone. Focused Computer, projection, lifecycle, Agent-tool, conformance, and browser suites exercise the replacement contracts, including mandatory Bot/Surface ownership and plain-language UI states without internal lease, socket, token, queue, or generation details.
