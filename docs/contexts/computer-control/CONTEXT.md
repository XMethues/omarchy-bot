# Computer Control

The context for coordinating Bots and the user on the current Omarchy desktop.

## Language

**Shared Screen**:
The one real Omarchy compositor screen and input seat currently used by every Bot and the user. It permits observation by multiple participants but serializes input.
_Avoid_: Bot sandbox, independent workspace, security boundary

**Computer Broker**:
The internal coordinator that prevents Bot and human desktop input from interleaving on the Shared Screen. It coordinates access but does not grant, remove, or approve Agent capabilities.
_Avoid_: Permission manager, visible lease panel

**Takeover**:
A contextual handoff of the Shared Screen from a Bot to the user when human input is required. It appears only when relevant and returns control after the computer is observed again.
_Avoid_: Permanent human lease, general approval

**Bot Screen**:
A future independent visual and input surface assigned to one Bot while sharing intended machine resources. Genuine Bot Screens are required for parallel desktop operation; a Hyprland workspace alone is not a Bot Screen.
_Avoid_: Hyprland workspace, current Shared Screen
