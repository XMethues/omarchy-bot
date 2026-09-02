# Preserve native Agent capabilities and approvals

Omarchy Bot passes through each Agent's native capabilities and approval behavior instead of adding a separate `ask`/`trusted` policy, filtering tools, or generating capability contracts. The current milestone should let an Agent do exactly what it can already do in the user's Omarchy Linux environment; Omarchy Bot coordinates Bots and presents their native events rather than becoming another authorization layer.

Consequences: the existing Agent tool permission gate and per-Bot permission policy must be removed from the target design, while multi-Bot desktop coordination remains a separate decision because it prevents concurrent input rather than changing an Agent's capabilities.

Each adapter maintains a tested inventory of the native capabilities exposed by its Agent version. The inventory is descriptive metadata derived from the Agent's official interface and conformance probes, not an omarchy-bot permission manifest or allowlist. Contextual UI actions such as session rename, delete, fork, compact, and steer follow that inventory and call the Agent's own operation. Unsupported native operations are not simulated, and Agent-specific behavior is decided while implementing and testing that adapter rather than through hypothetical product prompts.
