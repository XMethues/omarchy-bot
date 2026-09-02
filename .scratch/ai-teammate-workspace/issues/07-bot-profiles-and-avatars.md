# 07: Edit Bot Profiles and avatars

**What to build:** Let users evolve a Bot's name, Instructions, and visual identity using deterministic DiceBear avatars, safe local uploads, or prompt-authored Avatar Recipes, while keeping its Agent reference fixed.

**Blocked by:** 02: Chat through a user-created Bot

**Status:** resolved

- [x] New Bots receive deterministic generated avatars without requiring another creation field.
- [x] Profile editing updates name and Instructions but cannot replace the Bot's Agent.
- [x] Updated Instructions apply to every future turn for that Bot while existing messages remain unchanged.
- [x] Users can choose another generated variation or upload a custom image.
- [x] Uploaded images are decoded, safely re-encoded, and stored locally rather than served from arbitrary remote URLs.
- [x] A visual prompt invokes the Bot's Agent as a profile operation outside Thread history and returns constrained Avatar Recipe data.
- [x] Invalid recipe output is rejected safely; Agent-authored SVG, HTML, and script are never rendered.
- [x] Avatar Recipes retain renderer version, style, seed, and validated options for deterministic output.
- [x] Selected, working, and streaming generated avatars animate subtly; uploaded avatars use an equivalent activity container.
- [x] Reduced-motion mode replaces motion with a static state indicator.
- [x] API integration, Agent-boundary tests, browser E2E, and visual regression cover editing, uploads, recipes, activity, and reduced motion.

## Answer

Implemented editable Bot names and Instructions with immutable Agent identity, deterministic DiceBear recipes pinned to renderer version `9.4.3`, safe local image decode/crop/re-encode through Sharp, and isolated Agent-authored recipe generation outside Thread history. Recipe parsing admits only three pinned local styles and their allow-listed options; markup, scripts, data URLs, and remote URLs are rejected.

The shared profile dialog supports save, deterministic variation, upload, and prompt recipes. Sidebar, header, transcript, and streaming avatars expose selected/working/streaming activity without moving transcript content; reduced motion disables animation while preserving a visible status indicator.

Validated with `bun run typecheck`, focused profile/avatar integration tests, the complete 39-test integration suite, a production web build, and all four profile/avatar Playwright scenarios including a stable masked visual-regression baseline.
