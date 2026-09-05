# 01: Send and display durable peer mail

**What to build:** Let a source Bot use the native `send_bot_message` tool to persist bounded text for a distinct target Bot, receive an immediate idempotent acknowledgement, and create a target-owned visible Thread with attributed peer mail and unread attention. Record the mailbox architecture before implementation so the first tracer bullet fixes the identity, privacy, persistence, and non-RPC contract.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] An Agent Integration/domain ADR records Bot-ID addressing, target-owned system Threads, typed peer-mail Messages, the delivery state machine, privacy boundaries, crash boundaries, and deliver-then-return semantics.
- [x] The Pi Agent exposes `send_bot_message` with only target Bot ID and bounded text as user-controlled arguments.
- [x] The daemon accepts the worker request only when worker session, source Bot, source Turn, and Tool Call identity match one authoritative active Turn.
- [x] Source identity is derived from the active Turn and cannot be supplied or impersonated through tool arguments.
- [x] Enqueue atomically creates the delivery, target-owned Thread, inbound peer-mail Message, and target attention before returning success.
- [x] A successful tool result contains only a stable delivery ID and queue acknowledgement; it never waits for or returns target output.
- [x] Repeating the same source Turn and Tool Call request returns the existing delivery without creating another Thread, Message, or attention increment.
- [x] Existing Thread and Message APIs return the new exchange without introducing a mailbox-only transcript endpoint.
- [x] The web transcript renders the immutable source-name snapshot distinctly from ordinary system notes, and History can open the target-owned Thread.
- [x] The target Bot receives unread attention pointing at the peer-mail Thread under existing unread-clearing rules.
- [x] Focused integration coverage drives the request from a fake worker through the daemon and observes the public delivery, Thread, Message, and attention behavior.
- [x] A focused browser scenario proves visible sender attribution and unread navigation in both supported themes.

## Answer

Implemented the durable enqueue tracer bullet end to end: the Pi and fake-worker custom tool binds source identity to the active Turn, daemon supervision authenticates the reverse request, and one SQLite transaction commits the queued delivery, target-owned Thread, typed peer-mail Message, and unread attention before returning an idempotent acknowledgement. The existing Thread and Message APIs project the exchange, the transcript distinguishes snapshotted sender attribution from ordinary system notes, and Sidebar unread navigation opens the exchange without starting or dispatching a target Turn.

Validation:

- `bun test tests/integration/bot-mailbox.test.ts` — 2 passed, 0 failed, 16 assertions.
- `bun test tests/conformance/pi-bot-message-tool.test.ts` — 2 passed, 0 failed, 9 assertions.
- `bunx playwright test -c tests/e2e tests/e2e/specs/15-bot-mailbox.spec.ts` — 1 passed (Chromium; light and dark sender rendering, unread navigation, and History).
- `bun run typecheck` — passed with no TypeScript errors.

No formatter, linter, project-wide test suite, project-wide build, or commit was run.
