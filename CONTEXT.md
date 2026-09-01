# omarchy-bot

Nine coding agents become nine long-lived, multi-role Bots that share the user's Omarchy Linux machine as one Computer. This is the glossary for the product language. Design details live in `docs/`; this file is vocabulary only.

## Identity

**Agent**:
One of the nine coding-agent runtimes (Pi, OMP, Codex, Claude, Grok, OpenCode, Gemini, Copilot, Crush) and its official rich interface.
_Avoid_: backend, provider, model

**Bot**:
A persistent, multi-role actor backed by exactly one Agent (`BotId === AgentId`). The unit users see and talk to.
_Avoid_: adapter, assistant, workspace

**Role**:
A persistent persona under one Bot with its own instructions, memory, routine and default workspace. A Role never adds a new runtime type.
_Avoid_: persona instance, subagent, profile

**Actor**:
A Bot+Role pair (`ActorRef`) — the only thing that owns work, leases or messages.

## Conversation & work

**Thread**:
A conversation. `direct` = user + one Bot role; `channel` = user + any roles. The unit messages live in.

**Task**:
A unit of work with a status and an owner (Actor). Chat messages are not work state; Tasks are.

**Run**:
One execution attempt of a Task by one Actor on one native session. Has exactly one terminal state.

**Native session**:
The Agent's own persisted conversation. The authority for model context; omarchy-bot only stores the Role↔session mapping.
_Avoid_: transcript copy, history backup

**Routine**:
A scheduled prompt run by an Actor with dedup and a missed-run policy. Not a reminder alias.

**Handoff**:
A gateway-coordinated delegation of a Task from one Actor to another, with summary and artifacts.

**Conformance**:
The versioned test suite an Agent must pass before its Bot may become `ready`. Failure means `incompatible`, never a degraded path.

## Shared Computer

**Computer**:
The user's running Omarchy system — desktop, browser, terminal, files — shared by all Bots and the user.

**ComputerBroker**:
The daemon component that grants, renews and revokes Computer leases and proxies every desktop action. The only path to raw desktop input.

**Lease**:
The single, globally exclusive permission to send desktop input, held by one Actor or `human`. Read-only observation is not lease-gated.

**Take over**:
User action: stop bot input, transfer the Lease to `human`, park the Run in `waiting_for_input`.

**I'm done**:
User action: hand the Computer back; the Run re-observes before continuing and never assumes the screen is unchanged.

**Emergency stop**:
Kill all pending desktop input and revoke every Lease immediately.

## Permissions

**Permission policy**:
`ask` (side effects need web approval) or `trusted` (agent's own policy). No `auto`/`yolo` mode exists.

**Action needed**:
An approval card — agent tool or Computer action — that blocks until decided, including sensitive actions under `trusted`.

**Fail closed**:
Disconnection, timeout or restart resolves pending approvals as not-granted.
