# Bot-to-bot in-app mailbox

Status: resolved

## Problem Statement

Omarchy Bot users can create several Bots with distinct identities and Jobs, including several Bots backed by the same Agent, but those Bots cannot currently hand work to one another. A Bot can only respond inside its own user-driven Thread. There is no durable, attributable, human-visible way for one Bot to address another Bot, return immediately, and let the target run later with its own instructions and only the delivered message.

Without this capability, users must manually copy messages between Bots. Any hidden backchannel would make work unauditable, and treating the feature as synchronous RPC would couple two Turns, expose private conversation state, and conflict with the product’s local-first Thread and Agent boundaries.

## Solution

Add a local, asynchronous Bot mailbox built on the existing Bot, Thread, Message, Turn, attention, and Agent-worker concepts.

A source Bot sends text to a distinct target Bot by stable Bot ID through a native Agent tool. The daemon validates and durably enqueues the delivery, creates a target-owned user-visible Thread containing an attributed peer-mail Message, updates target attention, and immediately acknowledges the source without waiting for a target response. The target later starts one fresh Turn with its current Instructions and only the delivered envelope. Its ordinary output appears in that target-owned Thread. A reply is a separate delivery in the opposite direction.

The mailbox remains an in-application localhost feature. It is not A2A, RPC, shared memory, or a second conversation system.

## User Stories

1. As an Omarchy user, I want one Bot to send a text message to another Bot by stable Bot ID, so that my teammates can hand work to one another without manual copying.
2. As a source Bot, I want the daemon to derive my identity from my active Turn, so that I cannot impersonate another Bot through tool arguments.
3. As a source Bot, I want a successful send to return a delivery acknowledgement promptly, so that I do not wait for the target Bot’s response.
4. As an Omarchy user, I want the source Turn to receive no synchronous target result, so that Bot mail remains asynchronous rather than becoming RPC.
5. As a target Bot, I want inbound mail to start a new Turn, so that peer work does not mutate an unrelated active conversation.
6. As a target Bot, I want that Turn to use my current Instructions, Agent, model selection, and effective working directory, so that I continue operating as the same teammate.
7. As a privacy-conscious user, I want the target Bot to receive only the sender identity and delivered body, so that the source Thread, Native Session, attachments, and memory remain private.
8. As an Omarchy user, I want each delivery represented by a target-owned Thread, so that I can inspect the complete inbound message and resulting target output.
9. As an Omarchy user, I want the inbound Message to display the source Bot’s name, so that the exchange is understandable without exposing implementation identifiers as the primary label.
10. As an Omarchy user, I want the source Bot’s name snapshotted at send time, so that historical attribution remains truthful after a rename or deletion.
11. As an Omarchy user, I want ordinary system notes to retain their current presentation, so that peer mail does not blur unrelated system communication.
12. As an Omarchy user, I want the target Bot to gain unread attention when mail arrives, so that delegated work is discoverable from the Sidebar.
13. As an Omarchy user, I want opening the target’s unread Thread to follow existing unread-clearing rules, so that mail does not introduce a second attention model.
14. As an Omarchy user, I want a target response to use the existing ordered transcript records, so that Thinking, Tool Calls, Events, Responses, and failures remain inspectable in the normal way.
15. As an Omarchy user, I want a reply to be another explicit send in the opposite direction, so that causality stays visible and neither Bot gains shared hidden state.
16. As an Omarchy user, I want two Bots backed by the same Agent to remain distinct senders and targets, so that Bot identity is never confused with Agent identity.
17. As an Omarchy user, I want mail persisted before the source receives success, so that an acknowledged delivery survives a daemon restart.
18. As an Omarchy user, I want a duplicate retry of the same source Tool Call to return the original delivery acknowledgement, so that network or worker retries do not create duplicate Threads or Turns.
19. As an Omarchy user, I want mail to remain queued while the target Agent is unavailable, so that temporary readiness failures do not silently lose work.
20. As an Omarchy user, I want queued mail dispatched when the target Agent becomes ready, so that recovery does not require manual polling or resubmission.
21. As an Omarchy user, I want queued mail reconciled when the daemon starts, so that persisted work resumes after an application restart.
22. As an Omarchy user, I want a delivery claimed by only one dispatcher, so that concurrent readiness and startup events cannot start duplicate target Turns.
23. As an Omarchy user, I want a failure after a target Turn has been created to remain one visible failed Turn rather than being replayed into another Turn, so that uncertain external execution is never duplicated automatically.
24. As an Omarchy user, I want Bots to remain active mailbox identities until direct permanent deletion, so that mail does not reintroduce a hidden lifecycle state.
25. As a source Bot, I want a send to a target whose permanent deletion is in progress rejected clearly, so that no new work enters a teardown boundary.
26. As an Omarchy user, I want deleting the target Bot to remove its queued deliveries and target-owned exchange Threads, so that permanent deletion remains complete.
27. As an Omarchy user, I want deleting the source Bot to preserve already-delivered target history with a name snapshot, so that another Bot’s transcript is not silently rewritten.
28. As a source Bot, I want sends to a missing, deleting, or identical target rejected with a bounded safe error, so that invalid delegation is explicit.
30. As an Omarchy user, I want peer mail limited to bounded text in v1, so that the feature cannot bypass managed-attachment ownership and storage rules.
31. As an Omarchy user, I want the daemon to remain bound to localhost, so that enabling Bot mail does not create a network discovery or public messaging service.
32. As an Omarchy user, I want no new approval gate added around the Agent’s native tool behavior, so that Agent capability policy remains owned by the Agent adapter.
33. As an Agent adapter author, I want Bot-mail support advertised only when the adapter can expose the custom tool honestly, so that unsupported Agents do not present false capabilities.
34. As an Omarchy user, I want delivery failures represented in the visible exchange or existing Turn failure UI, so that recovery is understandable without daemon diagnostics.
35. As an Omarchy user, I want ordinary Thread history navigation to include peer-mail Threads, so that the mailbox does not require a hidden secondary inbox.
36. As an Omarchy user, I want active work in another target Thread left unsteered and unaborted, so that mail cannot corrupt unrelated in-flight work.
37. As an Omarchy user, I want the mailbox documented with a concrete 1:1 example, so that I can understand how to try it and how asynchronous replies appear.

