# 02: Show transient Thread activity

**What to build:** Let users recognize live work through an independent Sidebar activity point and one temporary working avatar beneath the selected Thread's output, without retaining avatars beside historical Bot messages.

**Blocked by:** 01: Make Bot Activity binary

**Status:** resolved

- [x] The Sidebar shows an activity point if and only if any Thread belonging to the Bot is active.
- [x] Unread attention and selection styling remain independent from the activity point.
- [x] Generated Sidebar avatars retain DiceBear-native ambient motion independently of activity; uploaded Sidebar avatars may remain static.
- [x] Activity changes do not speed up or otherwise alter Sidebar ambient animation.
- [x] The conversation Header avatar remains static.
- [x] The selected Thread shows exactly one temporary working avatar after all current text, tool Activity, and other live output.
- [x] Work in another Thread affects the Sidebar point but never places a working avatar under the selected idle Thread.
- [x] Generated working avatars use DiceBear's working or streaming motion; uploaded working avatars use a restrained pulse.
- [x] The temporary working avatar has no redundant activity point.
- [x] Hover and keyboard focus reveal the Bot name and working state, and assistive technology receives equivalent start and end transitions.
- [x] Working and both waiting states preserve the temporary avatar; completion, cancellation, and failure remove it.
- [x] Historical Bot messages render without avatars while text, attachments, tool Activity, and necessary System content remain unchanged.
- [x] Reduced-motion preference suppresses activity motion while preserving static and nonvisual state signals.
- [x] No persistent active/inactive text or animated-ellipsis avatar transformation is introduced.
- [x] Playwright coverage proves current-versus-background Thread behavior, generated and uploaded avatars, waiting and terminal transitions, history, hover/focus, and reduced motion.
- [x] Visual verification covers light and dark themes plus desktop and narrow layouts without moving already rendered message content.

## Answer

Sidebar activity, ambient identity motion, and selected-Thread working state are now separate signals. The transient working avatar follows only the selected Thread's nonterminal Turn, preserves accessible static cues under reduced motion, and disappears without changing message history.