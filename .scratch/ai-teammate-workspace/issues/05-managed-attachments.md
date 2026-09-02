# 05: Send and revisit managed attachments

**What to build:** Let users stage local files and images in a Composer Draft, send stable managed snapshots to the Bot's Agent, and revisit those attachments from Thread history.

**Blocked by:** 04: Navigate Thread history and preserve window drafts

**Status:** ready-for-agent

- [ ] File selection and drag/drop create bounded local staged attachments owned by the originating window draft.
- [ ] Navigation cannot move a staged attachment into another Bot or Thread.
- [ ] Sending associates an immutable managed snapshot with the persisted message and Thread.
- [ ] Images render safe inline previews and other files render compact rows with useful metadata.
- [ ] The Agent receives only attachment forms supported by its tested Agent Capability Inventory.
- [ ] Unsupported media, invalid content, and size failures produce contextual errors without losing the rest of the draft.
- [ ] Reloading the same window restores valid staged attachment references; another window cannot claim them.
- [ ] History can retrieve the same managed bytes after the original source file changes or disappears.
- [ ] Managed files remain local and are not sent to an omarchy-bot cloud service.
- [ ] API integration and browser E2E tests verify staging, sending, snapshot stability, history, isolation, and failure states.
