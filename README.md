# omarchy-bot

Nine coding agents, nine persistent multi-role Bots, one Omarchy Linux computer. Each Bot chats, runs tools, and — when granted the exclusive computer lease — drives the real desktop. Everything else (files, threads, tasks, approvals, screenshots) lives server-side in a single daemon.

**Current status: M1 / Gate 1 — Pi Bot + shared Computer.** See `docs/go-no-go.md` for the gate definitions.

## Architecture

```
┌──────────────┐   HTTP/WS :7321   ┌─────────────────────────────────────────┐
│  apps/web    │ ────────────────► │  apps/daemon (:7321)                    │
│  React+Vite  │                   │  ├─ modules/bots      Bot registry      │
│  Astryx UI   │                   │  ├─ modules/threads   transcript store  │
└──────────────┘                   │  ├─ modules/tasks     runner + state    │
                                   │  ├─ modules/permissions fail-closed     │
┌──────────────┐                   │  ├─ modules/computer ComputerBroker     │
│ human (any   │ ────────────────► │  └─ supervision/*     worker clients    │
│ browser)     │                   └───────────┬─────────────────────────────┘
└──────────────┘                               │ LF-JSONL stdio
                                               ▼
                                   ┌────────────────────────┐
                                   │ workers/pi             │ pi SDK → real model
                                   │ workers/computer       │ computer-use-linux MCP
                                   └────────────────────────┘
```

- **`packages/domain`** — Bot/Task/Run/lease state machines, INPUT/SENSITIVE action sets.
- **`packages/agent-contract`** — worker framing (LF-JSONL, heartbeats) + worker protocol unions.
- **`packages/protocol` / `packages/api-client`** — daemon REST/WS surface + typed client.
- **`apps/daemon`** — sole SQLite writer; spawns workers as child processes; fail-closed permissions; lease arbitration; emergency stop.
- **`workers/pi`** — Pi SDK 0.84.4 adapter: streaming deltas, tool lifecycle, permission gate (`ask`/`trusted`), abort, session resume by native session file, attachments.
- **`workers/computer`** — computer-use-linux MCP adapter: observe/screenshot un-gated; every input action requires the exclusive lease token (ADR-0001); `open_url` additionally needs human approval.
- **`apps/web`** — sidebar of bots, chat with streaming + tool cards + approval cards, Computer panel (snapshot, lease holder, Take over / I'm done, emergency stop).

## Quick start

Requirements: Bun 1.4+, a configured `pi` CLI (`pi` run once so `~/.pi/agent/auth.json` exists), and the repo's other agents stay unavailable until their conformance passes (M2).

```bash
bun install
bun run dev          # daemon on :7321, web on :7322 (Vite → localhost only)
```

Open `http://localhost:7322`. The Pi Bot appears as `ready` once its conformance record exists; chat streams through the real model.

### Tests

```bash
bun test                    # domain unit tests + integration suite (fake workers, real daemon)
bun test tests/conformance  # 10-step Pi conformance — REAL model calls (~1–2 min)
```

The conformance suite writes `~/.local/share/omarchy-bot/conformance/pi-<version>.json` on success; delete that file to force a recheck. A Bot without a passing record for its current version is `unconfigured` — the API refuses chat with a 500 and the UI hides the composer.

### Production (systemd user service)

The repo ships `omarchy-bot.service`; it is **not** installed by default. To install:

```bash
cp omarchy-bot.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now omarchy-bot
```

Data lives in `~/.local/share/omarchy-bot/` (SQLite state, artifacts, conformance records). State under `~/.local/state/omarchy-bot/`.

## Safety model (Gate 1 checklist)

- **Lease**: one exclusive computer lease; bots need it for every input action (click/type/key/scroll/focus/open_app); observe + screenshot are read-only and un-gated. Verify: `tests/integration` broker tests + conformance step 10.
- **Permissions**: agent tool requests create approvals; default deny; denial never crashes the daemon (fail-closed). Verify: integration permission tests + conformance step 4.
- **Action needed**: pending approvals/sensitive actions surface in the UI and block the run until answered.
- **Take over / I'm done**: human take-over revokes bot input mid-run (`waiting_for_input`); I'm done re-observes and hands the lease back.
- **Abort**: `POST /api/tasks/:id/abort` cancels the turn; non-completed turns always leave a system note; no late tool calls accepted.
- **Emergency stop**: blocks all computer input until resumed.
- **Restart safety**: daemon restart never restores a bot-held lease (DB single-row lease, human-takeover on restore).

## Layout

```
apps/daemon     HTTP/WS server + modules + supervision
apps/web        React 19 + Vite + Astryx + TanStack Router/Query
packages/       domain · agent-contract · protocol · api-client · testkit
workers/pi      Pi SDK worker (agent:pi)
workers/computer computer-use-linux worker
tests/          integration (fake workers) · conformance (real pi)
docs/           Chinese design docs (authoritative)
```

## Environment variables

| Variable | Meaning | Default |
| --- | --- | --- |
| `OMARCHY_BOT_HOME` | data dir (SQLite, artifacts, conformance) | `~/.local/share/omarchy-bot` |
| `OMARCHY_BOT_STATE` | runtime state dir | `~/.local/state/omarchy-bot` |
| `OMARCHY_BOT_PORT` | daemon port (`0` = random) | `7321` |
| `OMARCHY_BOT_WORKERS_DIR` | override workers root | `<repo>/workers` |
| `OMARCHY_BOT_LEASE_TTL_MS` / `OMARCHY_BOT_APPROVAL_TIMEOUT_MS` / `OMARCHY_BOT_TURN_TIMEOUT_MS` | timings | 120000 / 300000 / 600000 |
