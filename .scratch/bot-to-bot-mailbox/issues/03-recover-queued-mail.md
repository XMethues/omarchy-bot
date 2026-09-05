# 03: Recover queued mail across readiness and restart

**What to build:** Keep accepted peer mail durable while its target Agent is unavailable, dispatch it when readiness returns, and reconcile interrupted queue claims after daemon restart without busy polling or creating duplicate target Turns.

**Blocked by:** 02: Wake the target in an isolated Turn.

**Status:** resolved

- [x] A delivery remains queued when the target Agent is not ready, while its visible Thread, Message, and unread attention remain available.
- [x] Enqueue completion, Agent readiness transitions, daemon startup, and eligible Bot restore trigger bounded event-driven dispatch attempts.
- [x] Concurrent triggers cannot claim or dispatch the same queued delivery more than once.
- [x] A daemon restart after source acknowledgement but before claim preserves the delivery and later starts exactly one target Turn.
- [x] Startup reconciliation resets a `dispatching` delivery with no linked target Turn to queued.
- [x] Once a target Turn identity exists, reconciliation never creates a second automatic Turn for that delivery.
- [x] A dispatch interrupted after target Turn creation but before provable worker acceptance becomes an explicit failed delivery and visible failed Turn rather than being replayed.
- [x] Retryable readiness failures remain queued; bounded non-retryable protocol or worker-start failures become failed with a safe reason.
- [x] Queue processing performs no continuous busy poll and does not add a second hidden event stream.
- [x] Integration tests cover restart before claim, orphaned claim recovery, simultaneous readiness/startup triggers, unavailable-to-ready transition, and the uncertain external-dispatch boundary.

## Answer

- `bun run typecheck` — passed (`tsc --noEmit`) in 4.71s.
- `bun test tests/integration/bot-mailbox.test.ts` — 10 pass, 0 fail, 64 expect() calls; 10 tests across 1 file in 49.06s.
