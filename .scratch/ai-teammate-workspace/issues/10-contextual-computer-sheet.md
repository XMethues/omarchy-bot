# 10: Replace the Computer console with contextual control

**What to build:** Preserve safe Shared Screen coordination while replacing the visible engineering lease console with a quiet conversation-level Computer Sheet and contextual Takeover.

**Blocked by:** 02: Chat through a user-created Bot

**Status:** resolved

- [x] A Computer icon is always available in the conversation Header and is visually quiet while inactive.
- [x] The icon reflects only plain-language selected-Bot states such as using computer, waiting, needs you, or user control.
- [x] The desktop Computer surface is a docked Astryx drawer; narrow windows use an Astryx Bottom Sheet.
- [x] The compact preview opens an Astryx Lightbox modal only after the user selects its expand icon.
- [x] Take control appears only when human input is relevant and parks Bot desktop input before handing over the Shared Screen.
- [x] Return to Bot re-observes the Shared Screen before resuming the parked work.
- [x] A Bot waiting behind another shows Waiting for computer only on that Bot.
- [x] Observation remains available without input ownership and no two participants can interleave input.
- [x] The legacy omarchy-bot desktop approval gate is absent; Agent-native approvals remain unchanged.
- [x] Emergency stop remains an accessible global fail-safe outside normal conversation controls.
- [x] API integration and browser E2E tests cover idle preview, Bot use, waiting, Takeover, return, re-observation, and emergency stop.

## Answer

- `tests/integration/computer.test.ts` covers selected-Bot mapping, takeover parking, serialized input, ownership-free observation, re-observation ordering, approval-gate absence, snapshots, and emergency stop/resume.
- `tests/e2e/specs/10-computer-sheet.spec.ts` covers the docked desktop drawer, modal preview expansion, narrow Bottom Sheet, preview and action visibility, waiting-state isolation, takeover/return, and the global emergency control.

Validated with `bun run typecheck`, focused computer integration tests, the complete 61-test integration suite, a production web build, and all three contextual-computer Playwright scenarios.