## Implementation Decisions

- Addressing uses stable Bot identity. Agent identity is never a mailbox address because several Bots may reference the same Agent.
- One delivery creates one target-owned, user-visible system Thread. V1 does not make existing conversational Threads multi-owner and does not create a shared two-party Native Session.
- The inbound record is a system text Message with a typed peer-mail payload containing delivery identity, optional live source Bot identity, and an immutable source-name snapshot. Agent-generated Bot text remains represented by ordered transcript records rather than text Messages.
- Every target delivery uses a fresh Native Session. It receives the target Bot’s current Instructions and one daemon-authored envelope containing the sender attribution and body. It receives no source transcript, Native Session, memory, or attachment path.
- The Agent tool is named `send_bot_message` and accepts only target Bot ID and bounded text. Source Bot ID, source Turn ID, worker session identity, and Tool Call identity are derived from the authenticated active Turn context.
- A successful tool result contains only a delivery ID and queue acknowledgement. The target’s later output is never returned through that Tool Call.
- The tool description instructs the source Agent to conclude its response after a successful send. The daemon does not abort the source Turn and does not invent a false completed state if an Agent continues generating after tool success.
- The daemon owns a dedicated durable delivery state machine because the event log is a replay surface, not a claim/retry queue. Delivery state is `queued`, `dispatching`, `delivered`, or `failed`.
- Enqueue validation, target Thread creation, inbound Message insertion, delivery insertion, and target attention update commit atomically before success is acknowledged.
- Source Turn ID plus source Tool Call ID is the idempotency key. Repeating the same request returns the existing delivery and never creates another visible exchange.
- Enqueue completion, Agent readiness transitions, and daemon startup may request dispatch, but only one claimant can advance a delivery.
- A target Agent that is not ready leaves the delivery queued. This is event-driven retry, not a continuous busy poll.
- The target Turn identity is persisted before the external worker send. Once a target Turn exists, reconciliation never creates another automatic Turn for the same delivery.
- A worker acknowledgement of `message.send` marks the delivery delivered. Later Agent output, completion, cancellation, or failure remains ordinary target Turn state and does not change delivery into synchronous request/response state.
- Startup reconciliation resets a `dispatching` row without a target Turn to `queued`. A `dispatching` row with an existing target Turn follows startup Turn recovery and becomes an explicit failed delivery if worker acceptance cannot be proven; it is not replayed automatically.
- Non-retryable validation, protocol, or worker-start failures become `failed` with a bounded safe reason. Internal diagnostics remain in daemon logs/events rather than the public payload.
- A Bot remains an active mailbox identity until direct permanent deletion begins. The deletion claim rejects concurrent new sends, and target deletion cascades target-owned deliveries and exchange Threads.
- Source deletion nulls the live source reference but preserves the source-name snapshot. It does not delete another Bot’s target-owned transcript.
- Self-send, group send, and attachments are rejected in v1. Attachment support requires a future managed-ownership transfer contract rather than raw path reuse.
- Existing Thread/message read APIs expose the exchange. No public A2A endpoint, Agent Card, JSON-RPC method, remote discovery mechanism, or non-local listener is introduced.
- Existing Thread, Message, Turn, and Bot-attention events remain the browser invalidation mechanism. There is no hidden mailbox-only transcript stream.
- Target attention uses the existing unread count, recency, preview, and unread Thread rules. The preview identifies the peer message without exposing its internal delivery state.
- The mailbox orchestration is a focused daemon service responsible for enqueue, idempotency, claim, reconciliation, dispatch, deletion interaction, and attention. Thread storage remains responsible for Thread and Message persistence rather than absorbing queue policy.
- Worker supervision routes Bot-mail requests through a dedicated bounded reverse-request handler. It reuses the Computer request’s authoritative Turn-context validation pattern but does not overload Computer concepts.
- Pi exposes the custom tool beside its existing custom Computer tool. Other adapters expose it only when they implement the same contract.
- The feature must add an Agent Integration/domain ADR before product code, recording the target-owned Thread choice, privacy boundary, delivery state semantics, crash boundary, and deliberate non-RPC behavior.

