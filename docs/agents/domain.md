# Domain Docs

This repository uses multiple domain contexts.

## Before exploring

1. Read `CONTEXT-MAP.md`.
2. Read every context selected by the map for the files or concepts involved.
3. Read system-wide ADRs in `docs/adr/`.
4. Read ADRs inside each selected context.
5. For cross-context work, read all participating contexts and their ADRs.

Proceed silently if a referenced document does not exist.

## Layout

- `docs/contexts/workspace/CONTEXT.md`
- `docs/contexts/workspace/adr/`
- `docs/contexts/agent-integration/CONTEXT.md`
- `docs/contexts/agent-integration/adr/`
- `docs/contexts/computer-control/CONTEXT.md`
- `docs/contexts/computer-control/adr/`
- `docs/adr/` for decisions spanning multiple contexts

## Vocabulary

Use the exact terms defined by the selected context documents. Do not substitute terms listed under `_Avoid_`.

If a required concept is missing, reconsider whether it belongs to an existing context before introducing new vocabulary.

## ADR conflicts

Surface conflicts explicitly rather than silently overriding an ADR.
