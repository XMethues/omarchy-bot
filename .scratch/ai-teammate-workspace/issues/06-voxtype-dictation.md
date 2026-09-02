# 06: Dictate with Voxtype

**What to build:** Integrate the Composer microphone with the installed Voxtype daemon so speech becomes editable text in the originating Composer Draft, with an optional explicit application setting for automatic send.

**Blocked by:** 04: Navigate Thread history and preserve window drafts

**Status:** ready-for-agent

- [ ] The daemon reports Voxtype availability and idle, recording, and transcribing states through a typed public contract.
- [ ] Starting app-owned dictation uses a unique runtime transcript target and disables Voxtype synthetic auto-submit for that recording.
- [ ] Stopping waits for the documented JSON result and distinguishes success, silence, timeout, failure, and unavailable daemon.
- [ ] A successful transcript is inserted at the originating draft's insertion point without replacing existing text.
- [ ] Switching Bot or Thread during transcription cannot redirect the result.
- [ ] Escape cancels recording; empty, cancelled, timed-out, and failed recordings never alter or send the draft.
- [ ] Voice auto-send is a visible setting, defaults off, and sends through the owning Thread's normal send/steer command only after successful insertion.
- [ ] Omarchy Bot retains no raw audio and cleans its runtime transcript artifacts.
- [ ] Existing Omarchy Voxtype shortcuts and user configuration remain unchanged.
- [ ] Fake-Voxtype integration tests cover every documented outcome, and browser E2E covers the Composer states.
