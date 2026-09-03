# Computer Control

The context for coordinating Bots and the user across Omarchy desktop surfaces.

## Language

**Shared Screen**:
The one real Omarchy compositor screen and physical input seat used by the user. It is distinct from Bot Screens and is not the target for parallel Bot desktop operation.
_Avoid_: Bot sandbox, Bot Screen, security boundary

**Screen Projection**:
The live mirror of a Bot Screen into the Computer Surface. It presents that Screen's current state rather than creating or sharing the user's physical desktop.
_Avoid_: Shared Screen, desktop clone

**Computer Surface**:
The web interface through which the user observes a selected Bot's Bot Screen and enters Web Control.
_Avoid_: Computer, Bot Screen, machine view

**Computer Preview**:
The read-only compact view of a Bot Screen in the Computer Surface. It never accepts user input.
_Avoid_: Web Control, miniature computer

**Web Control**:
Human control of a Bot Screen through the Computer Surface, distinct from the owning Bot's automated input.
_Avoid_: Bot control, Shared Screen control

**Computer Broker**:
The internal coordinator that prevents a Bot and the user from interleaving input on one Bot Screen. Each Bot Screen is coordinated independently; the Broker does not grant, remove, or approve Agent capabilities.
_Avoid_: Global input queue, permission manager, visible lease panel

**Takeover**:
A contextual handoff of one Bot Screen from its Bot to the user, either because the Bot needs human input or the user chooses to intervene. It returns control after that Screen is observed again.
_Avoid_: Permanent human lease, general approval

**Bot Screen**:
A persistent independent visual and input surface assigned to one Bot while sharing intended machine resources. Different Bot Screens permit parallel desktop operation.
_Avoid_: Agent Screen, Hyprland workspace, Shared Screen
