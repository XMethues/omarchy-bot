# Computer Control

The context for coordinating Bots and the user across Omarchy desktop surfaces.

## Language

Definitions only. Rules and acceptance live in [Computer ADR 0008](adr/0008-run-cage-bot-desktops.md), [system ADR 0009](../../adr/0009-share-work-files-isolate-bot-screens.md), and [the current implementation specification](../../../.scratch/shared-workspace-desktop-boundary/spec.md). Related terms: [Bot](../workspace/CONTEXT.md), [Bot Client](../workspace/CONTEXT.md), [Agent](../agent-integration/CONTEXT.md), [Native Session](../agent-integration/CONTEXT.md), [Shared Workspace](../workspace/CONTEXT.md).

**Host Session**:
The user's original Omarchy graphical environment, including its desktop, top bar, shortcuts, and physical input. It is distinct from the graphical work surfaces provided to Bots.
_Avoid_: Bot Desktop Session, shared Bot desktop

**Shared Screen**:
The real screen and physical input seat of the Host Session. “Shared” is the historical name for the user's screen, not a screen all Bots should operate together.
_Avoid_: Bot sandbox, Bot Screen, security boundary

**Screen Projection**:
A viewing connection that mirrors one Bot Screen into a Computer Surface. It is distinct from the Bot's ongoing work and from the lifetime of its Bot Desktop Session.
_Avoid_: Shared Screen, desktop clone

**Computer Surface**:
The Bot Client interface through which the user observes a selected Bot's Bot Screen and enters Web Control.
_Avoid_: Computer, Bot Screen, machine view

**Computer Preview**:
The read-only compact view of a Bot Screen in the Computer Surface. It never accepts user input.
_Avoid_: Web Control, miniature computer

**Web Control**:
Human control of a Bot Screen through the Computer Surface, distinct from the owning Bot's automated input.
_Avoid_: Bot control, Shared Screen control

**Computer Broker**:
The internal coordinator that prevents a Bot and the user from interleaving input on one Bot Screen while unrelated Bot Screens operate independently. It is neither an Agent permission authority nor a coordinator for Shared Workspace files.
_Avoid_: Global input queue, file lock manager, task scheduler, permission manager, visible lease panel

**Takeover**:
A contextual handoff of one Bot Screen from its Bot to the user, either because the Bot needs human input or the user chooses to intervene. It returns control after that Screen is observed again.
_Avoid_: Permanent human lease, general approval

**Bot Screen**:
A Bot-owned visual and input surface with its own windows, focus, pointer, and keyboard state. Different Bot Screens permit parallel desktop operation while their Bots use the same Shared Workspace.
_Avoid_: Agent Screen, Hyprland workspace, Shared Screen, separate computer, security sandbox

**Bot Desktop Session**:
The running graphical environment serving one Bot Screen, distinct from an Agent's Native Session and a client's Screen Projection. Its existence is separate from the persistent identity of its owning Bot.
_Avoid_: Full Omarchy session, chat session, viewer connection

**Bot Desktop**:
The application surface hosted by a Bot Desktop Session. Closing an application leaves this surface available; viewing it does not confer ownership of the application's files or internal state on the plugin.
_Avoid_: Full Omarchy session, terminal placeholder, Shared Screen
