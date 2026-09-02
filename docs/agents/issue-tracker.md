# Issue tracker: Local Markdown

Issues and specs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- Specification: `.scratch/<feature-slug>/spec.md`
- Tickets: `.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- Use one file per ticket, numbered from `01`
- Record triage state in a `Status:` line
- Append discussion under `## Comments`

## Publishing

When a skill says “publish to the issue tracker”, create the appropriate file under `.scratch/<feature-slug>/`.

## Fetching

When a skill says “fetch the relevant ticket”, read the referenced Markdown file.

## Wayfinding

- Map: `.scratch/<effort>/map.md`
- Child ticket: `.scratch/<effort>/issues/NN-<slug>.md`
- Ticket type: `Type: research|prototype|grilling|task`
- Blocking: `Blocked by: NN, NN`
- Claim: set `Status: claimed`
- Resolve: add `## Answer`, set `Status: resolved`, then update the map
