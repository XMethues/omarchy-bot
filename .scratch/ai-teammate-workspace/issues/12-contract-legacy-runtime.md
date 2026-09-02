# 12: Contract the legacy runtime model

**What to build:** Complete the expand-contract migration by deleting every obsolete Agent-as-Bot, Role, Task-dashboard, permission-policy, and engineering-panel path after all replacement behaviors are live, leaving one coherent product model and one public contract.

**Blocked by:** 03: Steer active Bot work; 04: Navigate Thread history and preserve window drafts; 05: Send and revisit managed attachments; 06: Dictate with Voxtype; 07: Edit Bot Profiles and avatars; 08: Archive and restore Bots safely; 09: Surface background attention in the Sidebar; 10: Replace the Computer console with contextual control; 11: Permanently delete Bot-owned data

**Status:** resolved

- [x] No public DTO, command, route, or UI surface aliases Bot identity to Agent identity.
- [x] Role and permission-policy fields and endpoints are absent from the active product contract.
- [x] The omarchy-bot Agent permission module and Pi permission extension are removed rather than left dormant.
- [x] Task-dashboard and approval UI/API paths are removed; conversation turn/activity behavior remains green.
- [x] Obsolete database tables and columns are removed after verified migration, with no legacy dual-read path.
- [x] Old Wizard, manifest, dashboard, Computer-console, and compatibility components have no remaining imports or generated assets.
- [x] Legacy tests are deleted or replaced by assertions against the accepted public behavior.
- [x] A representative legacy database migrates once, boots repeatedly, and exposes only the current model.
- [x] Documentation, comments, generated contracts, and README contain no stale old-model instructions.
- [x] Typecheck, build, integration, conformance, and browser suites pass with the contracted model.

## Answer

Removed the approval/permission-policy/settings/public-abort contracts and implementation, deleted obsolete modules, separated Agent event identity, reduced Computer replay to contextual state, and added forward migration `0004-contract-legacy-runtime` to settle blocked turns, rebuild current tables, drop retired storage, and establish a clean replay boundary.

Validated with `bun run typecheck`, 41 focused domain/runtime integration tests, 13 retained lifecycle tests, the real ten-step Pi conformance run, production build, and contracted chat/deletion Playwright scenarios. The final complete suites remain part of ticket 13 and repository finalization.
