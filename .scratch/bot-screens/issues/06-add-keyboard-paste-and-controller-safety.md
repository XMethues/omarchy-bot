# 06: Add keyboard, paste, and controller safety

**What to build:** Complete expanded Web Control with keyboard transitions, shortcuts and one-way plain-text paste, while enforcing one active browser controller per Bot Screen and reliably releasing held input when ownership changes or a connection disappears.

**Blocked by:** 05: Add pointer Web Control.

**Status:** resolved

- [x] Key-down, key-up, modifiers and supported shortcuts reach only the selected Bot Screen through its virtual keyboard.
- [x] One-way plain-text paste injects user-provided text without reading or synchronizing the Bot Screen clipboard.
- [x] A new control connection replaces the previous connection, increments the controller epoch, and causes all late input from the previous epoch to fail.
- [x] Revocation, blur, visibility loss, navigation, disconnect and helper failure release every held key and button before another controller can act.
- [x] Diagnostics retain only local semantic action metadata and outcomes for seven days; typed/pasted text, raw key characters, frames, screenshots, lease tokens and raw controller identifiers are never stored.
- [x] Browser and integration coverage proves shortcuts, paste, controller replacement, stale-epoch rejection, held-input cleanup, and redacted retention expiry.

## Answer

The projection control protocol now sends ordered key transitions and one-way plain-text paste to the owning virtual keyboard, replaces controllers by epoch, and releases held input before ownership changes; `inputDiagnostics` retains only redacted semantic outcomes for seven days. Focused projection integration proves shortcuts, paste, stale-epoch rejection, replacement and helper-failure cleanup, and retention expiry; browser coverage proves expanded-only keyboard/paste behavior and blur release, while the real Hyprland smoke includes a Unicode paste.
