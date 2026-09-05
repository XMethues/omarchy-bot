# Deliver durable Bot mail into target-owned Threads

Status: accepted

Bots address peer mail by stable Bot ID, never by Agent identity. The daemon derives the source Bot from one authoritative active Turn and accepts a worker request only when its worker session, source Bot, source Turn, and native Tool Call identities all match that Turn. The native `send_bot_message` tool therefore exposes only a target Bot ID and bounded text. Multiple Bots using one Agent remain distinct principals, and no caller-supplied source identity is accepted.

Each accepted delivery creates one target-owned system Thread and one system text Message whose typed peer-mail projection carries the delivery ID, an optional live source Bot ID, and an immutable source-name snapshot. The target receives only this attributed body in later dispatch: source transcript, Native Session, memory, attachments, and filesystem paths do not cross the boundary. Ordinary system Messages keep their existing untyped presentation and existing Thread and Message APIs expose peer-mail history; there is no private transcript or mailbox-only conversation API.

The daemon owns a durable delivery state machine with `queued`, `dispatching`, `delivered`, and `failed` states. Enqueue validation, delivery persistence, target Thread creation, inbound Message insertion, and target unread attention commit in one SQLite transaction before the source is acknowledged. Source Turn ID plus source Tool Call ID is the idempotency key, so a retry returns the original delivery and cannot increment attention or duplicate visible history.

A successful send follows deliver-then-return semantics: it returns only the stable delivery ID and a queued acknowledgement, without waiting for target readiness, target execution, or target output. Dispatch later uses an atomic claim. A crash before the enqueue commit yields no success; a crash after commit leaves durable queued work. Once a target Turn is persisted, uncertain external acceptance is never retried into a second Turn. Replies are separate deliveries in the opposite direction, so Bot mail is asynchronous handoff rather than RPC or shared hidden conversation state.
