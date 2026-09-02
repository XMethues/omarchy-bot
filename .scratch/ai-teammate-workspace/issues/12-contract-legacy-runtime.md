# 12: Contract the legacy runtime model

**What to build:** Complete the expand-contract migration by deleting every obsolete Agent-as-Bot, Role, Task-dashboard, permission-policy, and engineering-panel path after all replacement behaviors are live, leaving one coherent product model and one public contract.

**Blocked by:** 03: Steer active Bot work; 04: Navigate Thread history and preserve window drafts; 05: Send and revisit managed attachments; 06: Dictate with Voxtype; 07: Edit Bot Profiles and avatars; 08: Archive and restore Bots safely; 09: Surface background attention in the Sidebar; 10: Replace the Computer console with contextual control; 11: Permanently delete Bot-owned data

**Status:** ready-for-agent

- [ ] No public DTO, command, route, or UI surface aliases Bot identity to Agent identity.
- [ ] Role and permission-policy fields and endpoints are absent from the active product contract.
- [ ] The omarchy-bot Agent permission module and Pi permission extension are removed rather than left dormant.
- [ ] Task-dashboard and approval UI/API paths are removed; conversation turn/activity behavior remains green.
- [ ] Obsolete database tables and columns are removed after verified migration, with no legacy dual-read path.
- [ ] Old Wizard, manifest, dashboard, Computer-console, and compatibility components have no remaining imports or generated assets.
- [ ] Legacy tests are deleted or replaced by assertions against the accepted public behavior.
- [ ] A representative legacy database migrates once, boots repeatedly, and exposes only the current model.
- [ ] Documentation, comments, generated contracts, and README contain no stale old-model instructions.
- [ ] Typecheck, build, integration, conformance, and browser suites pass with the contracted model.
