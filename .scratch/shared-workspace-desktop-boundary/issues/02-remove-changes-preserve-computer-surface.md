# 02: Remove Changes while preserving the Computer Surface

**What to build:** The conversation no longer exposes or runs the unrequested Changes capability, while the user can still compose messages, use Bot Settings, and observe/control the selected Bot through the existing Computer Surface. Remove the complete capability instead of hiding its tab or replacing it with another workflow.

**Blocked by:** None (can start immediately).

**Status:** resolved

**Source specification:** [Shared Workspace and Bot Desktop Boundary Correction](../spec.md).

**Specification coverage:** Stories 26–35, 91, 92, 94, 95.

- [x] Changes summary, diff/detail presentation, file selection, refresh controls, and capability-specific navigation state are removed from the user interface. No review or work-artifact panel replaces them.
- [x] The client makes no Changes requests or hidden polling during initial load, Bot/Thread switching, Computer viewing, or panel close. Retired query state cannot revive the capability after navigation.
- [x] The backing working-tree module, Changes-only public daemon endpoints, DTOs, client methods, and fixtures are removed with every caller. No empty-success response, compatibility alias, deprecated export, or hidden Git capability remains.
- [x] Retired endpoints follow ordinary missing-interface behavior rather than claiming that the repository is clean or that a deleted feature still works.
- [x] The existing Computer entry remains reachable and opens the selected Bot's Computer Surface. Compact Preview, expanded Web Control, Takeover/return, explicit read-only fallback, and useful loading/error/retry states remain available.
- [x] Bot Settings and the Computer Surface retain the existing mutually exclusive right-region behavior. The desktop and narrow-screen layouts remain usable without competing or nested panels.
- [x] Composer drafts, attachments, dictation, send, Steering, history, and conversation selection remain unchanged. Unrelated dock improvements are preserved.
- [x] Keyboard focus, accessible labels, reduced-motion behavior, and light/dark presentation remain correct after the removed controls no longer occupy the interface.
- [x] Obsolete Changes-specific assertions, snapshots, and fixtures are retired only after preserving independent layout, selection-cleanup, accessibility, and Computer regression coverage previously housed in mixed suites.
- [x] A browser-driven check exercises the actual simplified interface on desktop and narrow layouts, including Computer and Settings transitions, rather than proving absence only through source-text assertions.
- [x] Public-daemon/browser checks prove both capability removal and the retained flows. Simulated projection tests are identified as UI/state coverage, not evidence that the production desktop already starts successfully.
- [x] The change stays in the shared Web frontend and daemon-facing contracts intended for future Tauri reuse. It adds no native scaffold, shell-specific business logic, alternate design system, or arbitrary-URL browser surface.

## Scope

This ticket does not depend on the new Shared Workspace default: deleting Git inspection is useful and verifiable while that separate cutover proceeds. It does not repair Cage startup or redesign Computer behavior. Application browser profiles, Cookies, logins, and file coordination remain outside the plugin desktop scope.

## Answer

Changes is gone from the shared Web conversation, protocol, api-client, and daemon: no tab, no review/artifact replacement, no client requests, and retired `/api/bots/:id/changes` routes now return ordinary 404 `{ error: "not found" }` rather than fake-clean success. Computer Surface, Bot Settings exclusivity, Composer, and layout/accessibility coverage remain. Simulated projection e2e is UI/state coverage only; it does not prove that a production Bot Desktop Session starts successfully.
