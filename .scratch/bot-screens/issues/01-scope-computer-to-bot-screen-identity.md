# 01: Scope Computer Surface to durable Bot Screen identity

**What to build:** Make every Bot's Computer Surface resolve through one durable, opaque Bot Screen identity so selected-Bot state and preview data can never fall back to another Bot or a global Computer state. This is the expand step that introduces the new identity and boundary while keeping the current backend operational behind it.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Every existing and newly created Bot owns exactly one unique Surface ID; Bots using the same Agent still receive different Surface IDs.
- [x] Surface identity remains stable for the Bot's lifetime, is exposed only as an opaque value, and is removed with direct permanent Bot deletion.
- [x] Computer state and preview requests require an explicit owning Bot/Surface association and reject missing, unknown, or mismatched ownership instead of using a global fallback.
- [x] Computer state, cached observations, public events, and coordination persistence carry Surface identity end to end.
- [x] Switching selected Bots clears the previous preview and Computer state before accepting data for the new Surface.
- [x] Migration from the existing database is lossless and idempotent, with observable API integration coverage for new and migrated Bots.

## Answer

The Bot persistence and `ComputerBroker` boundary now carry a durable opaque Surface ID, and Computer routes resolve an explicit Bot/Surface owner instead of falling back to global state. Focused `computer.test.ts` integration cases prove unique stable identity, ownership rejection, direct deletion behavior, and scoped observations, while `bot-migrations.test.ts` proves the idempotent legacy migration and the browser Computer-sheet test proves stale projection clearing when switching Bots.
