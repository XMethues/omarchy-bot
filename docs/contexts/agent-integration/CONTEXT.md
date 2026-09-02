# Agent Integration

The context for connecting supported coding-agent backends without reducing or overriding their native behavior.

## Language

**Agent**:
A supported execution backend such as Pi, Claude, or Codex that supplies a Bot's runtime capabilities. An Agent is selected when a Bot is created and is not itself shown as a user-created Bot.
_Avoid_: Bot, assistant, persona

**Agent Adapter**:
The isolated integration that translates between Omarchy Bot's worker protocol and one Agent's richest official SDK or protocol surface. It preserves native lifecycle, events, and controls.
_Avoid_: Bot implementation, PTY wrapper, capability filter

**Agent Capability**:
An operation the selected Agent can already perform in the user's Omarchy Linux environment. Omarchy Bot preserves the Agent's native capabilities and approval behavior rather than adding, removing, filtering, or independently approving them.
_Avoid_: Bot permission, provisioned capability

**Agent Capability Inventory**:
Versioned, tested metadata describing operations an Agent exposes through its official interface. Each adapter maintains its own inventory and the UI uses it to present native actions contextually; it is not a permission manifest or allowlist.
_Avoid_: Bot permission, capability gate
