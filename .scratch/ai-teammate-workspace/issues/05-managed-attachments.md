# 05: Send and revisit managed attachments

**What to build:** Let users stage local files and images in a Composer Draft, send stable managed snapshots to the Bot's Agent, and revisit those attachments from Thread history.

**Blocked by:** 04: Navigate Thread history and preserve window drafts

**Status:** resolved

- [x] File selection and drag/drop create bounded local staged attachments owned by the originating window draft.
- [x] Navigation cannot move a staged attachment into another Bot or Thread.
- [x] Sending associates an immutable managed snapshot with the persisted message and Thread.
- [x] Images render safe inline previews and other files render compact rows with useful metadata.
- [x] The Agent receives only attachment forms supported by its tested Agent Capability Inventory.
- [x] Unsupported media, invalid content, and size failures produce contextual errors without losing the rest of the draft.
- [x] Reloading the same window restores valid staged attachment references; another window cannot claim them.
- [x] History can retrieve the same managed bytes after the original source file changes or disappears.
- [x] Managed files remain local and are not sent to an omarchy-bot cloud service.
- [x] API integration and browser E2E tests verify staging, sending, snapshot stability, history, isolation, and failure states.

## Answer

Implemented content-sniffed, size-bounded staging; window-local Bot/Thread draft ownership; atomic immutable promotion into message history; capability-checked worker inputs; safe image/file rendering; managed-byte retrieval; and stale-stage cleanup.

Validated with `bun run typecheck`, the focused attachment/attention integration run (10 tests), the complete 71-test integration suite, production build, and all three managed-attachment Playwright scenarios.
