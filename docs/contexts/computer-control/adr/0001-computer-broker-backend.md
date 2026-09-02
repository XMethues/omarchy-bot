# ComputerBroker executes desktop actions through the computer-use-linux MCP server, not bespoke input code

The Computer boundary requires that only `computer-worker` touches real desktop input, and that every Agent adapter sees one consistent tool surface (observe, screenshot, windows, click/type/key/scroll). We decided `workers/computer` is an MCP **client** that spawns the official `@agent-sh/computer-use-linux` stdio MCP server as its backend, adding only the small actions that server lacks (open app/URL, desktop notifications) natively.

Considered options:

- **Reimplement input/screenshot directly** on ydotool/wtype/grim/hyprctl — full control, but duplicates a maintained upstream tool bridge and risks drifting from the tool surface the docs mandate.
- **Reuse its pi extension** — couples the computer backend to one Agent's extension format.

The MCP server keeps input coordination in the daemon separate from input mechanics in the worker and gives a clean seam if the backend is ever swapped. Shared-screen arbitration and emergency stop stay in the daemon/ComputerBroker regardless of backend; they prevent interleaved input and do not add an Agent permission layer.

Consequence: `computer-worker` availability depends on the upstream binary; it is probed like an Agent and the Computer panel degrades to observation-only if missing.
