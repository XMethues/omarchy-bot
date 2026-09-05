# Petdex avatar integration

Research question: should Omarchy Bot replace or complement its pinned, locally rendered DiceBear Avatar Recipes with Petdex?

Research snapshot: 2026-09-03. The inspected first-party baseline is Petdex repository commit [`5323e43624bdd065fc65f3b3aa572404d51ce75d`](https://github.com/crafter-station/petdex/commit/5323e43624bdd065fc65f3b3aa572404d51ce75d) (committed 2026-08-30), CLI [`petdex@1.3.0`](https://www.npmjs.com/package/petdex/v/1.3.0), Desktop [`v0.9.1`](https://github.com/crafter-station/petdex/releases/tag/desktop-v0.9.1), and live manifests generated at `2026-09-03T10:28:20Z`. Petdex's `/docs` page still labels the CLI “v0.1”; package metadata is the authoritative release version for this report.

## Decision summary

**Do not replace Avatar Recipes with Petdex.** Petdex is a hosted gallery, command-line installer, native floating desktop companion, public catalog API, and raster sprite package format. It is not an avatar-generation SDK, React component, embeddable widget, or parameterized renderer. A Petdex pet is an authored atlas selected by slug, not a deterministic `style + seed + options` recipe. Petdex therefore cannot preserve Omarchy Bot's prompt-authored, per-Bot identity contract without replacing it with catalog selection.

**Do not hotlink Petdex or run its CLI/Desktop/OMP integration from Omarchy Bot.** Those modes add remote availability and privacy dependencies, bypass Omarchy Bot's same-origin avatar boundary, expose mutable catalog metadata without asset digests or usable license metadata, and solve a different product problem: one operating-system-level companion reacting to coding-agent hooks.

**Petdex may complement the current system only as a future, curated import source.** A viable integration would be daemon-owned, opt-in ingestion of individually license-approved pets, strict validation and resizing, local same-origin persistence, and a small web sprite renderer. DiceBear should remain the default and prompt-authored path. Production import is blocked until license, attribution, and immutable asset identity can be verified per pet; a bounded prototype can test rendering and cost with one separately verified CC0 or Omarchy-owned atlas.

## What Petdex actually provides

Petdex's own repository describes three products: a web gallery, a CLI, and a floating desktop app. It also identifies two builder surfaces: the public HTTP manifest and the `pet.json` plus spritesheet package format. The site source is Next.js/React, but that is Petdex's implementation, not a published consumer framework integration. The native desktop app is a complete application built on Vercel's Native SDK, not an embeddable library. Sources: [Petdex repository README at the inspected commit](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/README.md), [CLI docs](https://petdex.dev/docs), [CLI package metadata](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-cli/package.json), and [native desktop README](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/README.md).

| Surface | Verified contract | Relevance to web Bot avatars |
| --- | --- | --- |
| Hosted gallery | Browse and preview community-submitted pets at `petdex.dev`; the live homepage reported 4,674 pets in this snapshot. | Discovery only. It is not an avatar-render endpoint. [Homepage](https://petdex.dev/) |
| CLI | `npx petdex install <slug>` on Node 20+ downloads metadata and a spritesheet into `~/.petdex/pets/<slug>` and `~/.codex/pets/<slug>`. Installing does not require an account; submission does. | Build/user tooling, not a runtime SDK. Invoking it from the product would be an unnecessary subprocess and telemetry/network surface. [Docs](https://petdex.dev/docs), [installer source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-cli/bin/petdex.ts#L289-L343) |
| Desktop app | A native floating mascot for macOS, Linux, and Windows. It scans `~/.petdex/pets` and `~/.codex/pets`; `PETDEX_PET` chooses a directory name. It persists one active pet plus appearance settings. | A separate desktop experience, not a component inside Omarchy Bot. [Docs](https://petdex.dev/docs#desktop-app), [selection source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/main.zig#L1189-L1250) |
| Public API | `GET /api/manifest` redirects to a JSON v1 snapshot; `GET /api/manifest/v2` redirects to a compact v2 snapshot. Both enumerate approved pets. | Usable by Omarchy Bot's daemon for discovery/ingestion, subject to validation and license blockers. [v1 manifest](https://petdex.dev/api/manifest), [v2 manifest](https://petdex.dev/api/manifest/v2), [schema source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/lib/public-manifest.ts) |
| Pet assets | A `pet.json` document and a WebP or PNG atlas. Classic v1 is an 8×9 grid; v2 is 8×11. Canonical cells are 192×208 pixels, producing 1536×1872 or 1536×2288 sheets. | Technically renderable with CSS background-position, Canvas, or decoded frames, but requires a new local asset lifecycle. [Validation source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/lib/submissions-validation.ts#L93-L139), [sprite version source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/lib/sprite-version.ts) |
| Local state API | Desktop listens on `127.0.0.1:7777`; authenticated `POST /state` changes its current mascot animation. | Controls the external desktop pet only. It does not return avatar data or render into a web view. [Docs](https://petdex.dev/docs#desktop-app), [server source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/hook_server.zig) |
| Source code | The site, CLI, and current desktop app are publicly available under the repository's MIT license. | Reusable code subject to MIT, but the pet artwork has separate per-pet rights. [Repository](https://github.com/crafter-station/petdex), [license](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/LICENSE) |

No first-party evidence was found for a Petdex JavaScript/TypeScript SDK export, npm rendering package, React/Vue/Svelte component, iframe widget, hosted image-rendering API, or framework-specific initialization function. The published npm package declares only a `petdex` executable and no library `exports`; Petdex's live CSP includes `frame-ancestors 'none'`, which also prevents iframe embedding. Sources: [published package metadata](https://registry.npmjs.org/petdex/1.3.0), [pinned package.json](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-cli/package.json), and live response headers from [petdex.dev](https://petdex.dev/).

The homepage explicitly advertises Claude Code, Codex, Gemini CLI, OpenCode, Qoder, Kimi Code, CodeBuddy, and OMP. The repository also documents Hermes and DeepSeek Harness integrations. These are coding-agent event adapters for the desktop companion, not UI-framework support. Sources: [homepage](https://petdex.dev/) and [repository README](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/README.md).

## API and data model

### Public manifest

The public manifest contains exactly these per-pet fields:

```text
slug
displayName
kind
submittedBy
spritesheetUrl / spritesheet reference
petJsonUrl / petJson reference
zipUrl / zip reference
spriteVersionNumber (1 | 2)
```

The compact manifest adds top-level `v: 2`, `generatedAt`, `total`, `assetBase`, and an ordered `fields` tuple. **It does not expose license, declared-at time, attribution instructions, source or artifact SHA-256, dimensions, byte size, frame timing, or moderation status.** This omission is confirmed by both the public schema and live payload. Sources: [manifest schema](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/lib/public-manifest.ts), [live v1](https://petdex.dev/api/manifest), and [live v2](https://petdex.dev/api/manifest/v2).

The internal database does store `license`, `licenseDeclaredAt`, `spriteSha256`, `petJsonSha256`, and `zipSha256`; those fields simply do not cross the public manifest boundary. Therefore a consumer cannot use the documented public API to establish the license grant or pin the exact bytes it fetched. Source: [database schema](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/lib/db/schema.ts#L30-L89).

### `pet.json` and selection

A representative current Boba document is:

```json
{
  "id": "boba",
  "displayName": "Boba",
  "description": "A tiny otter sipping bubble tea while keeping you company in Codex.",
  "spriteVersionNumber": 2,
  "spritesheetPath": "spritesheet.webp"
}
```

Source: [Boba `pet.json`](https://assets.petdex.dev/curated/boba/petjson-v2.json).

The renderer does not consume a seed, style options, colors, traits, or a preset identifier. Selection is by catalog `slug`/installed directory; the desktop persists `active_pet` as that slug. Petdex's settings can switch installed pets and adjust presentation such as sprite scale and activity bubbles, but it does not mutate the artwork. Sources: [desktop docs](https://petdex.dev/docs#desktop-app), [catalog source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/catalog.zig), and [settings persistence](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/main.zig#L1327-L1347).

Collections, tags, vibes, color filters, “featured,” and Hatch v1/v2 are gallery taxonomy or whole-asset authoring/version concepts, not rendering presets. No first-party state snapshot/restore API for a pet's animation position was found.

### Versioning is format-level, not content identity

`spriteVersionNumber` distinguishes atlas layouts only: omitted/`1` means classic 8×9; `2` means Hatch v2 8×11. It is not a revision, immutable asset ID, or compatibility version for an individual pet. Source: [sprite-version implementation](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/lib/sprite-version.ts).

The live snapshot demonstrates why consumers must not treat it as content identity: Boba's manifest row reported `spriteVersionNumber: 1`, while the referenced [`petjson-v2.json`](https://assets.petdex.dev/curated/boba/petjson-v2.json) reported `2` and the URL points to a 1536×2288 v2 atlas. Source: [live manifest](https://petdex.dev/api/manifest) and [Boba metadata](https://assets.petdex.dev/curated/boba/petjson-v2.json). An importer must reconcile manifest, `pet.json`, and measured atlas geometry, then assign its own digest and persisted renderer/format version.

## Animation, state, and interactivity

The canonical nine rows and first-party meanings are:

| State | Row | Frames | Nominal loop | Intended meaning |
| --- | ---: | ---: | ---: | --- |
| `idle` | 0 | 6 | 1100 ms | neutral breathing/blinking |
| `running-right` | 1 | 8 | 1060 ms | right locomotion |
| `running-left` | 2 | 8 | 1060 ms | left locomotion |
| `waving` | 3 | 4 | 700 ms | greeting/attention |
| `jumping` | 4 | 5 | 840 ms | jump/reaction |
| `failed` | 5 | 8 | 1220 ms | error/sad reaction |
| `waiting` | 6 | 6 | 1010 ms | patient idle variant |
| `running` | 7 | 6 | 820 ms | generic in-place work loop |
| `review` | 8 | 6 | 1030 ms | inspecting/thinking |

Source: [canonical web state table](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/lib/pet-states.ts). The native desktop uses per-frame timing, including an irregular idle blink, rather than the web table's one uniform CSS `steps()` duration; the semantic rows are the same. Source: [native sprite table](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/sprite.zig).

The desktop's exact state write contract is:

```http
POST http://127.0.0.1:7777/state
Content-Type: application/json
X-Petdex-Update-Token: <64-hex-character boot token>

{"state":"waving","duration":1200}
```

`state` must be one of the nine names above. `duration` is optional, non-negative, and capped at 30,000 ms. Bare `running` alternates left and right. State and bubble writes share a 30 requests/second token bucket. The token is regenerated each app boot and written to `~/.petdex/runtime/update-token` with mode `0600` on POSIX. Sources: [official state example](https://petdex.dev/docs#desktop-app) and [hook server implementation](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/hook_server.zig#L384-L455), [routing and validation](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/hook_server.zig#L667-L797).

The same server has unauthenticated local reads (`/health`, `/whoami`, `/state`, `/bubble`, `/init-status`, `/update`) and token-gated writes (`/state`, `/bubble`, `/update`). Requests are capped at 8 KiB, connections at 64, and connection time at five seconds. Source: [hook server](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/hook_server.zig).

Desktop interactivity includes drag/drop with momentum, click/pat reactions, a floating activity bubble, and focus handoff to an originating agent. The hosted pet page has an interactive floater on larger screens and a static mobile fallback. These behaviors belong to Petdex's own surfaces; they are not exported as a reusable widget. Sources: [desktop docs](https://petdex.dev/docs#desktop-app), [desktop interaction source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/main.zig#L2978-L3100), and [pet page source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/app/%5Blocale%5D/pets/%5Bslug%5D/page.tsx#L289-L320).

The official OMP integration is especially important to scope correctly: it is an OMP extension generated by Petdex Desktop. It maps OMP session/tool events to `POST /state` and `/bubble` on the local port, reads the boot token, and silently does nothing if Desktop is absent. It neither supplies avatar assets to OMP nor embeds a pet in OMP's UI, so it is not an integration shortcut for Omarchy Bot's web avatars. Source: [official OMP extension](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/assets/omp-extension.ts).

## Licensing and attribution

Petdex code is MIT, but Petdex explicitly says pet assets remain owned by submitters under each submitter's declared license. It also describes pets as user-submitted fan art, disclaims ownership of underlying IP, and operates a takedown process. The code license therefore cannot authorize bundling or commercially displaying arbitrary catalog art. Sources: [repository license section](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/README.md#license), [pet IP statement](https://petdex.dev/docs#distribute-your-pets), and [takedown page](https://petdex.dev/legal/takedown).

The submission model accepts `cc0`, `cc-by`, `cc-by-sa`, `cc-by-nc`, and `all-rights-reserved`; legacy pets may be `unspecified`. Petdex's own code classifies only `cc0`, `cc-by`, and `cc-by-sa` as commercial-use licenses. It deliberately does not infer a permissive license for legacy assets. Sources: [submission license validation](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/lib/submissions-validation.ts#L19-L55) and [database schema](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/lib/db/schema.ts#L30-L55).

Production adoption is blocked by the public boundary:

- neither manifest exposes the per-pet license;
- the public pet page source does not render a license field;
- the license enum does not identify a Creative Commons version or jurisdiction;
- the public data provides a credit name but no required attribution text/license URL;
- a submitter's declaration does not establish rights in underlying franchise characters.

Sources for the first two facts: [manifest schema](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/lib/public-manifest.ts) and [pet page source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/app/%5Blocale%5D/pets/%5Bslug%5D/page.tsx). No first-party Petdex API terms, asset-wide commercial grant, attribution specification, or service-level commitment was found. Those absences must remain “unverified,” not be filled by the site's “open-source pets” marketing language.

## Privacy, network, and offline behavior

### Verified network behavior

- The CLI needs Petdex's hosted manifest and `assets.petdex.dev` to discover/install. It fetches `pet.json` and the spritesheet, then makes a separate `GET /install/<slug>` metrics request. [CLI manifest source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-cli/src/manifest.ts), [installer source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-cli/bin/petdex.ts#L289-L343)
- CLI telemetry is on by default. It persists a random install UUID in `~/.petdex/telemetry.json`, can be disabled with `petdex telemetry off` or `PETDEX_TELEMETRY=0`, and posts lifecycle/OS/architecture/agent fields to Petdex. Petdex says country is inferred at Vercel's edge, raw IP is not stored, and events may be retained for 12 months. [Telemetry disclosure](https://petdex.dev/legal/telemetry), [CLI telemetry source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-cli/src/telemetry.ts)
- The telemetry disclosure and inspected CLI source are not perfectly synchronized: the disclosure lists `desktop_first_state_received`, while the current CLI union additionally lists init/update/edit events. The desktop v0.9.1 source inspected for this report did not expose a documented opt-out implementation for a desktop first-state event. Treat the disclosure as policy, but do not assume the source list is exhaustive. [Disclosure](https://petdex.dev/legal/telemetry), [source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-cli/src/telemetry.ts)
- Desktop checks a hosted latest-release endpoint by default; the setting can disable update checks. Catalog installs also require the hosted manifest/assets. The hook/state path itself is loopback-only. [Update source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/updates.zig), [update policy source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/main.zig#L1093-L1122)
- Once a pet is installed, its atlas and metadata are local and the desktop renderer can animate them without fetching each frame. This is local asset playback, not full guaranteed offline operation because update/catalog/auth features remain networked. [Desktop README](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/README.md), [local loader](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/main.zig#L1392-L1420)

Petdex is source-available and documents a Docker/Podman local-development stack, while the CLI exposes `PETDEX_URL` for non-production deployments. No first-party production self-hosting guide, supported asset-mirror distribution, or offline manifest snapshot contract was found. The documented service stack includes Postgres, Redis, Clerk, and R2, so “the repository can be run locally” is not evidence that Petdex offers a supported self-hosted product. Sources: [repository development instructions](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/README.md#develop-locally) and [CLI configuration](https://petdex.dev/docs#configuration).

An anonymous clean-tab observation of [the homepage](https://petdex.dev/) found no cookie scoped to `petdex.dev`, but it did store `petdex_surprise_pet_seen_<date>` in local storage; a Cloudflare bot-management cookie scoped to `img.clerk.com` appeared after Clerk-hosted images loaded. The page also loaded resources from `assets.petdex.dev`, `img.clerk.com`, `storage.googleapis.com`, and `static.cloudflareinsights.com` in addition to same-origin resources. This is a dated runtime observation, not a contractual no-cookie guarantee. No general Petdex privacy policy was found; only the CLI telemetry disclosure was available. Omarchy Bot must therefore not infer that hosted gallery/API use is telemetry-free.

A remote/hotlinked avatar would disclose the user's IP and normal HTTP request metadata to Petdex/Cloudflare whenever the asset is fetched and would fail offline/cold-cache. A daemon-side one-time import would limit upstream contact to an explicit user action; serving the normalized result from Omarchy Bot's daemon would restore offline and same-origin behavior. This paragraph is an architectural inference from the verified network paths above.

## Security and CSP

Petdex has meaningful upstream defenses: submissions restrict asset URLs to its R2 origin, validate an 8×9 or 8×11 aspect ratio and minimum dimensions, scan JSON/text for executable keys, traversal, secrets, script URLs, and suspicious payloads, and put submissions through review. Sources: [submission validation](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/lib/submissions-validation.ts), [security scanner](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/lib/pet-security.ts), and [CLI docs](https://petdex.dev/docs#validation-rules).

Those controls do not make a direct product integration safe by themselves:

- The public manifest is mutable and has no hashes. The database hashes are private to the service boundary. A consumer needs its own digest and immutable local copy. [Manifest schema](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/lib/public-manifest.ts), [database schema](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/lib/db/schema.ts)
- The CLI checks trusted hosts and HTTP status, but its install path does not verify a digest, response content type, byte limit, decoded geometry, or agreement between manifest and `pet.json` before writing. Omarchy Bot must not delegate trust to `npx petdex install`. [Installer source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-cli/bin/petdex.ts#L289-L343)
- Raster WebP/PNG avoids executable SVG/HTML, but decoding still crosses a complex image-codec boundary. A daemon importer should cap compressed bytes and decoded pixels, decode in the existing image-processing boundary, and re-encode before persistence. This is a security inference.
- Petdex's redirect responses advertise `Access-Control-Allow-Origin: *`, but the final `assets.petdex.dev` manifest and representative Boba asset responses did not include that header in this snapshot. Browser `fetch`/Canvas use therefore cannot be assumed cross-origin-safe. A plain CSS background or `<img>` may display, but Canvas extraction would be tainted and direct API fetch may fail CORS. Sources: live headers from [manifest](https://petdex.dev/api/manifest) and [Boba atlas](https://assets.petdex.dev/curated/boba/sprite-v2.webp).
- Hotlinking would require adding `https://assets.petdex.dev` to Omarchy Bot's `img-src` and possibly `connect-src`. Iframing Petdex is unavailable because its live CSP has `frame-ancestors 'none'`. A daemon import needs no persistent CSP exception. Source: live response headers from [petdex.dev](https://petdex.dev/).

The Desktop loopback server is comparatively well bounded for its purpose: it binds `127.0.0.1`, uses a per-boot random token and constant-time comparison for writes, limits requests/concurrency/rate, and makes connections one-shot. It is nevertheless another local service and token file with a global, one-active-pet model, duplicating rather than fitting Omarchy Bot's existing daemon and per-Bot protocol. Source: [hook server](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/hook_server.zig).

## Accessibility

Petdex's web `PetSprite` renders `role="img"` with a caller-provided label and defaults to “Pet animation”; the Boba detail page passes “Boba idle.” Its CSS disables sprite animation under `prefers-reduced-motion: reduce`, and offscreen gallery stages use `content-visibility` to avoid advancing invisible animations. Sources: [PetSprite](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/components/pets/pet-sprite.tsx), [detail-page label](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/app/%5Blocale%5D/pets/%5Bslug%5D/page.tsx#L303-L310), and [sprite CSS](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/app/globals.css#L592-L668).

Desktop declares a generic “Petdex pet” accessibility label for the main sprite rather than the selected pet's display name. Its multi-agent flock does expose semantic state labels such as “Agent working,” “Agent blocked,” and “Agent failed.” It receives a platform reduced-motion flag through theme tokens, but this source snapshot does not show that flag selecting a static sprite frame; desktop reduced-motion behavior is therefore unverified. Source: [desktop accessibility source](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/main.zig#L59-L61), [sprite and flock semantics](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/main.zig#L4398-L4406), [flock labels](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/main.zig#L4710-L4736).

Any Omarchy Bot prototype must keep its existing, stronger contract: meaningful avatars are labeled from the Bot name, decorative duplicates are hidden, and reduced motion uses a static frame plus non-motion status. Petdex artwork must not replace the Bot name as accessible identity.

## Performance and payload implications

The representative [Boba v2 atlas](https://assets.petdex.dev/curated/boba/sprite-v2.webp) was 1536×2288 and 2,440,892 bytes in the live snapshot. Fully decoded RGBA is approximately 14,057,472 bytes (13.4 MiB) before browser/renderer overhead. A nearest-neighbor prototype resize to 384×572 produced a roughly 99,330-byte WebP; that number is encoder-dependent but demonstrates that shipping the source-resolution atlas to 32–48 px avatar slots is unnecessary.

Petdex's native source independently documents why full sheets are expensive: a classic sheet is about 11.5 MB decoded, so Desktop decodes the atlas and registers only individual 192×208 frames. The web renderer keeps a full CSS background layer, uses `contain`/`will-change`, and suppresses offscreen and reduced-motion animation. Sources: [native loader rationale](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/packages/petdex-desktop-native/src/main.zig#L1180-L1190) and [web sprite CSS](https://github.com/crafter-station/petdex/blob/5323e43624bdd065fc65f3b3aa572404d51ce75d/src/app/globals.css#L504-L668).

The current Omarchy Bot imports ten pinned DiceBear JSON style definitions totaling about 931 KB uncompressed in the installed package, then generates SVG data URIs locally and retains at most 256 rendered variants. That raw source total is not a production bundle measurement, but it is shared across every generated avatar rather than adding a multi-megabyte unique atlas for each Bot. Sources: [`avatarRenderer.ts`](../../apps/web/src/components/avatarRenderer.ts) and installed `@dicebear/styles@10.6.0` definitions.

**Inference:** naïvely loading one source atlas per visible Bot would be materially worse in transfer, decoded memory, and continuous animation work than the current shared renderer. A practical Petdex complement needs small same-origin static first frames for lists/transcripts and must load at most the active Bot's resized atlas when animation is actually visible. It should avoid Canvas copies in steady state and avoid animating every sidebar Bot.

## Comparison with Omarchy Bot's current contract

| Concern | Omarchy Bot today | Petdex fit |
| --- | --- | --- |
| Identity model | Per-Bot recipe with pinned `rendererVersion`, allowed `style`, deterministic `seed`, and validated options. [`api.ts`](../../packages/protocol/src/api.ts#L37-L73) | Per-asset slug plus remote URLs and format `1 | 2`; no deterministic generation inputs. Replacement is a domain-model regression. |
| Prompt customization | The selected Agent returns constrained JSON data; options are currently forced empty; Omarchy Bot alone renders it. [`recipes.ts`](../../apps/daemon/src/modules/avatars/recipes.ts) | No prompt-to-recipe API. “Hatch” creates a complete new spritesheet in another tool, not a runtime avatar recipe. [Docs](https://petdex.dev/docs#distribute-your-pets) |
| Rendering trust | Pinned local DiceBear definitions produce a data URI. Uploads are accepted only through a same-origin `/api/bots/<id>/avatar` URL. [`avatarRenderer.ts`](../../apps/web/src/components/avatarRenderer.ts), [`AvatarView.tsx`](../../apps/web/src/components/AvatarView.tsx#L47-L67) | Hosted manifest and raster assets; safe adoption requires daemon ingestion, re-encoding, and same-origin serving. Direct URLs violate the intended boundary. |
| Animation model | `idle`, `selected`, `working`, `streaming`; active states choose DiceBear `animationVariant` and container breathing; idle is static. [`avatarRenderer.ts`](../../apps/web/src/components/avatarRenderer.ts#L14-L44), [`AvatarView.tsx`](../../apps/web/src/components/AvatarView.tsx#L21-L75) | Nine authored semantic rows with fixed frame counts/timings. Richer waiting/error/review art, but not speed variants and not a direct mapping to streaming. |
| Persistence/upgrade | Recipe pins exact renderer packages; only one renderer is supported; retired recipes deterministically become current Pixelbot defaults. [Workspace context](../contexts/workspace/CONTEXT.md#avatar-recipe), [ADR 0005](../contexts/workspace/adr/0005-prompt-authored-bot-avatars.md) | Manifest format version is not content identity; no public hash or revision. Omarchy Bot would need to persist normalized bytes and its own SHA-256/version metadata. |
| Offline/privacy | Generated avatars render without an avatar network request; uploads are local/same-origin. | Desktop is local after install, but discovery/install/update/telemetry are networked. Hotlinking creates a request per cold asset; daemon ingestion can recover local behavior. |
| Accessibility | Bot-name label; duplicate decoration hidden; reduced motion is static with a status indicator. [`AvatarView.tsx`](../../apps/web/src/components/AvatarView.tsx#L77-L94), [ADR 0005](../contexts/workspace/adr/0005-prompt-authored-bot-avatars.md) | Web primitives can meet reduced-motion and labeling requirements, but they do not automatically preserve Omarchy Bot's per-Bot semantics. |
| Multiplicity | Every persisted Bot owns its own avatar and many appear together. [Workspace context](../contexts/workspace/CONTEXT.md#bot-profile) | Desktop centers one active pet (plus a separate multi-agent flock). It is not the same model. |
| License | DiceBear dependency/style licenses are pinned with the application. | Code is MIT; asset license varies per pet and is absent from the public API. Wholesale catalog use is not supportable. |

Petdex's main product advantage is authored, expressive state animation—especially `waiting`, `failed`, and `review`. Its main mismatch is deeper: it stores pixels, while Avatar Recipe intentionally stores constrained intent and keeps Omarchy Bot as the sole renderer. The current architecture was chosen specifically to reject Agent-produced markup and remote image URLs. Sources: [workspace context](../contexts/workspace/CONTEXT.md), [ADR 0005](../contexts/workspace/adr/0005-prompt-authored-bot-avatars.md), and [`recipes.ts`](../../apps/daemon/src/modules/avatars/recipes.ts#L29-L64).

## Integration options

### 1. Replace DiceBear recipes with Petdex slugs or URLs — reject

This removes prompt-authored variation, requires a protocol and persistence cutover, makes identity depend on a mutable remote catalog, introduces per-asset licensing risk, and makes offline rendering impossible unless every asset is independently cached and versioned. A `slug` is not equivalent to the existing recipe.

### 2. Hotlink a Petdex atlas beside DiceBear — reject

This is superficially small but breaks the same-origin boundary, adds CSP domains, leaks viewer requests upstream, fails cold-cache offline, relies on unverified cross-origin headers, and can decode ~14 MB for one representative avatar. It also leaves license metadata unresolved.

### 3. Launch Petdex Desktop or install its OMP extension — reject for avatars

This can complement the user's overall desktop as an independently installed mascot, but Omarchy Bot should neither manage nor depend on it. It has one local companion, its own hooks/bubbles/settings/update checks/telemetry, and no web-avatar output. At most, documentation outside this report could mention that users may run Petdex separately; no product integration is justified.

### 4. Curated, daemon-ingested Petdex asset type — conditional complement

This is the only architecture consistent with Omarchy Bot:

1. user explicitly chooses an eligible catalog pet;
2. daemon fetches and validates it once;
3. daemon re-encodes/resizes and stores it locally;
4. protocol persists immutable local identity and provenance rather than a live URL;
5. web fetches only same-origin static/animated artifacts;
6. DiceBear remains default and remains the prompt-authored path.

This is not currently production-ready because the public Petdex surface cannot prove per-pet license or hashes. It becomes viable only if Petdex exposes a versioned license/attribution record and immutable digests, or Omarchy Bot maintains a deliberately tiny, separately verified allowlist with recorded grants.

## Recommendation and bounded prototype

**Recommendation: retain the pinned local DiceBear recipe renderer as Omarchy Bot's sole production generated-avatar system. Reject Petdex as a replacement, reject hotlinking, and reject CLI/Desktop/OMP-runtime integration. Consider Petdex only as an optional curated asset-import complement after the licensing and immutable-identity blockers are resolved.**

A bounded prototype is justified to answer only the rendering/cost question, not to pre-approve catalog adoption:

1. Use exactly one Omarchy-owned or separately verified CC0 v2 atlas; do not use a merely “unspecified” gallery pet.
2. In an isolated prototype path, have the daemon fetch the manifest entry, `pet.json`, and atlas over HTTPS. Enforce an asset-host allowlist, slug grammar, redirect policy, compressed-byte ceiling, exact 8×9/8×11 geometry, WebP/PNG decoding, and agreement between manifest, metadata, and measured rows. The Boba `1`/`2` mismatch must be rejected, not silently normalized.
3. Compute and persist source SHA-256, normalized-artifact SHA-256, source URL, slug, format version, verified license/version, attribution text, and import timestamp. Re-encode pixels and never retain executable or arbitrary metadata.
4. Produce a small static first-frame image for normal sidebar/transcript use and a nearest-neighbor atlas no larger than 384×572 for animation. Serve both from the existing same-origin daemon boundary. Never retain or render Petdex URLs in `AvatarDto`.
5. Render the static frame for idle and `prefers-reduced-motion`; lazy-load the atlas only for the active visible Bot. Map only states with clear product semantics and keep the Bot-name label/decorative behavior from `AvatarView`. Do not add Petdex bubbles, drag physics, local port `7777`, agent hooks, update checks, CLI calls, cookies, or Petdex telemetry.
6. Exercise the actual web surface at workspace avatar sizes with multiple Bots and verify: zero browser requests to Petdex domains after import; cold offline reload; static reduced-motion behavior; no new CSP origins; correct Bot-name accessibility; no continuous animation for inactive Bots; and acceptable transfer, decoded memory, and frame pacing versus DiceBear.
7. Stop after one pet and one activity mapping. Advance to product design only if the visual result remains legible at real avatar sizes, resource use is bounded by lazy loading, and a durable per-pet license/digest source exists.

The adoption gate is therefore explicit: **prototype local ingestion, not Petdex integration; ship nothing until license provenance and immutable asset identity are enforceable.**
