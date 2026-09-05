# 02: Wake the target in an isolated Turn

**What to build:** Dispatch an accepted peer-mail delivery into one fresh target Bot Turn that uses the target’s current execution context, receives only the attributed mail envelope, and writes ordinary ordered output into the visible target-owned Thread without steering or aborting unrelated work.

**Blocked by:** 01: Send and display durable peer mail.

**Status:** resolved

- [x] A queued delivery for a ready target is atomically claimed and linked to exactly one persisted target Turn before the external worker send.
- [x] Dispatch opens a fresh Native Session rather than resuming an existing conversational session.
- [x] The target session uses the target Bot’s current Instructions, Agent, model selection, Computer Surface binding, and effective working directory.
- [x] The target worker receives one daemon-authored envelope containing only source attribution and body.
- [x] Fake-worker observations prove that source Thread history, source Native Session state, source memory, and attachments are absent.
- [x] The target’s Thinking, Tool Calls, Events, Responses, completion, cancellation, and failure use the existing ordered transcript and Turn lifecycle.
- [x] The worker’s accepted `message.send` acknowledgement marks the delivery delivered without waiting for target completion.
- [x] A later target Turn failure remains an ordinary visible failed Turn and does not become a synchronous result to the source.
- [x] Two Bots backed by the same Agent remain distinct source and target identities and use separate Native Sessions.
- [x] Active work in another target Thread is neither steered nor aborted by peer-mail dispatch.
- [x] Integration coverage proves the complete enqueue-to-target-output path through fake workers and public Thread/message APIs.

## Answer

The public mailbox Thread transcript is ordered `text`, `thinking`, `tool`, `event`, `response`. Public message DTOs do not expose a `turnId`; exact target Turn linkage is instead proven by the persisted Turn and worker-send observations. The transcript assertion now checks ordered public behavior while allowing normal DTO lifecycle fields such as block IDs and timestamps.

- `bun test tests/integration/bot-mailbox.test.ts` — 4 pass, 0 fail, 43 expect() calls; 4 tests across 1 file in 17.12s.
- `bun run typecheck` — passed (`tsc --noEmit`) in 4.41s.
