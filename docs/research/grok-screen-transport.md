# Grok Bot screen and input transport

Research date: 2026-09-04

Investigated sources: official SpaceXAI / xAI Grok Bot docs, the public `x.ai/bot` first-party page and hashed Next.js bundles, `xai-org/grok-build` at commit `72a6125` (2026-09-01, "Synced from monorepo"), the Agent Client Protocol (ACP) v1 overview, and the noVNC project README. This repository's WebRTC projection code is cited only for comparison. No production Grok Bot desktop/mobile binary was unpacked.

## Direct answer: does Grok Bot use VNC?

**The claim is a strong first-party inference, not a production-verified pixel-path fact, and it is disproven for the public marketing demonstrator.**

| Claim | Status |
| --- | --- |
| Grok Bot's **client-facing Bot Relay** API exposes a short-lived **noVNC descriptor** (`bot.vncDescriptor` → `vncUrl`) | **Verified** in `xai-org/grok-build` [B1] [B2] [B3] |
| Official Grok Bot **product docs** name VNC, noVNC, RFB, WebSocket, or WebRTC as the screen protocol | **Absent** — docs describe preview and takeover, not a wire protocol [C1] [G1] [F1] |
| The public **`x.ai/bot` demonstrator** is a live VNC/noVNC session | **Disproven** — first-party bundle drives a scripted CSS `RemoteDesktopViewport`, not RFB [P1] [P2] [P3] |
| Grok Build **ACP** (`grok agent stdio`) streams a Bot screen | **Disproven** — ACP here is JSON-RPC agent I/O; Grok Bot screen is a separate Bot Relay verb [A1] [A2] [B1] [T1] |
| Production Grok Bot apps actually speak RFB over a noVNC WebSocket to that `vncUrl` | **Unknown** — the URL field and "noVNC descriptor" comment are first-party; the shipping viewer was not inspected [B2] [N1] |
| Production screen uses WebRTC | **No public first-party evidence found** in docs or grok-build screen APIs [C1] [B1] [H1] |

**Do not copy an unverified transport.** Omarchy Bot already has a documented WebRTC data-channel frame path. Treat Grok's `vncUrl` as evidence of *intent and naming* in the open harness, not as a spec to reimplement.

## Verified facts

### Product docs describe a preview and takeover, not a protocol

xAI's computer docs say every Bot on an account shares one persistent cloud computer, each Bot has its own screen, work can be watched from **Agent Computer**, leaving the preview does not stop cloud work, and the user may take over for passwords, 2FA, CAPTCHAs, payments, or human-required sites. [C1] [F1] [G1]

Those pages never mention VNC, noVNC, RFB, WebRTC, WebSocket, SDP, or screenshot polling. Security pages discuss network policy, hibernation, and computer recovery, not screen codecs. [S1]

### Bot Relay names a noVNC descriptor

In `xai-tool-protocol` (crate version `0.1.0`, grok-build `72a6125`), method `bot.vncDescriptor` is documented as a **"Short-lived noVNC descriptor. May wake a hibernated box."** [B1]

It is advertised in `BOT_RELAY_CAPABILITIES` next to `bot.command`, roster/status/transcript, and subscribe/event verbs. [B2]

Params are `{ agentId }`. The result is:

- `vncUrl` (`String`, camelCase `vncUrl` on the wire)
- `expiresHint` (unix milliseconds, or `null` for a "legacy network-token URL (valid until pod migration)"; a concrete value is "the port-token expiry the client should refresh before") [B2] [B3]

Fixture result: `"vncUrl": "https://example.invalid/vnc"`, `"expiresHint": null`. [B3]

That is first-party naming of **noVNC** plus an **HTTPS URL** the client is expected to fetch/refresh. It is not a dump of RFB bytes in the JSON-RPC result.

noVNC's own project states it is an HTML VNC client that follows standard VNC (RFB) and **requires WebSockets** (often via websockify if the VNC server is TCP-only). [N1] Mapping `vncUrl` onto that stack is the natural reading of the grok-build comment; it is still an inference until a production viewer is observed.

### Grok Build ACP is not the screen pipe

