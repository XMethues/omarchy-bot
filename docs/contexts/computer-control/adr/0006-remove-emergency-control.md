# Remove Emergency Control in favor of contextual handoff

The Computer Surface will remove the existing Emergency Control state and Sidebar Stop/Resume affordance. Deliberate interruption uses Takeover at a Broker-owned computer-tool boundary, and disconnects leave the affected Bot waiting rather than resuming it automatically.

This partially supersedes ADR 0001 and ADR 0004 where they require Emergency Control to remain in the Computer Broker and product UI. Consequence: the product no longer offers a separate fail-safe that can stop all future automated input independently of Takeover; an already dispatched or hung desktop action still requires operational recovery outside the Computer Surface.