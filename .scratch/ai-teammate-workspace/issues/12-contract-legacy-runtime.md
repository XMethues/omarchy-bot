# 12: Contract the legacy runtime model

**What to build:** Complete the expand-contract migration by deleting obsolete Agent-as-Bot, Role, Task-dashboard, permission-policy, and engineering-panel paths after all replacement behaviors are live, while conservatively retaining every user-created or ambiguous Bot row.

**Blocked by:** 03: Steer active Bot work; 04: Navigate Thread history and preserve window drafts; 05: Send and revisit managed attachments; 06: Dictate with Voxtype; 07: Edit Bot Profiles and avatars; 08: Archive and restore Bots safely; 09: Surface background attention in the Sidebar; 10: Replace the Computer console with contextual control; 11: Permanently delete Bot-owned data

**Status:** resolved

- [x] No public DTO, command, route, or UI surface aliases Bot identity to Agent identity.
- [x] Role and permission-policy fields and endpoints are absent from the active product contract.
- [x] The omarchy-bot Agent permission module and Pi permission extension are removed rather than left dormant.
- [x] Task-dashboard and approval UI/API paths are removed; the active public model uses Thread turn/activity semantics.
- [x] Obsolete database tables and columns are removed after the provenance-aware cutover, with no legacy dual-read path.
- [x] Old Wizard, manifest, dashboard, Computer-console, and compatibility components have no remaining imports or generated assets.
- [x] Retired database structures are removed after provenance-aware migration: enabled Agent inventory never becomes a Bot, only proven `legacy_inventory` rows are removed, and ambiguous or user-owned rows survive without a dual-read path.
- [x] A representative legacy database migrates once, boots repeatedly, and exposes only the current model.
- [x] Documentation, comments, generated contracts, and README contain no stale old-model instructions.

## Answer

Removed the approval/permission-policy/settings/public-abort contracts and implementation, deleted obsolete modules, separated Agent event identity, and reduced Computer replay to contextual state. Forward migration repairs already-migrated databases, records `user_created`, `legacy_conversation`, or `legacy_inventory` provenance, removes only proven inventory, and preserves ambiguous and user-owned Bots with their related data.
