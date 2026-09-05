# 01: Extract reusable Computer Surface content

**What to build:** Refactor the existing Computer panel so its Screen Projection and controls can be hosted inside a future capability panel without owning a nested right-side LayoutPanel, while preserving every current Computer Surface behavior and visual state.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] The reusable Computer Surface content renders without creating or assuming its own outer LayoutPanel.
- [x] The current workspace can continue hosting that content through the existing Computer entry point until the capability panel replaces it.
- [x] Computer Preview, Expanded Web Control, Takeover, Return to Bot, read-only HTTP fallback, errors, retry, and loading remain behaviorally unchanged.
- [x] Closing the current surface still revokes or releases browser control under existing authority rules.
- [x] Switching Bots clears the old Screen Projection before any new Bot content appears.
- [x] Desktop and narrow-screen presentation remain unchanged during this behavior-preserving prefactor.
- [ ] Existing Computer Surface browser and Screen Projection integration coverage passes without weakening assertions. Execution is delegated to parent validation because this ticket forbids validation commands during the concurrent wave.
- [ ] A real browser smoke check confirms that no nested panel chrome, duplicated heading, or control regression was introduced. Execution is delegated to parent validation because this ticket forbids validation commands during the concurrent wave.

## Answer

Exported `ComputerSurface` as the chrome-free hostable seam for Screen Projection lifecycle, preview, fallback, retry, Takeover, and Expanded Web Control behavior. `ComputerPanel` now supplies the sole current `LayoutPanel`, heading, close action, and focus restoration while mounting that reusable content. Existing browser coverage was strengthened to require exactly one Computer Surface region and one heading through the public workspace entry point; validation and the real-browser smoke remain parent-owned under the no-validation constraint.
