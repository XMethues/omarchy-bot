# 13: Complete responsive, accessibility, and visual QA

**What to build:** Finish the accepted future/energetic/fresh workspace as one coherent Astryx product across themes, window sizes, input methods, streaming states, and motion preferences.

**Blocked by:** 05: Send and revisit managed attachments; 06: Dictate with Voxtype; 07: Edit Bot Profiles and avatars; 09: Surface background attention in the Sidebar; 10: Replace the Computer console with contextual control; 12: Contract the legacy runtime model

**Status:** resolved

- [x] Feature UI uses Astryx primitives discovered through the CLI and does not recreate available layout, navigation, Dialog, BottomSheet, Composer, message, avatar, or focus behavior.
- [x] The visual system uses cool neutrals, one lively blue accent, consistent soft radii, restrained borders, and low card density in both light and dark mode.
- [x] Theme follows Omarchy/system preference and maintains WCAG AA contrast.
- [x] Desktop uses Sidebar plus conversation layout with no global TopNav; narrow windows use an accessible Sidebar drawer.
- [x] Every interactive control is keyboard reachable, visibly focused, semantically labelled, and returns focus appropriately after Dialogs and BottomSheets close; meaningful Bot avatars are labelled from the Bot name.
- [x] Transcript streaming, History Dialog/BottomSheet, drafts, attachment previews, dictation, Profile, archived Bots, and Computer drawer/BottomSheet remain usable at target breakpoints.
- [x] Reduced-motion mode disables internal avatar movement and nonessential transitions while preserving static state meaning.
- [x] Loading, empty, error, offline, unavailable Agent, failed upload, failed dictation, and Computer-unavailable states are contextual and include plain-language guidance where action is possible.
- [x] Browser E2E follows a role-first policy: accessible roles and visible names are the default seam, test ids are reserved for surfaces without semantic selectors, and CSS/component internals are not test contracts.
- [x] Final design contains no neon/glass/AI-purple styling, card-wall dashboard density, permanent ambient motion, raw engineering language, permanent idle emergency control, or duplicate legacy navigation.

## Answer

Completed the Astryx workspace as a responsive Sidebar and conversation surface. Create and History use desktop Dialogs and narrow BottomSheets; Computer uses a desktop drawer and narrow BottomSheet with a modal expanded preview. The Profile identifies the immutable Agent, Settings → Appearance reports system-following theme state, unavailable integrations include guidance, and meaningful Bot avatars expose labels derived from the Bot name.

Generated avatars use the renderer recorded in each lossless recipe. New recipes use `dicebear-core@10.7.0+styles@10.6.0` with native reduced-motion-safe `animationVariant`; legacy `9.4.3` recipes retain deterministic legacy rendering until the user explicitly regenerates them. Emergency control is absent while idle and immediately accessible while computer input is active or stopped.
