# 07: Bind Agent computer tools to the owning Bot Screen

**What to build:** Give a Pi Agent turn an Omarchy-owned computer tool that observes and acts only on its Bot's Screen through that Surface's Computer Broker and worker. Agent desktop work becomes visible in the owning Bot's Computer Preview and cannot bypass Surface coordination.

**Blocked by:** 03: Run two Bot Screens concurrently.

**Status:** resolved

- [x] Computer tool registration is bound from authoritative Bot, turn, worker-session and tool-call context to exactly one Surface ID.
- [x] Observe and input actions pass through the owning Surface's sequential Computer Broker and assigned worker; no native Agent path can dispatch directly to the host or another Surface.
- [x] A real Pi turn can obtain an observation and perform a visible simple desktop action on its Bot Screen.
- [x] Two Bots can run Agent computer actions concurrently on different Surfaces, while actions for one Surface remain ordered.
- [x] Existing Agent-native approvals and capability inventory remain authoritative; Screen routing introduces no duplicate permission policy.
- [x] Cancellation, stale context, worker failure and mismatched Surface identity fail the affected tool/turn honestly without rerouting.
- [x] Agent conformance and daemon integration coverage prove the owning-Surface route and absence of the prior bypass.

## Answer

The Agent computer protocol carries immutable Bot, Surface, turn, worker-session, and tool-call identity through turn handling into `ComputerBroker.agentToolAct`, so observe and input use only the assigned Surface worker and retain the native capability policy. Pi conformance proves SDK tool-call binding and Broker-owned image delivery, while focused daemon integration proves visible public-turn actions, cross-Surface concurrency with per-Surface ordering, cancellation, worker failure, and fail-closed stale or mismatched context.
