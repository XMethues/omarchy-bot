# 09: Complete integration and mandatory user experience acceptance

**What to build:** Deliver the corrected plugin as one coherent, verified experience, with current documentation and an explicit human acceptance result. Automated checks, real desktop/resource evidence, and the user's own host-and-Bot experience are reported separately; no one layer is used to impersonate the others.

**Blocked by:** 07: Verify real host safety and normal-use resource cost; 08: Consolidate current specifications and retire superseded requirements.

**Status:** ready-for-human

**Source specification:** [Shared Workspace and Bot Desktop Boundary Correction](../spec.md).

**Specification coverage:** Stories 67–76, 84, 85, 90, 96; final integrated acceptance of the complete parent specification.

- [x] Verify the approved dependency frontier is complete and the delivered behavior integrates the Shared Workspace default, Changes removal, safe real startup, independent on-demand Sessions, viewer/resource lifetimes, recovery/deletion, and current documentation. Do not infer completion solely from ticket status.
- [x] Run the applicable integrated contract/type/build and focused behavior checks in a settled worktree, preserving existing conversation, Composer, Computer Surface, deletion, and accessibility guarantees. Fix in-scope integration regressions without restoring superseded capabilities to satisfy old tests.
- [x] Exercise the real current Web client through the retained user flows on desktop and narrow layouts. Distinguish simulated peers/public-interface coverage from actual desktop/projection outcomes.
- [x] Retain evidence for actual startup repair, targeted failure/recovery/cleanup, unaffected siblings, shared-file/native-data preservation, and the normal-use resource scenarios from the blocker. Do not replace them with a smaller or unrelated passing scenario.
- [x] The report states the evidenced startup cause and any separately established or unresolved host-disruption cause. It does not claim both symptoms shared a cause without evidence.
- [x] Present the user with a narrow, explicit hands-on check of the original Omarchy top bar, their existing shortcuts, and normal desktop focus/input while the corrected plugin is in use.
- [ ] The user also views and switches between Bots while one continues useful background work, checking that selected pixels/input belong to the correct Bot and background work is not cancelled or forced onto one shared input state.
- [ ] Record the user's actual confirmation or reported failure. Do not fabricate a successful experience check, infer approval from silence, or close final end-to-end acceptance before the user has confirmed it.
- [x] If the user is unavailable or a safe real-world prerequisite is missing, mark the acceptance work blocked with the exact missing evidence. Automatic tests and prior resource reports cannot bypass the mandatory human gate.
- [x] Resource results disclose plugin, application/Agent, and harness attribution plus whole-scenario totals and limitations. Any unresolved normal-use resource concern remains visible rather than being hidden behind the old capacity pass or an invented threshold.
- [x] Confirm that this work preserved Web reuse for the future Tauri Bot Client and kept execution on Omarchy. No current Chromium/browser result is described as a passing Tauri build, codec, input, or native-lifecycle test; actual Tauri delivery remains future work.
- [x] Final documentation/status reporting separates accepted design, implemented behavior, automated results, real-runtime evidence, and human acceptance. Current links are valid and obsolete specifications do not remain active instructions.
- [x] No shared work files, Agent-owned Native Sessions, or arbitrary application data were deleted or migrated to obtain acceptance. No host update, global environment change, broad process kill, or graphical-session restart is performed as an implicit repair step.
- [x] Provide a concise delivery record of what changed, what was exercised, what the user confirmed, and any remaining limitations. “Done” is reserved for the complete agreed behavior and all required acceptance, not a collection of passing mocks or intermediate ticket closures.

## Scope

The two blockers transitively cover every implementation slice and the independently executable documentation cutover. This ticket owns final integration and the explicitly requested human gate; it does not reopen product choices, add browser-state management, implement memory or Tauri packaging, or silently narrow the resource/host-safety requirements. If the hands-on check reveals an in-scope regression, keep acceptance open until it is fixed and the affected scenario is verified again safely.

## Answer

Tickets 01–08 are resolved. Integration evidence is in [the delivery record](../delivery-record.md) and [the selected-view resource report](../normal-use-resource-report.md). Final end-to-end acceptance is **not** closed.

**Startup cause:** Cage ran `wlr-randr` once before the compositor accepted output setup, and projection cleanup treated `releaseInput` as a fatal `#invoke` failure. Those are repaired. Public state now shows the failing stage.

**Host disruption:** prior top-bar/shortcut breakage is a separate, unresolved cause. Read-only checks kept user-manager env on the Host Session. This is not an Agent permission sandbox.

**Automated / real-runtime:** typecheck passed. `bun test` 313 pass / 2 environmental fails (Pi computer-tool `mise ERROR`; Playwright sandbox browser path). Focused Playwright with the real browser cache: 47 pass, 1 selected-Sidebar contrast fail in dark reduced-motion. Computer e2e is simulated-peer UI/state, not Cage pixels. Ticket 03/05/07 real-runtime evidence is retained.

**Missing evidence for “done”:** the user’s hands-on confirmation of top bar, shortcuts, ordinary host focus/input, and Bot switching while background work continues. The live plugin daemon has not been restarted onto this tree. Automatic tests cannot substitute for that gate.

**Tauri:** Web reuse preserved; execution stays on Omarchy; no WebView claim.
