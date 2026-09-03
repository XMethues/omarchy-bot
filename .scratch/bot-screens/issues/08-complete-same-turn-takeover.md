# 08: Complete same-turn Takeover

**What to build:** Let the user enter expanded Web Control while the selected Bot has a computer tool pending, safely Takeover that Bot Screen, and return control with “I'm done” so the exact same Agent turn continues from a fresh observation.

**Blocked by:** 06: Add keyboard, paste, and controller safety; 07: Bind Agent computer tools to the owning Bot Screen.

**Status:** resolved

- [x] Takeover is offered only for a Broker-owned pending computer tool and waits for any already-dispatched atomic desktop action to quiesce.
- [x] The exact Agent tool invocation remains pending while Web Control owns the Surface; Bot and user input cannot interleave.
- [x] “I'm done” revokes Web input, releases held state, captures a fresh screenshot and relevant window context, and resolves that invocation exactly once.
- [x] The owning Agent continues the same native turn from the fresh observation without requiring a new chat message.
- [x] Closing, navigating away or disconnecting leaves the tool waiting and never auto-resumes an incomplete human step.
- [x] Native Agent cancellation cancels the pending waiter; daemon or Agent-worker restart fails the affected turn honestly rather than pretending to resume it.
- [x] Browser E2E, daemon integration and Agent conformance coverage prove quiescence, exclusion, same-turn continuation, disconnect behavior and cancellation.

## Answer

`ComputerBroker` now holds the exact pending native tool call through quiescence and exclusive Web Control, and the return route revokes input, releases held state, captures a fresh observation, and settles that invocation once so the same turn continues. Focused daemon integration and Pi conformance prove same-call continuation, cancellation, and honest worker/daemon-loss failure, while the browser Computer-sheet scenario proves that close and reconnect leave the held tool pending until “I'm done.”
