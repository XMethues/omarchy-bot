# Hide single-screen input arbitration behind contextual takeover

_The physical Shared Screen phase is historical. [ADR 0009](./0009-adopt-sway-bot-desktops.md) now uses one private Bot Computer with routed Screen workspaces and an internally serialized shared seat; public authority remains Screen-scoped. The decision to hide lease/queue mechanics and show only contextual Takeover remains. Emergency Control is superseded by [ADR 0006](./0006-remove-emergency-control.md). The body below records the earlier Host Screen phase._

Until Bots have independent screens, all desktop input targets one stateful Omarchy compositor and must remain globally serialized by ComputerBroker. We decided to keep that arbitration internal: the Computer surface shows the screen and plain-language activity, while Take control and Return to Bot appear only during a human handoff. Lease holder, TTL, and queue depth are not product UI. Emergency control is not a permanent idle Sidebar affordance; it appears immediately while computer input is active and remains available after an emergency stop so the user can deliberately resume.

Independent per-Bot screens are the path to Grok-style parallel computer work. When they exist, arbitration can move from one global input seat to one coordinator per screen without changing the quiet user-facing model.
