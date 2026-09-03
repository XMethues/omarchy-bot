# 05: Remove the archived Bot lifecycle

**What to build:** Give users one Bot lifecycle from creation to permanent deletion by restoring previously archived Bots to normal visibility and removing archive and restore everywhere.

**Blocked by:** 04: Delete active Bots safely

**Status:** resolved

- [x] Every previously archived Bot becomes visible in normal navigation before archived storage is removed.
- [x] No archived Bot is deleted or loses Threads, messages, files, profile data, or local Agent-session mappings during the cutover.
- [x] Bot projections and persistence no longer expose or store archived state or timestamps.
- [x] Bot listing has one normal population and no include-archived mode, archived filter, or archived Settings partition.
- [x] Archive and restore operations, events, confirmations, client behavior, and controls are removed rather than retained as aliases.
- [x] Direct permanent deletion remains available for inactive and active Bots through the behavior delivered by tickets 03 and 04.
- [x] Startup selection and recent-activity ordering handle restored Bots without pointing at removed lifecycle state.
- [x] Hide from Sidebar, Hidden sections, and other reversible-removal substitutes are not introduced.
- [x] Migration is a clean cutover with no dual reads, compatibility parsing, or unreachable archived rows.
- [x] Existing archive/restore integration scenarios are replaced with migration, visibility, data-preservation, and absence-of-contract coverage.
- [x] Playwright coverage proves that restored Bots are visible, no archive/restore surface remains, and direct deletion is the only removal flow.

## Answer

The archived lifecycle is removed end to end. Startup migration restores every surviving Bot to the ordinary visible population while preserving owned data and legacy profile identity; archive and restore contracts and surfaces no longer exist.