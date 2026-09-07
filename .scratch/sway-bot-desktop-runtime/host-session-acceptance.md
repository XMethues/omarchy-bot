# Host Session acceptance checklist

Status: pending

These checks are **human-only**. Automated screenshots, sibling Bot process lists, and Host compositor PID equality do not prove them. Do not mark an item done unless a person performed it on the live Omarchy Host Session. A failed item stays a blocker.

Record results under **Human results** below. Do not copy them into the automated conformance report as a pass.

## Checklist

- [ ] Original Omarchy top bar remains clickable and visually available during Bot desktop start, work, switching, failure, and cleanup
- [ ] Existing Omarchy keyboard shortcuts continue to fire in the Host Session through the same lifecycle
- [ ] Ordinary host focus and physical pointer/keyboard input stay independent of Bot-generated input
- [ ] Ordinary host applications (terminal, browser, files) stay usable while two Bot Desktops are running
- [ ] The user can switch Bots while using the host desktop and confirm selected pixels/input belong to the correct Bot
- [ ] Background work on the unselected Bot continues while the other is previewed or under Web Control
- [ ] Close and reopen Computer Preview / Web Control without destroying unsaved Bot application state
- [ ] Web Control is view-only RFB; mutation happens only through Broker-authorized input
- [ ] After cleanup, the Host Session still has the original compositor, bar, and shortcuts; no leftover Bot Screen processes
- [ ] Sibling Bot screenshots or service existence were not treated as proof of host usability

## Human results

Not recorded. No human pass is claimed.

## How to run

1. Leave the Host Session (Hyprland / Omarchy bar) running. Do not restart it for this checklist.
2. Start the production daemon (Sway Bot Desktop Runtime; no compositor selector).
3. Create two Bots, open Computer Preview on one, expand Web Control, type through Broker, switch Bots, leave the other working in the background, then delete/cleanup.
4. Tick only what you personally verified. Leave failures unchecked and write them here.
