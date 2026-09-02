# Voxtype Composer integration

Research question: how should omarchy-bot use Omarchy's supported Voxtype installation so dictation edits the current Composer draft but never sends a message by itself?

## Findings

### The user-facing invariant is correct

Voxtype is desktop dictation, not an Agent transport. Its normal output mode types or pastes a transcript into the currently focused control. It does not call an Agent. Auto-submit is a separate option and is off by default in Omarchy's configuration.

The observed Grok Bot interaction follows the same model: clicking voice records and transcribes speech into the Composer input; the user reviews or edits that text and explicitly sends it to the Agent. Voice is therefore an input method, not a voice-message transport or an automatic send action.

Omarchy ships two compositor bindings:

- `Super + Ctrl + X`: toggle dictation
- `F9`: start on press and stop on release

Omarchy disables Voxtype's own evdev hotkey because Hyprland owns these bindings. With normal type output, the Composer must have focus when Voxtype emits the transcript. This path should continue to work without any omarchy-bot-specific configuration.

Sources: Omarchy's installed defaults at `/usr/share/omarchy/default/hypr/bindings/voxtype.lua` and `/usr/share/omarchy/default/voxtype/config.toml`; [Voxtype v1.0.0 README](https://github.com/peteonrails/voxtype/blob/v1.0.0/README.md).

### Voxtype has a stable contract for application-owned dictation

Voxtype v1.0.0 explicitly documents integration with desktop shells and AI agent harnesses. An application that wants the text for itself should use per-recording file output and wait for the final result:

```sh
transcript="${XDG_RUNTIME_DIR:-/tmp}/omarchy-bot/dictation/<recording-id>.txt"
rm -f "$transcript"

voxtype record start \
  --file="$transcript" \
  --no-auto-submit \
  --no-smart-auto-submit

# The user speaks.

voxtype record stop --wait --json --wait-file "$transcript"
```

The stop command returns one machine-readable outcome:

- `ok` (exit 0): transcript is in `text`
- `empty` (exit 3): no speech or recording too short
- `timeout` (exit 4): no result within the configured timeout
- `error` (exit 1): transcription or file output failed

Using `--wait` is preferable to polling the transcript file. Silence and write failure intentionally produce no transcript file, so polling cannot distinguish them from work still in progress. The CLI completion protocol can.

The per-recording flags do not mutate `~/.config/voxtype/config.toml`. Voxtype specifically asks integrations not to edit the user's configuration.