## Testing Decisions

- Tests defend observable contracts: durable acknowledgement, exactly one visible exchange, privacy of target input, correct attention, restart behavior, deletion behavior, and ordinary transcript output. They do not assert private method calls, SQL statement ordering, internal class structure, or rendered CSS selectors.
- The primary and highest-value seam is the existing daemon integration harness with fake Agent workers. A test drives a Turn-bound worker Bot-mail request through worker supervision and the mailbox service, then observes the public Bot, Thread, Message, Turn, and attention APIs. This single seam covers persistence, protocol validation, dispatch, target input, and user visibility.
- Primary integration scenarios cover commit-before-ack, non-blocking source acknowledgement, unavailable target queuing, readiness dispatch, daemon restart between enqueue and dispatch, duplicate Tool Call idempotency, same-Agent/different-Bot identity, and exactly one target Turn.
- Fake-worker observations assert that the target receives its own Instructions plus one mail envelope and never receives the source transcript, Native Session, memory, or attachment material.
- Restart scenarios cover queued recovery, orphaned claim recovery, and the uncertain dispatch boundary. An existing target Turn is never duplicated after restart; an unprovable worker acceptance becomes a visible failure.
- Lifecycle integration scenarios cover direct target deletion, source deletion attribution preservation, self-send rejection, invalid addressing, and enqueue/deletion races.
- Public API assertions confirm that inbound peer mail and target ordered output appear through existing Thread/message APIs and that ordinary system Messages remain unchanged.
- Attention integration coverage follows the existing Sidebar-attention prior art: inbound mail updates unread state and points navigation to the target-owned exchange Thread; visibility clears attention only under existing rules.
- Worker conformance coverage follows the existing Pi Computer-tool prior art: schema validation, immutable Turn-context binding, bounded success/error results, cancellation cleanup if supported, and honest adapter capability behavior.
- One browser end-to-end scenario covers the remaining UI-specific contract: visible `From <Bot name>` treatment, ordinary History navigation, unread navigation, sender-deleted attribution, and accessible light/dark rendering. It does not duplicate queue-state permutations already proven at the daemon seam.
- Existing daemon restart, native Tool Call interruption, Sidebar attention, Bot lifecycle, ordered transcript, and Pi custom-tool suites are the prior art for this coverage.
- README verification is behavioral documentation review: the documented 1:1 flow must match the tool name, asynchronous acknowledgement, target-owned Thread, and reply-as-new-send semantics.

## Out of Scope

- Public or cross-vendor A2A interoperability, Agent Cards, JSON-RPC, service discovery, or remote network listeners.
- Synchronous Bot RPC, waiting for a target response inside the source Tool Call, or returning target output to the source Turn.
- Shared memory, transcript sharing, Native Session sharing, or hidden Bot backchannels.
- Group messages, broadcast, routing rules, priorities, scheduled delivery, mailbox search, or a separate inbox information architecture.
- Attachments, raw filesystem paths, or managed-attachment ownership transfer.
- Multi-owner conversational Threads or a unified two-party transcript.
- Automatically retrying a delivery after an uncertain external dispatch once a target Turn already exists.
- A generic forced-successful-Turn-completion protocol. Successful delivery must not be represented as cancellation.
- New product approval or trust policy around native Agent tools.
- Changes to the localhost listener policy or GitHub default branches.

## Further Notes

- Originating product request: GitHub Issue #2, “Bot-to-bot in-app mailbox (async, user-visible, not A2A).”
- The current domain intentionally models one Bot per Thread and no per-author Bot identity. This spec preserves that invariant by projecting inbound mail as typed system text in a target-owned Thread.
- Earlier schema history included broader Thread/message identity fields, but those were removed during the user-created Bot cutover. This feature must use a new explicit migration rather than revive abandoned columns implicitly.
- The event log remains the durable browser replay mechanism but is insufficient as the mailbox work queue because it has no atomic claim or retry state.
- “Deliver, then return” means the source receives no target result and daemon processing is decoupled. Pi does not currently expose a generic successful hard-stop operation after a tool result; the implementation must use tool guidance to conclude and must not fake completion by aborting the Turn.
