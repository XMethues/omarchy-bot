# Vendor reference notes

- **Astryx**: do NOT crawl astryx.atmeta.com pages. Agent docs come from the CLI (scoped name!):
  - `npx @astryxdesign/cli search "<query>"` — components, hooks, docs, templates
  - `npx @astryxdesign/cli docs` / `docs <topic>`
  - `npx @astryxdesign/cli component <Name>` / `component --list`
  - Bare `npx astryx` resolves to an unrelated package.
- **TanStack Router**: `tanstack-router-llms.txt` (fetched from tanstack.com/router/latest/llms.txt).
  Route tree generation with Vite: @tanstack/router-plugin + generated routeTree.gen.ts; CLI path only for non-Vite setups (verify against the llms copy when wiring apps/web).
