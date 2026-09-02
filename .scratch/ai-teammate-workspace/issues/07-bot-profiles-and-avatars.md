# 07: Edit Bot Profiles and avatars

**What to build:** Let users evolve a Bot's name, Instructions, and visual identity using deterministic DiceBear avatars, safe local uploads, or prompt-authored Avatar Recipes, while keeping its Agent reference fixed.

**Blocked by:** 02: Chat through a user-created Bot

**Status:** ready-for-agent

- [ ] New Bots receive deterministic generated avatars without requiring another creation field.
- [ ] Profile editing updates name and Instructions but cannot replace the Bot's Agent.
- [ ] Updated Instructions apply to every future turn for that Bot while existing messages remain unchanged.
- [ ] Users can choose another generated variation or upload a custom image.
- [ ] Uploaded images are decoded, safely re-encoded, and stored locally rather than served from arbitrary remote URLs.
- [ ] A visual prompt invokes the Bot's Agent as a profile operation outside Thread history and returns constrained Avatar Recipe data.
- [ ] Invalid recipe output is rejected safely; Agent-authored SVG, HTML, and script are never rendered.
- [ ] Avatar Recipes retain renderer version, style, seed, and validated options for deterministic output.
- [ ] Selected, working, and streaming generated avatars animate subtly; uploaded avatars use an equivalent activity container.
- [ ] Reduced-motion mode replaces motion with a static state indicator.
- [ ] API integration, Agent-boundary tests, browser E2E, and visual regression cover editing, uploads, recipes, activity, and reduced motion.
