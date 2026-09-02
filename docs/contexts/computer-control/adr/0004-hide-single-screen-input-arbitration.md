# Hide single-screen input arbitration behind contextual takeover

Until Bots have independent screens, all desktop input targets one stateful Omarchy compositor and must remain globally serialized by ComputerBroker. We decided to keep that arbitration internal: the normal Computer Sheet shows the screen and plain-language activity, while Take control and Return to Bot appear only during a human handoff; lease holder, TTL, queue depth, and permanent emergency controls are not product UI.

Independent per-Bot screens are the path to Grok-style parallel computer work. When they exist, arbitration can move from one global input seat to one coordinator per screen without changing the quiet user-facing model.
