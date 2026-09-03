# 06: Dictate with Voxtype

**What to build:** Integrate the Composer microphone with the installed Voxtype daemon so speech becomes editable text in the originating Composer Draft, with an optional explicit application setting for automatic send.

**Blocked by:** 04: Navigate Thread history and preserve window drafts

**Status:** resolved

- [x] The daemon reports Voxtype availability and idle, recording, and transcribing states through a typed public contract.
- [x] Starting app-owned dictation uses a unique runtime transcript target and disables Voxtype synthetic auto-submit for that recording.
- [x] Stopping waits for the documented JSON result and distinguishes success, silence, timeout, failure, and unavailable daemon.
- [x] A successful transcript is inserted at the originating draft's insertion point without replacing existing text.
- [x] Switching Bot or Thread during transcription cannot redirect the result.
- [x] Escape cancels recording; empty, cancelled, timed-out, and failed recordings never alter or send the draft.
- [x] Voice auto-send is a visible setting, defaults off, and sends through the owning Thread's normal send/steer command only after successful insertion.
- [x] Omarchy Bot retains no raw audio and cleans its runtime transcript artifacts.
- [x] Existing Omarchy Voxtype shortcuts and user configuration remain unchanged.

## Answer

- `DictationService` invokes only argument-array `record start`, `record stop`, and `record cancel` commands, bounds subprocess waits, publishes state-only events, and removes both transcript and `.done` artifacts on stop, cancel, failure, timeout, and shutdown.
- `handleDictationRequest` provides the isolated GET/start/stop/cancel HTTP route group, including the active-recording conflict response.
- `ChatPanel` binds the Bot, Thread, draft, and cursor at recording start; successful results return to that stored draft, while Escape and non-success results preserve it without sending.
- `VoiceSettingsControl` and `useVoiceAutoSendSetting` provide an explicit browser-local, off-by-default auto-send preference.
