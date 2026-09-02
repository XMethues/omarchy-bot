# 03: Steer active Bot work

**What to build:** Let the user send another message while a Bot is working and redirect the same native Agent session at its next safe boundary, without aborting the turn, opening a replacement session, or exposing a permanent Stop control.

**Blocked by:** 02: Chat through a user-created Bot

**Status:** resolved

- [x] The Agent worker contract can represent native steering separately from normal send and abort.
- [x] Sending to an idle Thread starts a normal turn; sending to its active turn invokes the adapter's tested steering operation.
- [x] Pi uses its native steering API and retains the same native session and work context.
- [x] The steering user message appears in transcript order immediately and is correlated with the active turn.
- [x] Steering waits for the Agent's safe native boundary rather than interrupting an atomic tool action.
- [x] A failed or unavailable steer is reported inline without silently aborting and restarting.
- [x] The Composer stays available during work and contains no permanent Stop button.
- [x] Worker conformance and API integration tests distinguish send, steer, and explicit abort behavior.

## Answer

Implemented native active-turn steering end to end. `TurnService` persists and publishes the steering message before waiting for a newly opening worker session, sends `message.steer` through the existing worker session, records `messageId` on `turn.steered`, and reports rejected steering as a 409 plus an inline `steer unavailable` system message without changing the active turn. Explicit abort remains a separate cancellation path and retains its reason.

The Pi adapter accepts steering only for its currently running streaming turn and delegates exclusively to native `session.steer`. The fake Pi worker provides a deterministic atomic-action boundary: it acknowledges the steer, completes the active tool action, then applies the queued redirect. Focused integration coverage verifies idle send versus active steer, unchanged worker/native session IDs, immediate correlated transcript ordering, safe-boundary event order, rejected-steer continuation, and explicit abort. The real-Pi conformance flow includes a compiled native steering case but was not executed.

Validated with `bun run typecheck`, the focused steering tests, and the complete 39-test integration suite.
