# 01: Route Bot work to the Shared Workspace

**What to build:** A Bot without an explicit working-directory choice works in the same home-local Shared Workspace as every other Bot, regardless of where the plugin was launched. New conversations, continued work, and existing internal Agent entry points use an intentional work context without merging Native Sessions or moving the user's existing files.

**Blocked by:** None (can start immediately).

**Status:** resolved

**Source specification:** [Shared Workspace and Bot Desktop Boundary Correction](../spec.md).

**Specification coverage:** Stories 4, 5, 9–25, 89.

- [x] The accepted shared default is resolved once through existing configuration/session initialization, rather than inferred separately from the daemon launch directory in different callers. No per-Bot workspace entity, project manager, or workspace-selection UI is introduced.
- [x] Fresh preparation creates the shared directory when needed; repeated preparation reuses it without truncating or importing contents. It works without Git metadata.
- [x] User messages to two Bots, including Bots backed by the same Agent, result in the same default cwd and distinct Native Sessions. New Threads inherit the shared default without creating another work-file directory.
- [x] Launching and restarting an isolated daemon from different directories does not change the default or cause work to land in plugin source or installed program files.
- [x] Ordinary session opens, supported resumes, existing target-Bot mail turns, and utility Agent-session entry points no longer silently inherit the daemon's launch directory when no intentional context is supplied. Instructions, model configuration, mailbox semantics, and session identity remain unchanged.
- [x] Supported computer-worker application launches receive an intentional work context rather than an accidental plugin cwd. This ticket can verify that context through the existing worker/launch seam with a non-graphical fixture; it does not require the real Screen startup repair to be complete.
- [x] Explicit existing Thread cwd choices remain intact, even when equal to a plugin directory. Native continuation follows the backend's supported semantics; it does not erase or substitute a fresh session to fabricate a successful cwd change.
- [x] Workspace preparation/access failure is explicit and never falls back into the source, install, or another unrelated directory. Existing files are preserved on failure.
- [x] Agents retain native file-access and command behavior. The plugin adds no file locks, task locks, shared-filesystem serialization, Git worktrees, repository creation, or file-authorship tracking.
- [x] Deleting a Bot preserves shared-file sentinels and Agent-owned Native Sessions. Existing conversation databases, managed media, and application data are not relocated; the future memory directory does not acquire an implementation.
- [x] Tests drive the real daemon's public message/session workflow and inspect existing worker observations, rather than only testing a private cwd helper. Fixtures use temporary homes/workspaces and verify shared output plus untouched source/install sentinels.
- [x] Verification includes fresh use, reuse, multiple Bots/Threads, explicit-directory continuation, target-Bot mail, restart, access failure, and shared-file survival after deletion. A supplied resume option is not reported as effective backend behavior without appropriate adapter evidence.
- [x] The final evidence describes the changed public behavior and any genuinely unsupported native continuation case without claiming a desktop startup, resource, or host-safety fix.

## Scope

This ticket is the complete default-work-directory cutover, not a browser-state or storage-migration project. Preserve the existing daemon/Agent interfaces where possible and migrate every implicit-default caller in the same slice. Real graphical isolation, projection cleanup, and production host checks belong to their own tickets; no host package updates or graphical-session changes are authorized here.

## Answer

Ordinary turns, mailbox target-Bot turns, avatar recipe sessions, and supported `open_app` launches now use one Shared Workspace at `~/.omarchy-bot/workspace` under the live user home (`HOME`, then `os.homedir()`). The directory is created on first implicit use and reused without truncation, import, or Git. Explicit Thread cwd values are passed through unchanged, including when they equal a plugin path. Two Bots on the same Agent get the same default cwd and distinct Native Sessions. Launch directory and daemon restart do not change the default. Preparation/access failure fails the Turn with `Shared Workspace is unavailable` and never falls back to source, install, or `process.cwd()`. Bot deletion leaves shared-file sentinels and product data in place; `~/.omarchy-bot/memory/` is still unimplemented.

Continued Threads use `session.resume` and still supply the resolved cwd in worker options. That is only proof that the daemon asked for the directory; it is not evidence that a real Agent backend relocated an existing Native Session. Desktop startup, Cage projection, resource cost, and host-safety repairs are unchanged by this ticket.

Validation:

- `bun run typecheck` — passed (`tsc --noEmit`)
- `bun test tests/integration/shared-workspace.test.ts` — 9 pass
- `bun test tests/integration/computer-worker-launch.test.ts` — 1 pass
- `bun test tests/integration/bot-mailbox.test.ts` — 15 pass, including the target-Bot default cwd observation
- `bun test tests/integration/permanent-deletion.test.ts` — 8 pass, including the Native Session survival probe cwd
