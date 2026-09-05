# 02: Ship the compact Astryx Composer dock

**What to build:** Refine the existing Composer into one compact, softly rounded Astryx dock with circular Attach, Mic, and Send footer actions while preserving every established composition, attachment, dictation, Steering, focus, and accessibility behavior.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] The Composer uses compact Astryx density, existing concentric rounded geometry, and one quiet low-elevation edge treatment rather than stacked header chrome.
- [x] Attach moves into footer actions beside circular Mic and primary Send controls.
- [x] The staged attachment drawer, file removal, drag-and-drop, and draft ownership remain unchanged.
- [x] Enter sends, Shift+Enter inserts a newline, and sending during active work retains existing Steering behavior.
- [x] Dictation recording, transcribing, insertion, cancellation, error, and optional auto-send behavior remain unchanged.
- [x] Disabled and Agent-readiness states continue to gate composition correctly.
- [x] Keyboard order, visible focus, semantic contrast, and reduced-motion behavior remain accessible.
- [x] The normal Send control remains authoritative; no permanent Stop, model picker, effort picker, or context ring is added.
- [x] No Board, Tailwind, Pro-template, second design-system, or hard-coded light/dark color dependency is introduced.
- [x] Existing chat, attachment, dictation, Draft, and Steering behavior tests remain green.
- [x] Real browser verification at desktop and narrow widths in light and dark themes confirms a compact dock rather than a stacked card.

## Answer

Moved Attach into the Astryx Composer footer at the same circular medium action size as Mic and Send, selected compact density, and retained the existing low semantic-token elevation. The established drawer, drop zone, draft, dictation, readiness, send, Steering, focus, and peer-mail transcript paths remain intact.

Focused validation:

- `bunx playwright test -c tests/e2e tests/e2e/specs/02-chat.spec.ts -g "keeps the Composer compact with accessible circular footer actions"`: 1 passed in Chromium. It exercised desktop light/no-preference motion and narrow dark/reduced-motion presentation, footer geometry, keyboard focus order, file chooser activation, Enter, and Shift+Enter.
- `bunx tsc --noEmit -p tsconfig.json`: passed with no diagnostics.
- Parent validation reported the other 24 focused chat/computer tests passing.
