# ComputerBroker executes desktop actions through the computer-use-linux MCP server, not bespoke input code

The Computer security boundary requires that only `computer-worker` touches real desktop input, and that all nine Bots see one identical tool surface (observe, screenshot, windows, click/type/key/scroll). We decided `workers/computer` is an MCP **client** that spawns the official `@agent-sh/computer-use-linux` stdio MCP server as its backend, adding only the small actions that server lacks (open app/URL, desktop notifications) natively.

Considered options:

- **Reimplement input/screenshot directly** on ydotool/wtype/grim/hyprctl — full control, but duplicates a maintained upstream tool bridge and risks drifting from the tool surface the docs mandate.
- **Reuse its pi extension** — couples the computer backend to one Agent's extension format.

The MCP server keeps the lease/permission logic (daemon) separate from input mechanics (worker), matches `design.md` §5.1 "优先以 MCP 暴露", and gives a clean seam if the backend is ever swapped. Lease enforcement, approval gating and emergency stop stay in the daemon/ComputerBroker regardless of backend.

Consequence: `computer-worker` availability depends on the upstream binary; it is probed like an Agent and the Computer panel degrades to observation-only if missing.
