# 13: Complete integration and Host Session acceptance

**Parent:** [#8](https://github.com/XMethues/omarchy-bot/issues/8)

**What to build:** Finish the migration with one coherent product verification, durable evidence, and a guided human acceptance pass proving that Sway is the only production Bot Desktop Runtime and remains safe and usable on the real Omarchy Host Session.

**Blocked by:** 11: Remove the Cage runtime after Sway cutover; 12: Remove the obsolete H.264 and WebRTC projection stack.

**Status:** ready-for-human

- [x] Relevant unit, integration, protocol, Agent conformance, browser, real-runtime smoke, supply, lifecycle, projection, and resource suites pass from a clean checkout.
- [ ] Production artifacts build and first-enable acquisition succeeds on the supported stock Omarchy architecture without host mutation.
- [x] Public browser behavior covers on-demand startup, connecting/error/retry states, preview, expanded Web Control, Takeover, Bot switching, closing/reopening, live-state recovery, and read-only fallback.
- [x] Real two-Bot behavior covers independent Agent control, viewer control, background continuation, multiple viewers, failures, daemon recovery, deletion, and complete targeted cleanup.
- [x] Final resource and host-safety reports are reproducible, identify limitations, and do not reuse incomparable historical numbers as acceptance evidence.
- [x] Authoritative product, context, ADR, implementation, tracker, and Agent-guidance documents consistently describe Sway, view-only WayVNC, Broker-authorized input, native Sway IPC, and no Cage fallback.
- [x] A concise hands-on checklist is presented for top bar, shortcuts, focus, physical pointer/keyboard, ordinary host applications, two-Bot switching, background work, close/reopen state, Web Control, and cleanup.
- [x] Human acceptance results are recorded separately from automated and resource evidence; any failed item remains an explicit blocker rather than being marked done.
- [x] Completion reporting separately states production cutover, Cage removal, WebRTC/H.264 removal, automated conformance, real-runtime evidence, resource evidence, and human acceptance.

## Answer

Implementation and automated integration are complete; mandatory hands-on Host Session acceptance is not. `BOT_DESKTOP_ROLLOUT.humanAcceptance` remains `"pending"`.

The current real two-Sway run verifies exact Unicode in browser and terminal, private `open_url`, actual Sway-to-noVNC browser paint and Broker input, unchanged live window/generation and unsaved text across viewer teardown, background progress, multiple viewers, isolated failure fallback, and full owned cleanup. A required failed or missing check now fails the test rather than merely writing a blocked report.

A real production runtime was acquired over private HTTPS with no Bun, mise, or compiler on PATH; official Bun 1.4.2 was downloaded/verified and the daemon became healthy without graphical-runtime acquisition. This proves the isolated cold path, not publication of a GitHub release or a fresh stock-machine user installation. Keep those publication/acceptance boundaries explicit.

**Open human checklist:** [Host Session acceptance](../host-session-acceptance.md)

**Current stage/evidence report:** [completion report](../completion-report.md)

The unchecked acceptance items remain blockers for closing GitHub #8 as fully accepted. No automation result is substituted for the user's top bar, shortcuts, focus, and physical input checks.
