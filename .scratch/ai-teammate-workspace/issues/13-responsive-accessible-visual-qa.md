# 13: Complete responsive, accessibility, and visual QA

**What to build:** Finish the accepted future/energetic/fresh workspace as one coherent Astryx product across themes, window sizes, input methods, streaming states, and motion preferences.

**Blocked by:** 05: Send and revisit managed attachments; 06: Dictate with Voxtype; 07: Edit Bot Profiles and avatars; 09: Surface background attention in the Sidebar; 10: Replace the Computer console with contextual control; 12: Contract the legacy runtime model

**Status:** ready-for-agent

- [ ] Feature UI uses Astryx primitives discovered through the CLI and does not recreate available layout, navigation, Sheet, Composer, message, avatar, or focus behavior.
- [ ] The visual system uses cool neutrals, one lively blue accent, consistent soft radii, restrained borders, and low card density in both light and dark mode.
- [ ] Theme follows Omarchy/system preference and maintains WCAG AA contrast.
- [ ] Desktop uses Sidebar plus conversation layout with no global TopNav; narrow windows use an accessible Sidebar drawer.
- [ ] Every interactive control is keyboard reachable, visibly focused, semantically labelled, and returns focus appropriately after Sheets and Dialogs close.
- [ ] Transcript streaming, history, drafts, attachment previews, dictation, profile editing, archived Bots, and Computer control remain usable at target breakpoints.
- [ ] Reduced-motion mode disables internal avatar movement and nonessential transitions while preserving static state meaning.
- [ ] Loading, empty, error, offline, unavailable Agent, failed upload, failed dictation, and Computer-unavailable states are contextual and complete.
- [ ] Automated axe tests, keyboard scenarios, light/dark visual regression, reduced-motion captures, typecheck, build, and all behavioral suites pass.
- [ ] Final taste review finds no neon/glass/AI-purple styling, card-wall dashboard density, permanent ambient motion, raw engineering language, or duplicate legacy navigation.
