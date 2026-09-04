# Preserve ordered Agent blocks instead of collapsed Activity

Status: accepted

Agent backends expose response, reasoning, and tool work as ordered blocks, but Omarchy Bot previously merged all Bot text at Turn completion and grouped Tool Calls with Native Events inside one product-owned Activity disclosure. We decided that every Agent Adapter will normalize native boundaries into ordered Response Blocks, Thinking Blocks, and Tool Calls with stable Adapter-generated block IDs. The daemon persists that common structure, while Native Events remain only the residual Agent-specific fidelity boundary after common semantics are removed.

The Thread renders user and Bot content with Astryx Markdown, uses Astryx `ChatToolCalls` directly for adjacent tools, and gives Thinking its own collapsed presentation. Per-Bot Display Settings hide Tool Calls and Thinking without changing receipt, persistence, retention, or Agent configuration. Native Events have no generic raw renderer; recurring cross-Agent concepts must gain an explicit product model before becoming Thread content.

This replaces the compact Activity decision in `docs/workspace-redesign.md` section 9 and stories 60–62 of `.scratch/ai-teammate-workspace/spec.md`. It preserves the separate meaning of Bot Activity and the existing rule that Response content drives conversation previews. The current development database may be rebuilt once for the new schema, but product code must not automatically delete data or establish destructive upgrade behavior.
