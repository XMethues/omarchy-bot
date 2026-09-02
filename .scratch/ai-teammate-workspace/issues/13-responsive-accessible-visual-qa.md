# 13: Complete responsive, accessibility, and visual QA

**What to build:** Finish the accepted future/energetic/fresh workspace as one coherent Astryx product across themes, window sizes, input methods, streaming states, and motion preferences.

**Blocked by:** 05: Send and revisit managed attachments; 06: Dictate with Voxtype; 07: Edit Bot Profiles and avatars; 09: Surface background attention in the Sidebar; 10: Replace the Computer console with contextual control; 12: Contract the legacy runtime model

**Status:** resolved

- [x] Feature UI uses Astryx primitives discovered through the CLI and does not recreate available layout, navigation, Sheet, Composer, message, avatar, or focus behavior.
- [x] The visual system uses cool neutrals, one lively blue accent, consistent soft radii, restrained borders, and low card density in both light and dark mode.
- [x] Theme follows Omarchy/system preference and maintains WCAG AA contrast.
- [x] Desktop uses Sidebar plus conversation layout with no global TopNav; narrow windows use an accessible Sidebar drawer.
- [x] Every interactive control is keyboard reachable, visibly focused, semantically labelled, and returns focus appropriately after Sheets and Dialogs close.
- [x] Transcript streaming, history, drafts, attachment previews, dictation, profile editing, archived Bots, and Computer control remain usable at target breakpoints.
- [x] Reduced-motion mode disables internal avatar movement and nonessential transitions while preserving static state meaning.
- [x] Loading, empty, error, offline, unavailable Agent, failed upload, failed dictation, and Computer-unavailable states are contextual and complete.
- [x] Automated axe tests, keyboard scenarios, light/dark visual regression, reduced-motion captures, typecheck, build, and all behavioral suites pass.
- [x] Final taste review finds no neon/glass/AI-purple styling, card-wall dashboard density, permanent ambient motion, raw engineering language, or duplicate legacy navigation.

## Answer

Completed the Astryx workspace as a responsive Sidebar and conversation surface: the Sidebar contains only user-created Bots, existing blank Threads have no hero placeholder, conventional navigation and toolbar actions are icon-only with accessible labels, and selected/working/streaming DiceBear avatars have reduced-motion-safe state animation.

Computer observation now uses a docked desktop drawer or narrow-window Bottom Sheet. The compact preview expands into an Astryx Lightbox modal, Escape closes one layer at a time, and closing the drawer restores focus to its header trigger.

`tests/e2e/specs/13-responsive-accessible-visual-qa.spec.ts` covers axe, keyboard and focus behavior, light/dark desktop, narrow navigation, reduced motion, long and failed transcripts, generated avatar motion, Computer-unavailable state, the desktop drawer, and the expanded preview modal. Final verification passed TypeScript checking, production build, all 83 Bun tests including real Pi conformance, and all 44 Playwright scenarios.
