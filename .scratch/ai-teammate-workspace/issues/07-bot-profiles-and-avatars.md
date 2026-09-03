# 07: Edit Bot Profiles and avatars

**What to build:** Let users evolve a Bot's name, Instructions, and visual identity using deterministic DiceBear avatars, safe local uploads, or prompt-authored Avatar Recipes, while keeping its Agent reference fixed.

**Blocked by:** 02: Chat through a user-created Bot

**Status:** resolved

- [x] New Bots receive deterministic generated avatars without requiring another creation field.
- [x] The combined Bot avatar and name in the conversation Header opens a right-side Astryx `LayoutPanel` at every window width; it identifies the immutable Agent as read-only context while allowing name and Instructions updates.
- [x] Updated Instructions apply to every future turn for that Bot while existing messages remain unchanged.
- [x] Users can choose another generated variation or upload a custom image.
- [x] Uploaded images are decoded, safely re-encoded, and stored locally rather than served from arbitrary remote URLs.
- [x] A visual prompt invokes the Bot's Agent as a profile operation outside Thread history and returns constrained Avatar Recipe data.
- [x] Invalid recipe output is rejected safely; Agent-authored SVG, HTML, and script are never rendered.
- [x] Avatar Recipes retain the current renderer id, style, seed, and validated options. The application supports only `dicebear-core@10.7.0+styles@10.6.0`; unsupported persisted recipes migrate to deterministic current defaults.
- [x] Selected, working, and streaming current generated avatars use native DiceBear `animationVariant`; uploaded avatars use an equivalent activity container.
- [x] Reduced-motion mode replaces motion with a static state indicator, and meaningful Bot avatars have labels derived from the Bot name.

## Answer

Implemented editable Bot names and Instructions with visible immutable Agent identity, safe local image decode/crop/re-encode, and isolated Agent-authored recipe generation outside Thread history. Recipe parsing admits only supported options; markup, scripts, data URLs, and remote URLs are rejected.

Current recipes use the sole supported renderer id `dicebear-core@10.7.0+styles@10.6.0` and DiceBear's native `animationVariant`. Unsupported persisted recipes are replaced with deterministic current defaults during migration; no legacy renderer ships in the browser bundle. Generated and uploaded paths settle when idle, respect reduced motion, and expose meaningful accessible avatar labels.