Official Grok Build docs: use ACP for IDE/tool integration via `grok agent stdio` (JSON-RPC on stdin/stdout). The documented example uses `initialize`, `authenticate`, `session/new`, `session/prompt`, and `session/update` text chunks. Client capabilities in the example are `fs` and `terminal`. [A1]

ACP v1's baseline/optional methods are session, file, permission, and **terminal** operations — not a remote-desktop or VNC method. [A2]

Grok Build's in-tree `computer` module is a **local filesystem and terminal backend**, not a display server. [T1]

Hub-synthesized Grok Bot **harness tools** are agent create/list/prompt/transcript/await — not screen or VNC. [T2]

Computer Hub SDK multiplexes **tool-server JSON-RPC over one WebSocket per `(url, principal)`**. That WebSocket is the hub control plane, not a documented framebuffer. [H1]

### Public x.ai/bot screen is a fake desktop

The official product page ships an interactive marketing demonstrator. [P1]

The first-party bundle:

- Lazy-loads a component named `RemoteDesktopViewport` with `ssr: false`. [P2]
- Renders compact Computer cards and expanded "`<name>`'s screen" overlays with 16:10 aspect ratio, takeover banner, and "I'm done, continue." [P3]
- Fills the viewport with **scripted CSS mini-windows** (`crmPortalWindows`, wallpaper URLs), not a network framebuffer. [P2] [P3]

That disproves "the public demo is VNC." It does not disprove production use of `bot.vncDescriptor`.

## Strong inferences

1. **Interactive human viewing/control is intended to go through a short-lived noVNC URL per agent**, not through ACP and not through the model-facing `bot_*` tools. Evidence: method comment, capability list, `agentId` scoping, hibernate-wake note, token expiry. [B1] [B2]
2. **`vncUrl` is expected to be opened by a first-party app/web viewer**, possibly noVNC or a wrapper that still uses RFB-over-WebSocket behind HTTPS. Evidence: HTTPS example URL + noVNC's WebSocket requirement. [B3] [N1]
3. **Computer-use for the model** (clicks, typing, screenshots as tool results) is a separate plane from **human screen delivery**. Product docs talk about watching a preview and taking over; grok-build computer tools are local bash/FS; Bot Relay `bot.command` is an untyped passthrough of gateway commands. [C1] [T1] [B2]
4. **Screenshot polling is not the documented human viewer.** Nothing in Bot Relay returns image bytes for `bot.vncDescriptor`. A PNG `screenshot` example exists only as a **tool-output render fixture** (`"screenshot": {"type": "image", "mime_type": "image/png", ...}`), i.e. model/tool content, not a live desktop stream. [R1]

## Unknown production internals

No public first-party source inspected on 2026-09-04 specifies:

- whether the shipping macOS/Windows/Linux/iOS/Android Grok Bot apps embed noVNC, a custom RFB client, or a different player pointed at `vncUrl`;
- whether the URL's origin terminates RFB, websockify, or an HTTP page that then opens a WebSocket;
- encoding (Tight, TightPNG, JPEG, H.264, etc.) or FPS for preview vs takeover;
- whether compact preview is a slow VNC session, a still image, or something else;
- any WebRTC / SDP path in Grok Bot production;
- how per-Bot screens are isolated inside the shared VM (separate X/Wayland displays vs VNC desktops vs compositor workspaces).

The Grok Bot desktop/mobile binaries and authenticated API were not in scope.

## Comparison to Omarchy Bot (this repository)

Omarchy Bot's current screen path is **explicitly WebRTC data channels carrying JPEG/PNG frame chunks**, not RFB and not a WebRTC *media* track.