Source: [Voxtype v1.0.0 integration contract](https://github.com/peteonrails/voxtype/blob/v1.0.0/docs/INTEGRATIONS.md).

### This machine supports the contract

Observed locally:

- Omarchy `4.0.2-1`
- Voxtype `1.0.0-2`
- `voxtype.service` is active and reports `idle`
- `voxtype record stop --help` exposes `--wait`, `--json`, `--timeout`, and `--wait-file`
- the active engine is `sensevoice`
- global `output.auto_submit` and `text.smart_auto_submit` are both `false`

The apparent `translate = true` setting is under `[whisper]`. It applies to the Whisper engine only. The active `[sensevoice]` configuration has `language = "auto"`, so this setting does not translate SenseVoice's Chinese transcript into English.

### A browser cannot safely launch Voxtype directly

The web UI has no supported browser API for launching arbitrary host commands. Giving the browser shell access or depending on a custom URL scheme would add unnecessary security and deployment surface.

omarchy-bot already has a localhost-only daemon (`127.0.0.1`) that serves both its REST/WebSocket API and production web assets. That daemon runs in the user's desktop session and is the appropriate bridge to Voxtype.

### Keyboard injection and application integration can coexist

There are two valid paths with the same product semantics:

1. **Omarchy shortcut:** Voxtype types into the focused Composer. This remains useful system-wide and requires no app API.
2. **Composer microphone button:** the daemon requests file output for one recording, receives the transcript through Voxtype's integration contract, and the web UI inserts it into the draft.

Both paths only edit the draft. Neither sends a message. The second path is more reliable for a visible microphone button because it does not depend on focus remaining unchanged while transcription finishes.

## Recommendation

### Product behavior

Treat voice as an input method, not as an attachment or message type.

- One click on the microphone starts recording.
- A second click stops recording and begins transcription.
- The button has `idle`, `recording`, `transcribing`, and `unavailable/error` states.
- `Escape` while recording cancels and discards the recording.
- A successful transcript is inserted into the originating Composer draft at its current insertion point, with sensible whitespace. Existing draft text is preserved.
- By default, the user reviews or edits the transcript and explicitly presses Send, matching the observed Grok Bot behavior.
- Offer a user setting, **Auto-send voice transcriptions**, for people who prefer Voxtype's auto-submit workflow. When enabled, omarchy-bot inserts the completed transcript and then performs the same send action as the Composer. If the Bot is already working, that message becomes a native steer.
- Empty speech leaves the draft unchanged and is never sent, even when auto-send is enabled; show a quiet “No speech detected” status.
- Raw audio is not uploaded, attached to the Thread, or retained by omarchy-bot.
- Omarchy's own Voxtype OSD and global shortcuts continue to work. omarchy-bot does not edit the user's Voxtype configuration.

Click-to-toggle is preferable to pointer-held push-to-talk for the on-screen control: it is keyboard-accessible and does not risk a lost pointer-up event. Users who prefer push-to-talk retain Omarchy's `F9` binding.

### Daemon boundary

Add a small `DictationService` to the daemon. It should own all process execution and enforce one active recording because Voxtype has one user-session recorder.

Suggested API shape:

```text
GET  /api/dictation
POST /api/dictation/start
POST /api/dictation/stop
POST /api/dictation/cancel
```

Suggested states:

```text
unavailable | idle | recording | transcribing
```

`start` returns an opaque recording ID. `stop` and `cancel` require that ID. A second start receives `409 Conflict`. Do not expose transcript paths to the browser.

Implementation rules:

1. Probe `voxtype status --format json` and support for `record stop --wait` rather than assuming an installed version.
2. Spawn `voxtype` with an argument array; never interpolate arguments into a shell command.
3. Allocate a unique transcript path beneath `$XDG_RUNTIME_DIR/omarchy-bot/dictation/`, remove any stale path before starting, and clean transcript/completion files after every outcome.
4. Start with `--file=<path> --no-auto-submit --no-smart-auto-submit`. Even when the app's auto-send setting is enabled, keep these Voxtype flags: file output returns text to the owning Thread, while Voxtype auto-submit only simulates Return in typing/paste modes.
5. Stop with `--wait --json --wait-file <path>` and parse both JSON status and documented exit code. Insert the successful transcript first, then invoke the normal Composer send command only when the app setting is enabled.
6. Cancel with `voxtype record cancel` and terminate any outstanding wait owned by the service.
7. Bound subprocesses with timeouts and map unavailable daemon, conflict, empty speech, timeout, and transcription failure to typed protocol errors.
8. On daemon shutdown, cancel a recording owned by omarchy-bot and remove its runtime files.

The service should keep a `voxtype status --follow --format json` watcher (or re-probe before each command) so it can detect recording started outside omarchy-bot. It may publish non-sensitive dictation state through the existing WebSocket event stream so multiple tabs stay consistent. Transcript text should be returned only to the client that owns the recording, not broadcast in the general event log.

### Draft ownership

Bind a recording to the Bot/Thread draft that started it, not whichever conversation happens to be selected at completion time.

- If the user changes Bots while transcription runs, place the transcript back in the originating draft and preserve the other draft.
- Keep unsent drafts keyed by Thread (and a temporary key for a newly created blank conversation).
- If the originating draft disappears, retain the transcript in a recoverable local draft rather than silently inserting it into another Bot's conversation.

This avoids a late transcript crossing conversation boundaries.

### Availability and conflicts

- If Voxtype is not installed, its daemon is stopped, or `--wait` is unsupported, disable the microphone and show plain-language setup guidance. Do not silently fall back to browser speech recognition.
- If Voxtype is already recording outside omarchy-bot, disable start and explain that dictation is active elsewhere.
- If an external Omarchy shortcut interrupts an app-owned recording, report the resulting state honestly and preserve any completed transcript; never send it automatically.

## Rejected alternatives

### Focus-only microphone integration

Having the microphone button run normal `voxtype record start/stop` and hoping the textarea remains focused is fragile. Clicking the button itself changes focus, navigation can occur during transcription, and output could land in another application. Keep focus-based typing for the existing global shortcuts, not for the app-owned button.

### Browser audio capture and a second speech-to-text stack

`MediaRecorder`, audio upload, and a separate transcription service duplicate Voxtype, introduce browser microphone permissions, and change the local-first privacy model. They are unnecessary on the supported Omarchy host.

### Clipboard polling

Clipboard ownership is global, can overwrite user data, and has no reliable completion/error protocol. Voxtype's file-plus-`--wait` contract is purpose-built for this integration.

### Simulated-keyboard auto-submit

Passing Voxtype `--auto-submit` is not appropriate for the app-owned file integration. In Voxtype v1.0.0, file output returns before the typing/paste output chain that presses Enter, so the flag cannot submit this recording. Depending on a synthetic Return would also reintroduce focus and wrong-conversation risks.

This does not rule out auto-send as a product preference. omarchy-bot can offer **Auto-send voice transcriptions** and execute its normal typed, Thread-scoped send command after receiving a successful transcript. The setting should default off to match Grok Bot and must be visible to the user rather than inferred from focus.

## Decision

Use Voxtype as the sole speech-to-text provider. Preserve Omarchy's native focused-control shortcut behavior, and implement the Composer microphone through the localhost daemon using Voxtype's documented per-recording file output and `record stop --wait --json` contract. The default result is editable draft text and explicit sending, matching Grok Bot. A user may opt into **Auto-send voice transcriptions**; omarchy-bot then sends through the originating Thread's normal command path rather than asking Voxtype to synthesize Return.
