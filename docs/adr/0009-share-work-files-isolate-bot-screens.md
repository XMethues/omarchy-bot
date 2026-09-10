# Share work files and one Bot Computer across Bot Screens

Status: accepted on 2026-09-05; amended on 2026-09-08 to adopt one shared Bot Computer. Shared Workspace, Changes removal, shared Sway runtime, routed Screen workspaces, shared application state, and selected-view projection are implemented. Mandatory human Host Session acceptance remains open.

Omarchy Bot follows the teammate model: users create Bots backed by installed Agents, all Bots share work files, and each Bot retains a stable Bot Screen identity. The runtime is one private pure-headless Sway **Bot Computer**, not one compositor per Bot. Each active Bot Screen is a dedicated headless output and Sway workspace inside that computer. Applications use the Bot Computer's persistent home and XDG profile, including one browser profile, so files, Cookies, logins, and ordinary application state are available across Screens.

The shared compositor has one input seat and one global focus history. Bot Screen actions therefore acquire an internal runtime lease, focus the requesting Screen's workspace, complete the action atomically, and release the seat. Human Web Control retains that lease until authority is returned. This serializes cross-Screen input; it does not stop background applications, merge Bot/Thread identity, or change which Screen a window belongs to. Native Sway IPC routes newly opened windows to the requesting Screen and filters window observation by that Screen's workspace.

The Host Session remains separate. The Bot Computer uses private runtime, Wayland, Sway IPC, D-Bus, home, and XDG directories and never imports its environment into the host user manager. WayVNC remains an on-demand view-only projection; Computer Broker input is the only human mutation path.

Deleting a Bot removes its plugin records and targeted Screen runtime/workspace. It does not delete the Shared Workspace, Agent-owned Native Sessions, or the shared Bot Computer profile. When the last attached Screen stops, transient Bot Computer processes stop; the persistent profile remains for the next graphical activation.

## Authority and supersession

- [The product boundary](../workspace-redesign.md#shared-workspace-and-plugin-boundary) defines directory and lifecycle ownership.
- [Computer ADR 0009](../contexts/computer-control/adr/0009-adopt-sway-bot-desktops.md) defines the shared Sway runtime, projection, routing, and input policy. It supersedes the per-Bot compositor and independent-seat portions of Computer ADRs 0007 and 0008.
- [Bot deletion ADR 0006](./0006-bot-deletion-is-local-only.md) remains in force. Shared work and shared application-profile state are outside one Bot's deletion boundary.
- The Changes capability and daemon-cwd fallback in [the capability-panel spec](../../.scratch/workspace-capability-panel/spec.md) remain superseded.