| | Grok Bot (public first-party) | Omarchy Bot (this repo) |
| --- | --- | --- |
| Human screen API | `bot.vncDescriptor` → `vncUrl` (named noVNC) [B2] | HTTP SDP offer/answer; `transport: "webrtc-data-channel-frames-v1"` [O1] [O2] |
| Frame delivery | Unknown in production; marketing demo is CSS [P2] | Ordered data channel `screen.frames.v1`; header then binary chunks [O1] [O2] |
| Preview | Docs: conversation-launched Agent Computer preview [C1] | Mode `preview`: ~1 FPS (`PREVIEW_INTERVAL_MS = 1000`), read-only [O2] |
| Expanded / takeover | Docs: take control, then return control [C1] [G1] | Mode `expanded`: higher FPS (`1000 / expandedFrameRate`); input only on `screen.input.v1` when expanded [O2] |
| Input | Unknown wire (if noVNC: RFB pointer/key) [N1] | JSON pointer/key/paste on `screen.input.v1`; authority messages [O1] [O2] |
| Signaling | JSON-RPC Bot Relay over the Computer Hub WebSocket for the *descriptor*; actual pixels unspecified [H1] [B2] | `RTCPeerConnection` + POST offer; ICE with empty `iceServers` [O3] [O2] |

Implications for Omarchy Bot: matching Grok's **product UX** (compact preview vs expanded takeover, per-Bot screen) does not require matching VNC. Copying noVNC/RFB would be copying an **unverified production pixel path**. Keep Omarchy's existing WebRTC data-channel contract unless a later authenticated observation of Grok production contradicts the grok-build descriptor.

## Sources

All sources accessed 2026-09-04 unless noted.

- [C1] xAI, [Use the computer and apps](https://docs.x.ai/grok-bot/computer-and-apps) — shared computer, per-Bot screens, preview, takeover.
- [F1] xAI, [Frequently asked questions](https://docs.x.ai/grok-bot/faq) — one screen per Bot; one computer-use task per Bot screen.
- [G1] xAI, [Get started](https://docs.x.ai/grok-bot/get-started#5-sign-in-to-the-tools-it-needs) — open Agent Computer, take over, return control.
- [S1] xAI, [Grok Bot security](https://docs.x.ai/grok-bot/security) — hosting/hibernation; no screen-protocol section.
- [A1] xAI, [Headless & Scripting — ACP](https://docs.x.ai/build/cli/headless-scripting) — `grok agent stdio`; initialize / session/prompt / session/update.
- [A2] Agent Client Protocol, [Overview (v1)](https://agentclientprotocol.com/protocol/v1/overview) — JSON-RPC; terminals, not remote desktop.
- [P1] xAI, [Grok Bot product page](https://x.ai/bot) — official interactive demonstrator.
- [P2] xAI product-page bundle, [computer card / RemoteDesktopViewport lazy load](https://x.ai/_next/static/chunks/3ovf5qn1saq-q.js?dpl=fabac5edbfe6850288c66466d486bbe42867a28e) — volatile hashed URL.
- [P3] xAI product-page bundle, [expanded screen overlay](https://x.ai/_next/static/chunks/3kfz4r8um6_zx.js?dpl=fabac5edbfe6850288c66466d486bbe42867a28e) — volatile hashed URL.
- [B1] `xai-org/grok-build` `72a6125`, `crates/common/xai-tool-protocol/src/methods.rs` — `BotVncDescriptor => "bot.vncDescriptor"`.
- [B2] same commit, `crates/common/xai-tool-protocol/src/bot_relay.rs` — capabilities, `BotVncDescriptorResult`, expiry comments.
- [B3] same commit, `crates/common/xai-tool-protocol/fixtures/bot_relay/method_vnc_descriptor_result.json`.
- [T1] same commit, `crates/codegen/xai-grok-tools/src/computer/local/mod.rs` — local FS/terminal backend.
- [T2] same commit, `crates/common/xai-computer-hub-core/src/bot_tools.rs` — `GROK_BOT_TOOL_IDS`.
- [H1] same commit, `crates/common/xai-computer-hub-sdk/src/lib.rs` — WebSocket tool multiplex.
- [R1] same commit, `crates/common/xai-tool-runtime/src/render.rs` — example tool output `screenshot` image (not a viewer stream).
- [N1] noVNC, [README](https://github.com/novnc/noVNC/blob/master/README.md) — HTML VNC client; RFB over WebSockets.
- [O1] this repo, `packages/protocol/src/api.ts` — `webrtc-data-channel-frames-v1`, channel names, frame header.
- [O2] this repo, `apps/daemon/src/modules/computer/screenProjection.ts` — capture, preview interval, expanded input.
- [O3] this repo, `apps/web/src/lib/screenProjection.ts` — browser `RTCPeerConnection` + data channels.
