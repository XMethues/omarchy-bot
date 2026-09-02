# TanStack AI and the Omarchy Bot chat architecture

Research question: should Omarchy Bot replace its current Astryx-based conversation composition or selectively adopt TanStack AI's client, runtime, transport, persistence, UI, media, or developer-tooling layers?

## Decision summary

**KEEP ASTRYX. Adopt no TanStack AI package in the current architecture.**

TanStack AI is a capable end-to-end stack when it owns the provider/runtime, AG-UI stream, `UIMessage` transcript, run lifecycle, client hydration, and chat hook. Its new React UI factory is genuinely headless and type-safe, but it supplies no visible UI or accessibility behavior; it dispatches an already-TanStack-owned `UseChatReturn` into application-supplied components. Omarchy Bot would still need every Astryx visual primitive and every product-specific behavior, while also translating its daemon-owned `MessageDto`/`EventEnvelope` model into TanStack's state machine.

The decisive blocker is mid-turn input. Omarchy Bot must call the selected Agent's **native steer** operation at a safe boundary without aborting the active turn. TanStack's busy-send choices are `queue`, `drop`, and `interrupt`; its `interrupt` explicitly aborts the current stream before sending, while its separate human-in-the-loop “interrupt” model ends one run and starts a continuation. Neither is native steering. [TanStack queue source](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-client/src/types.ts#L422-L491) · [TanStack interrupt lifecycle](https://tanstack.com/ai/latest/docs/interrupts/overview) · local steering path: `apps/daemon/src/modules/turns/turns.ts` and `workers/pi/src/worker.ts`.

A wholesale adoption would therefore require a new wire protocol, a second or replacement persistence model, lossless event translation, and a custom steering extension. Selective use of only the UI factory would require a `UseChatReturn` facade and a second message model. Both violate the replacement criterion: TanStack cannot own the required behavior without parallel state machines or transport workarounds.

## Investigated snapshot and packages

This note uses the official `latest` documentation and TanStack AI source commit [`416a4e34`](https://github.com/TanStack/ai/tree/416a4e34bb2728529a3cdc598e0469f356121732), inspected on 2026-09-02. The relevant source package versions at that commit are:

- `@tanstack/ai` **0.52.1** — provider/runtime, `chat()`, tools, stream events, response helpers;
- `@tanstack/ai-client` **0.30.0** — framework-independent `ChatClient`, connection adapters, message assembly, queues, interrupts, client persistence;
- `@tanstack/ai-react` **0.23.0** — `useChat` and the `@tanstack/ai-react/ui` subpath;
- `@tanstack/ai-persistence` **0.5.5** — server-side persistence middleware and stores;
- `@tanstack/react-ai-devtools` **0.2.71** — the React Devtools plugin.

Sources: [core package](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai/package.json), [client package](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-client/package.json), [React package](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-react/package.json), [persistence package](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-persistence/package.json), and [React Devtools package](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/react-ai-devtools/package.json).

Do not install the separate `@tanstack/ai-react-ui` package. It is deprecated from 0.9.0, re-exports `@tanstack/ai-react/ui`, and is scheduled for removal at 1.0.0. The legacy `Chat`, `ChatMessages`, `ChatMessage`, `ChatInput`, `ToolApproval`, `TextPart`, and `ThinkingPart` exports continue on the `/ui` subpath, but the typed `createChatHook` factory is the new API evaluated here. [Official migration guide](https://tanstack.com/ai/latest/docs/migration/create-ui) · [deprecated package README](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-react-ui/README.md).

React itself is not a blocker: `@tanstack/ai-react` declares React, React DOM, and React types `>=18.0.0`, while this app uses React 19. [React package peer dependencies](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-react/package.json#L75-L81) · local `apps/web/package.json`.

## Current ownership boundary

Omarchy Bot deliberately has one public model across its layers:

- the browser talks only to the same-origin localhost daemon through the typed client (`apps/web/src/lib/api.ts`, `packages/api-client/src/index.ts`);
- message creation is REST (`POST /api/bots/:id/messages` or `POST /api/threads/:id/messages`), including lazily creating a Thread on first send;
- a single shared WebSocket `/api/events` carries cursor-replayed control, transcript, tool, native Agent, dictation, and attention events for the whole workspace, not just one mounted chat (`packages/api-client/src/index.ts`, `apps/web/src/lib/events.ts`);
- streaming text is buffered by Thread in `apps/web/src/lib/live.ts`, while persisted messages are re-fetched from the daemon after message/tool events;
- SQLite and canonical Thread/Message/Turn/Attachment data are daemon-owned; Agent SDKs and native sessions live behind isolated workers (`README.md`);
- `ChatPanel.tsx` composes Astryx `ChatLayout`, `ChatMessageList`, `ChatMessage`, `ChatMessageBubble`, `ChatToolCalls`, `ChatComposer`, and `ChatComposerDrawer` while retaining application-specific state;
- `TranscriptAttention.tsx` owns the at-latest boundary, conditional scroll-follow, and read acknowledgement on the one native `ChatLayout` scrolling surface.

This boundary is not merely a presentation choice. The accepted specification requires native Agent capabilities and raw/native events to remain honest and lossless, the daemon to remain the only SQLite writer, and the browser never to talk directly to Agent runtimes. See `README.md`, `docs/workspace-redesign.md`, and the implementation paths above.

## What TanStack AI would own

### Core runtime and server helpers

The core `chat()` API accepts a TanStack text adapter, canonical messages, tools, interrupts, middleware, thread/run IDs, and optional structured output, then returns either an AG-UI `AsyncIterable<StreamChunk>` or a collected result. Response helpers expose that stream as SSE, NDJSON, or TanStack's WebSocket protocol. [`chat()` implementation and signature](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai/src/activities/chat/index.ts#L4575-L4685) · [official streaming guide](https://tanstack.com/ai/latest/docs/chat/streaming).

That is valuable in an app whose server invokes provider adapters directly. Omarchy Bot instead asks an isolated Agent worker to open/resume a native session, sends `message.send` or `message.steer`, and converts worker events into its durable domain model. Putting `chat()` in the daemon would either bypass that isolation/native-session layer or require a custom TanStack text adapter that re-wraps the existing worker protocol. In the latter case TanStack becomes an extra run engine around the existing one, not a simplification.

TanStack does ship provider and harness adapters, including ACP, Claude Code, Codex, and OpenCode packages, but there is no first-party `@tanstack/ai-pi` package in the official source package set. Replacing the Pi worker with a different adapter would change the selected Agent's native semantics and capability-conformance boundary rather than improve the chat UI. [Official package tree](https://github.com/TanStack/ai/tree/416a4e34bb2728529a3cdc598e0469f356121732/packages) · local `workers/pi/src/worker.ts`.

### Headless client and React hook

`ChatClient` owns messages, loading/error/status, run identity, queues, interrupt state, stream processing, client-tool execution, connection lifecycle, and optional persistence. Its constructor takes `ChatClientOptions`; React's `useChat(options)` creates that client and mirrors its state into React. Changing `threadId` recreates the client because `threadId` is the hook identity. [`ChatClient` constructor](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-client/src/chat-client.ts#L492-L523) · [`useChat` state ownership](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-react/src/use-chat.ts#L40-L178) · [`UseChatReturn`](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-react/src/types.ts#L77-L208).

The client lifecycle is thoughtfully designed: the mounted view calls `attach()`, unmount calls `detach()`, transcript/run pointers remain available, and durable connections can rejoin. That solves connection-per-chat limits in TanStack's architecture. It does not replace this app's one already-shared workspace event pump, which also invalidates Bots, Agents, Threads, Computer, dictation, and notifications. [Official client lifecycle](https://tanstack.com/ai/latest/docs/api/ai-client#lifecycle-attach-and-detach) · local `apps/web/src/lib/events.ts`.

### Typed headless React UI

The new `createChatHook({ options, ...components })` API binds chat options and component maps at module scope. `useAppChat()` calls TanStack's `useChat`, owns the state, and returns an instance plus `AppChat`; `useChatContext()` reads that instance below the provider. [`createChatHook` source](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-react/src/chat-ui/create-chat-hook.tsx#L28-L96) · [official React UI guide](https://tanstack.com/ai/latest/docs/ui/react).

The factory's benefit is typed dispatch: the app registers layout, message, input, queue, message-part, named tool, and interrupt components; it can then render messages automatically or traverse them manually. Tool component props narrow input/output types from the registered tool definitions. [`createChatUI` types and implementation](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-react/src/chat-ui/create-ui.tsx#L40-L181) · [manual traversal docs](https://tanstack.com/ai/latest/docs/ui/react#manual-traversal).

It is deliberately not a design system. The official guide states: **“You supply every visible component. There is no default markup, style, or copy.”** Consequently it owns no scroll container, focus policy, keyboard interaction, labels, announcements, contrast, attachment picker, Composer draft, or responsive behavior. Accessibility remains entirely the registered component author's responsibility. Astryx would still supply the visible primitives.

The lower-level `createChatUI(options, config)` does accept a `chat` host through its provider, but its `ChatUIHost` type is exactly a TanStack `UseChatReturn`. Adapting daemon/query state into that host requires implementing TanStack's messages, send/append/reload/stop, queue, tool-result, interrupt, and run surfaces as a facade. That is a parallel state machine, not selective view reuse. [`ChatUIHost` definition](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-react/src/chat-ui/create-ui.tsx#L40-L48).

### Message, tool, activity, and stream model

TanStack's `UIMessage` has roles `system | user | assistant` and a closed `MessagePart` union: text, image, audio, video, document, tool call, tool result, thinking, structured output, and UI resource. Tool calls have typed lifecycle states from awaiting input through complete/error. [`UIMessage` and `MessagePart`](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-client/src/types.ts#L514-L697).

This is strong for TanStack-defined provider tools. Omarchy Bot persists transcript records whose kinds are `text`, `tool`, and `event`; consecutive tool and textless native-event records collapse into one Astryx Activity block, while textual system failures stay inline. Native events carry capability, sensitivity, and typed/raw payloads from an external Agent worker (`ChatPanel.tsx`, `apps/daemon/src/modules/turns/turns.ts`). They are not equivalent to TanStack tool definitions.

TanStack can transport arbitrary `CUSTOM` events, but the stream processor forwards non-system custom events to `onCustomEvent`; it does not materialize them into `UIMessage.parts` (specific built-ins such as `ui-resource` are handled specially). Preserving Omarchy Bot's arbitrary Agent-native history would therefore require a second store or encoding raw records into message metadata and maintaining custom render/grouping logic. [`handleCustomEvent`](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai/src/activities/chat/stream/processor.ts#L2037-L2160).

### Transport customization

TanStack's transport seam is real. `ConnectionAdapter` accepts either request-scoped `connect(messages, data, abortSignal, runContext): AsyncIterable<StreamChunk>` or persistent `subscribe()` plus `send()`. Built-ins cover SSE, NDJSON, XHR, direct streams, async fetchers/server functions, RPC, and WebSockets. [`ConnectionAdapter` source](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-client/src/connection-adapters.ts#L823-L1003) · [official adapter guide](https://tanstack.com/ai/latest/docs/chat/connection-adapters).

However, customization is transport-only, not arbitrary application-protocol ownership. Every adapter must yield TanStack/AG-UI `StreamChunk` values and send the full `UIMessage[] | ModelMessage[]` plus TanStack run context; a terminal `RUN_FINISHED` or `RUN_ERROR` is required. The built-in `webSocket()` pairs with `toWebSocketStream`/`toWebSocketResponse`, not with Omarchy Bot's cursor-replayed `EventEnvelope` protocol. [Official WebSocket and custom persistent transport contract](https://tanstack.com/ai/latest/docs/chat/connection-adapters#websockets).

A custom adapter could translate `/api/events` `message.delta`, `message.appended`, `tool.updated`, `agent.native`, and `turn.status` events into AG-UI and route sends back to REST. It would also have to multiplex a global socket across changing Thread clients, synthesize TanStack run IDs/terminal events, preserve cursor replay, and continue routing non-chat workspace events. That is exactly the transport workaround the replacement criterion excludes. The current protocol is visible in `packages/api-client/src/index.ts`, `apps/web/src/lib/events.ts`, and `apps/web/src/lib/live.ts`.

### Persistence and hydration

TanStack supports two client modes:

- `persistence: true`: server-authoritative; hydrate a stable `threadId` from a GET response shaped as `{ messages: UIMessage[], activeRun, interrupts }` and optionally rejoin its run;
- `persistence: adapter`: browser-authoritative; store one combined transcript/resume record through localStorage, sessionStorage, IndexedDB, or a custom adapter.

Server-side `withPersistence()` stores canonical messages, run status, and pending interrupts in configured stores; resumable delivery is a separate layer. [Official persistence overview](https://tanstack.com/ai/latest/docs/persistence/overview) · [client persistence types](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-client/src/types.ts#L697-L795) · [hydration result](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-client/src/connection-adapters.ts#L920-L933).

Omarchy Bot already has server-authoritative SQLite persistence for Bots, Threads, Messages, Turns, native sessions, attachments, unread state, and deletion, with React Query invalidation around the public DTO model. TanStack server hydration could only replace it after a lossless schema migration and a new AG-UI route. Running it beside current queries would create two owners for transcript/run state. `@tanstack/ai-persistence` also depends on the TanStack `chat()` middleware lifecycle, so it has no isolated value while the worker/turn engine remains authoritative.

TanStack persistence is not a Composer draft facility. Its stored record contains the transcript and run-resume state, not unsent editor text, insertion/cursor position, staged managed-copy IDs, or a dictation anchor. Current window-local drafts use `sessionStorage`, keyed by Bot/Thread, and intentionally remain separate from daemon history (`apps/web/src/lib/drafts.ts`).

### Attachments and multimodality

TanStack can send multimodal content parts. Image/audio/video/document inputs reference either inline base64 data or an HTTP(S)/data URL. [`ContentPartSource` and media parts](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai/src/types.ts#L208-L328). Per-send JSON can also carry application attachment IDs in `forwardedProps`; the official example explicitly leaves lookup to the server. [Connection adapter attachment-ID example](https://tanstack.com/ai/latest/docs/chat/connection-adapters#server-sent-events-sse).

There is no attachment picker/manager in the headless UI source. TanStack's own React chat example keeps a separate `attachedImages` state, reads each `File` into base64, creates/revokes preview URLs, renders previews, and then builds content parts. [Official example source](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/examples/ts-react-chat/src/routes/index.tsx#L575-L669).

Omarchy Bot's requirement is broader: stage a daemon-managed local copy, restore it with a window-scoped draft, validate disappearance, atomically associate IDs on send, retain sent snapshots with the Thread, render managed images/files, and delete bytes with owning data. `ChatPanel.tsx` and `packages/api-client/src/index.ts` already implement the browser side. TanStack would still need those mechanisms, then require a translation from managed attachment records into its message parts or metadata.

### Busy sends, native steering, and interrupts

TanStack's default busy-send policy queues. `drop` silently ignores the send. `interrupt` aborts the active stream and sends the new message immediately; it intentionally differs from `stop()` only in queue handling. [`WhenBusy` source](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-client/src/types.ts#L422-L491).

TanStack's human-in-the-loop interrupts solve a different problem: the server ends a run at an approval/data boundary, the user resolves a typed item, and the client starts a new continuation run. [Official interrupt overview](https://tanstack.com/ai/latest/docs/interrupts/overview).

Omarchy Bot's POST handler detects an active Turn and invokes the worker's `message.steer`. The Pi worker calls native `session.steer(text)`, which queues the redirect for a safe boundary between atomic tool calls and explicitly does not abort, prompt, or reopen the session. The user's redirect is persisted immediately, and a rejected steer leaves the original turn running (`apps/daemon/src/modules/turns/turns.ts`, `workers/pi/src/worker.ts`). No TanStack queue/interrupt option preserves that contract.

### Voxtype and auto-send

TanStack exposes browser recording/transcription utilities, but its `AudioRecorder` wraps `navigator.mediaDevices.getUserMedia` and `MediaRecorder` and returns base64/blob data. [`AudioRecorder` source](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-client/src/audio-recorder.ts#L1-L108).

That is intentionally not Omarchy Bot's voice architecture. The app uses the installed Voxtype service through localhost daemon commands, binds completion to the originating Bot/Thread draft and cursor, inserts text, preserves existing text, optionally auto-sends through the same normal/native-steer path, and never retains raw audio. `ChatPanel.tsx` implements origin binding and insertion; the accepted contract is in `docs/workspace-redesign.md` and `docs/research/voxtype-composer-integration.md`. TanStack's browser recorder would add a second microphone/transcription path and violate the chosen host integration.

### Scroll-follow, unread attention, accessibility, and visual primitives

TanStack's client knows messages and run state, but its headless UI does not know Omarchy Bot's unread domain state or daemon `markBotRead` command. It also renders no scrolling surface. `TranscriptAttention.tsx` observes Astryx `ChatLayout`'s actual viewport, follows new content only when already at latest, and acknowledges matching unread state only at the latest message. Replacing the visual composition would require reimplementing this unchanged.

Similarly, the current Composer adds semantic file labels, per-file remove labels, dictation labels/states, status messages, keyboard Escape cancellation, and Astryx focus/keyboard behavior. Because TanStack asks the app to provide every visible element, it cannot improve these accessibility responsibilities on its own. The accepted visual system also explicitly requires Astryx primitives (`docs/workspace-redesign.md`). TanStack is complementary to a design system, not a substitute for one.

### Devtools

TanStack Devtools can discover TanStack AI hooks and inspect their messages, runs, AG-UI stream events, tool calls, state, errors, memory, and fixtures. It consumes the client/server event buses produced by the TanStack runtime. [Official Devtools guide](https://tanstack.com/ai/latest/docs/getting-started/devtools).

That is a benefit only after `useChat`/`ChatClient` and preferably `chat()` own the flow. Adding the plugin alone would not observe the current REST/WebSocket/worker pipeline. Instrumenting current state solely to feed it would duplicate existing protocol diagnostics; no selective adoption is justified.

## Contract comparison

| Required observable contract | Current owner | TanStack coverage | Replacement result |
| --- | --- | --- | --- |
| Localhost daemon REST plus one cursor-replayed workspace WebSocket | typed `ApiClient`, `events.ts`, `live.ts` | Custom adapters are possible, but require AG-UI `StreamChunk`, TanStack run correlation, and terminal events | **Blocker:** protocol translator and parallel global event pump |
| Daemon-persisted Threads/Messages/Turns/native sessions | SQLite daemon, queries and invalidation | Server persistence can own TanStack `UIMessage`/run/interrupt state | **Blocker:** second schema/owner or full storage/API migration |
| Native safe-boundary mid-turn steering | daemon `#steer` → worker `message.steer` → Pi `session.steer` | `queue`, `drop`, or abort-and-send `interrupt`; HIL interrupt ends then continues a run | **Hard blocker:** behavior loss without a custom extension |
| Window-scoped draft text, cursor, staged IDs, dictation anchor | `drafts.ts`, `ChatPanel.tsx` | No Composer draft model | Keep custom state; no replacement value |
| Managed local attachments and history retention | daemon attachment APIs plus `ChatPanel` | Multimodal data/URL parts and arbitrary per-send IDs; no staging manager/UI | Keep all existing mechanisms plus translation |
| Voxtype insert-at-origin and optional auto-send/steer | daemon dictation controller and `ChatPanel` | Browser MediaRecorder/transcription is a different architecture | Keep custom integration; TanStack media hooks are unsuitable |
| Follow only at latest and mark unread only at latest | `TranscriptAttention.tsx` + Astryx scroll surface | No DOM, scroll, or unread domain behavior | Must retain unchanged |
| Collapsed tool/native Activity plus inline errors | daemon MessageDto/event records + `ChatPanel` | Typed TanStack tool parts are strong; arbitrary custom events are callbacks, not message parts | Mapping loses or duplicates the canonical event model |
| Accessibility and responsive visual composition | Astryx primitives plus local labels/handlers | Headless factory provides no markup/style/copy | Astryx remains necessary |
| React 19 | current web app | Supported (`react >=18`) | Compatible, but not a reason to adopt |

## Adoption options

### 1. Wholesale TanStack stack — reject

A real wholesale cutover would have to be atomic across all owners:

1. define a lossless mapping from `MessageDto`, attachments, tool records, native events, Turn state, and native-session identity to TanStack `ModelMessage`/`UIMessage` plus persistence stores;
2. replace REST message routes and the relevant `/api/events` stream with AG-UI POST/GET/WebSocket endpoints, including durable run replay and terminal events;
3. either replace isolated Agent workers with TanStack adapters or write a custom text adapter around every worker while preserving capability inventories and session semantics;
4. add a first-class native-steer protocol to TanStack client busy-send handling without aborting or creating a continuation run;
5. replace React Query transcript ownership, `live.ts`, and relevant event invalidation with one `useChat` owner;
6. rebuild managed-attachment, draft, Voxtype, attention, notification, Activity grouping, error, accessibility, and Astryx rendering on top of the new owner;
7. migrate existing SQLite history without losing Bot, Thread, message, attachment, Turn, native-event, unread, or native-session data.

This is a platform rewrite whose only direct UI benefit is typed dispatch of parts/tools. It is disproportionate and fails the current no-workaround/no-loss criterion.

### 2. Select only `@tanstack/ai-react/ui` — reject

`createChatHook` necessarily creates TanStack `useChat` state. `createChatUI` can render a supplied host, but that host must implement `UseChatReturn` and provide TanStack `UIMessage` parts, queue, interrupt, tool-result, run, and mutation methods. Maintaining that facade beside the daemon DTO/query/live model is a parallel state machine. The factory supplies no visible component that can replace Astryx and no behavior for drafts, attachments, voice, attention, or accessibility.

### 3. Select client transport/persistence/queue — reject

The adapter seam is flexible, persistence is well designed, and queuing is useful in a conventional provider chat. In this app they are inseparable from AG-UI messages and TanStack run identity. The transport needs a translator; persistence duplicates SQLite; default queueing weakens native steering; abort-and-send violates it. No isolated package reduces code or risk.

### 4. Select core provider/runtime or Devtools — reject

The core runtime would wrap or bypass the isolated worker/Agent lifecycle. Persistence middleware and Devtools derive their value from that runtime/client. Adopting them piecemeal would add instrumentation and conversion layers without eliminating the existing engine.

## Benefits worth remembering

The rejection is architectural, not a quality judgment. TanStack AI has several strong ideas to revisit for a future product whose server and wire model are not already established:

- one typed `UIMessage`/part model across provider stream, client tools, approvals, and rendering;
- transport-independent stream processing with solid SSE/NDJSON/WebSocket/resume adapters;
- explicit client attachment/detachment for many-chat pages;
- server- or browser-authoritative hydration and resumable runs;
- typed tool/interrupt component dispatch;
- integrated run/tool/event Devtools.

A future reconsideration should begin only if Omarchy Bot intentionally adopts AG-UI as its canonical daemon-to-browser chat protocol **and** TanStack gains or the app designs a first-class non-aborting native-steer operation plus a lossless persisted custom/native-event part. At that point the core client and React UI factory should be evaluated together, not added behind a facade.

## Candidate API surface if that architecture changes

These are the exact current exported API names and intended call shapes—not recommendations to add them now. Their full generic signatures are in the pinned source links above:

```ts
// Client/runtime
new ChatClient(options: ChatClientOptions)
useChat(options: UseChatOptions): UseChatReturn
fetchServerSentEvents(url, options?)
webSocket(url, options?)

// Typed headless React UI
createChatHook({ options, components, partsComponents, toolsComponents, interruptsComponents })
createChatUI(options, config)

// Server
chat(options)
chatParamsFromRequest(request)
toServerSentEventsResponse(stream, options?)
toWebSocketStream(socket, options)

// Persistence
withPersistence(persistence)
reconstructChat(persistence, request, options)
```

The corresponding package set would be `@tanstack/ai`, `@tanstack/ai-client`, `@tanstack/ai-react` (UI imported from `@tanstack/ai-react/ui`), `@tanstack/ai-persistence`, and an appropriate provider/Agent adapter. Do not use the deprecated `@tanstack/ai-react-ui` package.

## Sources

### Official TanStack documentation

- [Overview and package roles](https://tanstack.com/ai/latest/docs/getting-started/overview)
- [React chat UI](https://tanstack.com/ai/latest/docs/ui/react)
- [Chat UI package migration](https://tanstack.com/ai/latest/docs/migration/create-ui)
- [`@tanstack/ai-client` API](https://tanstack.com/ai/latest/docs/api/ai-client)
- [Streaming](https://tanstack.com/ai/latest/docs/chat/streaming)
- [Connection adapters](https://tanstack.com/ai/latest/docs/chat/connection-adapters)
- [Persistence](https://tanstack.com/ai/latest/docs/persistence/overview)
- [Interrupts](https://tanstack.com/ai/latest/docs/interrupts/overview)
- [Devtools](https://tanstack.com/ai/latest/docs/getting-started/devtools)

### Official TanStack source snapshot

- [`@tanstack/ai-react/ui` exports](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-react/src/ui.ts)
- [`createChatHook`](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-react/src/chat-ui/create-chat-hook.tsx)
- [`createChatUI`](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-react/src/chat-ui/create-ui.tsx)
- [`useChat`](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-react/src/use-chat.ts)
- [`ChatClient` and busy-send implementation](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-client/src/chat-client.ts)
- [client/message/persistence types](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-client/src/types.ts)
- [connection adapter interfaces](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-client/src/connection-adapters.ts)
- [core `chat()` runtime](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai/src/activities/chat/index.ts)
- [custom-event processor](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai/src/activities/chat/stream/processor.ts)
- [multimodal content types](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai/src/types.ts)
- [official React image-attachment example](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/examples/ts-react-chat/src/routes/index.tsx)
- [browser audio recorder](https://github.com/TanStack/ai/blob/416a4e34bb2728529a3cdc598e0469f356121732/packages/ai-client/src/audio-recorder.ts)

### Local implementation and accepted contracts

- `README.md`
- `docs/workspace-redesign.md`
- `docs/research/voxtype-composer-integration.md`
- `apps/web/src/components/ChatPanel.tsx`
- `apps/web/src/components/TranscriptAttention.tsx`
- `apps/web/src/lib/live.ts`
- `apps/web/src/lib/api.ts`
- `apps/web/src/lib/events.ts`
- `apps/web/src/lib/drafts.ts`
- `packages/api-client/src/index.ts`
- `apps/daemon/src/modules/turns/turns.ts`
- `workers/pi/src/worker.ts`

## Final decision

**KEEP ASTRYX / NO TANSTACK AI ADOPTION.**

Do not modify application code or package manifests. Keep the current Astryx Chat composition, daemon-owned canonical persistence, shared cursor-replayed event stream, native worker steering, managed attachments, window-scoped drafts, Voxtype flow, transcript attention, and Activity rendering. TanStack's headless UI would not replace those responsibilities; adopting it now would add a second message/run state machine and a transport translator while preserving nearly all existing code. Revisit only as an explicit future AG-UI/runtime migration, never as a UI-component swap.
