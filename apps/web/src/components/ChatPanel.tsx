import type { ChangeEvent, DragEvent, JSX, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ChatComposer, ChatComposerInput } from "@astryxdesign/core/Chat";
import { ChatMessage } from "@astryxdesign/core/Chat";
import { ChatMessageBubble } from "@astryxdesign/core/Chat";
import { ChatMessageList } from "@astryxdesign/core/Chat";
import { ChatSystemMessage } from "@astryxdesign/core/Chat";
import { ChatToolCalls, type ChatToolCallItem } from "@astryxdesign/core/Chat";
import { ChatLayout } from "@astryxdesign/core/Chat";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Button } from "@astryxdesign/core/Button";
import type { AttachmentDto, BotViewDto, DictationDto, DictationResultDto, MessageDto, ThreadDto } from "@omarchy-bot/protocol";
import { Icon } from "@astryxdesign/core/Icon";
import { getDelta, subscribeDeltas } from "../lib/live.ts";
import { api, apiErrorMessage, trimSendText } from "../lib/api.ts";
import { loadDraft, saveDraft, type ConversationDraft } from "../lib/drafts.ts";
import { insertDictationTranscript } from "../lib/dictation.ts";
import { AvatarView } from "./AvatarView.tsx";
import styles from "../lib/styles.ts";

export interface VoiceDraftTarget {
  botId: string;
  threadId?: string;
}

export interface DictationController {
  state: DictationDto;
  start: () => Promise<DictationDto>;
  stop: () => Promise<DictationResultDto>;
  cancel: () => Promise<DictationDto>;
}

interface ChatPanelProps {
  bot?: BotViewDto;
  thread?: ThreadDto;
  messages: MessageDto[];
  onMessageSent: (threadId: string) => void;
  isAgentReady: boolean;
  dictation: DictationController;
  autoSendVoice: boolean;
  onVoiceAutoSend: (target: VoiceDraftTarget, text: string) => Promise<void>;
}

function stringPayloadField(payload: unknown, field: string): string | undefined {
  if (payload === null || typeof payload !== "object" || !(field in payload)) return undefined;
  const value = payload[field];
  return typeof value === "string" ? value : undefined;
}

type Row = { kind: "message"; message: MessageDto } | { kind: "activity"; key: string; items: MessageDto[] };

/**
 * Consecutive non-text transcript records collapse into one Activity block.
 * Plain-language system notes remain inline so failures are never hidden.
 */
function groupMessages(messages: MessageDto[]): Row[] {
  const out: Row[] = [];
  let run: MessageDto[] = [];
  const flushRun = (): void => {
    if (run.length > 0) {
      out.push({ kind: "activity", key: run[0]!.id, items: run });
      run = [];
    }
  };
  for (const message of messages) {
    const isActivity =
      message.kind === "tool" ||
      (message.kind === "event" && message.text === undefined);
    if (isActivity) {
      run.push(message);
      continue;
    }
    flushRun();
    out.push({ kind: "message", message });
  }
  flushRun();
  return out;
}

const EMPTY_DRAFT: ConversationDraft = { text: "", cursor: 0, stagedIds: [] };

function formatAttachmentSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.ceil(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function apiStatus(error: unknown): number | undefined {
  if (error !== null && typeof error === "object" && "status" in error && typeof error.status === "number") return error.status;
  return undefined;
}

function attachmentErrorMessage(error: unknown, fileName: string): string {
  if (error !== null && typeof error === "object" && "body" in error) {
    let body = error.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return `${fileName}: ${body}`;
      }
    }
    if (body !== null && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return `${fileName}: ${body.error}`;
    }
  }
  return `${fileName}: ${apiErrorMessage(error, "Attachment could not be staged.")}`;
}

function AttachmentContent({ attachment, previewUrl }: { attachment: AttachmentDto; previewUrl?: string }): JSX.Element {
  const imageUrl = attachment.mediaType.startsWith("image/")
    ? previewUrl ?? attachment.url
    : undefined;
  if (imageUrl !== undefined) {
    return (
      <img
        src={imageUrl}
        alt={attachment.name}
        loading="lazy"
        xstyle={styles.attachmentImage}
        data-testid={attachment.kind === "managed" ? "message-image-attachment" : "staged-image-preview"}
      />
    );
  }
  const metadata = `${attachment.mediaType} · ${formatAttachmentSize(attachment.size)}`;
  return attachment.url !== undefined ? (
    <a href={attachment.url} download={attachment.name} xstyle={styles.attachmentFile} data-testid="message-file-attachment">
      <strong>{attachment.name}</strong>
      <span>{metadata}</span>
    </a>
  ) : (
    <div xstyle={styles.attachmentFile} data-testid="staged-file-row">
      <strong>{attachment.name}</strong>
      <span>{metadata}</span>
    </div>
  );
}
interface DictationOrigin {
  target: VoiceDraftTarget;
  anchor: number;
}
interface AttachmentRestoreResult {
  id: string;
  attachment?: AttachmentDto;
  error?: unknown;
}

function composerCursor(root: HTMLDivElement | null, fallback: number): number {
  if (root === null) return fallback;
  const selection = window.getSelection();
  if (selection === null || selection.rangeCount === 0 || selection.anchorNode === null || !root.contains(selection.anchorNode)) {
    return fallback;
  }
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString().length;
}


export function ChatPanel({
  bot,
  thread,
  messages,
  onMessageSent,
  isAgentReady,
  dictation,
  autoSendVoice,
  onVoiceAutoSend,
}: ChatPanelProps): JSX.Element {
  const [draft, setDraft] = useState<ConversationDraft>(EMPTY_DRAFT);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  const [voiceStatus, setVoiceStatus] = useState<string | undefined>(undefined);
  const [voiceState, setVoiceState] = useState<DictationDto>(dictation.state);
  const [stagedAttachments, setStagedAttachments] = useState<AttachmentDto[]>([]);
  const composerInputRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Map<string, string>());
  const restoreGenerationRef = useRef(0);
  const dictationOriginRef = useRef<DictationOrigin | undefined>(undefined);
  const draftBotId = bot?.id;
  const draftThreadId = thread?.id;
  const selectedDraftRef = useRef({ botId: draftBotId, threadId: draftThreadId });
  selectedDraftRef.current = { botId: draftBotId, threadId: draftThreadId };

  // Restore only this window's references and discard daemon-confirmed 404s.
  useEffect(() => {
    const generation = ++restoreGenerationRef.current;
    setSubmitError(undefined);
    setStagedAttachments([]);
    if (draftBotId === undefined) {
      setDraft(EMPTY_DRAFT);
      return;
    }

    const restored = loadDraft(draftBotId, draftThreadId);
    setDraft(restored);
    void Promise.all(restored.stagedIds.map(async (id): Promise<AttachmentRestoreResult> => {
      try {
        return { id, attachment: await api.getStagedAttachment(id) };
      } catch (error) {
        return { id, error };
      }
    })).then((results) => {
      if (restoreGenerationRef.current !== generation) return;
      const valid = results.flatMap((result) => result.attachment === undefined ? [] : [result.attachment]);
      const missing = new Set(results.filter((result) => result.error !== undefined && apiStatus(result.error) === 404).map((result) => result.id));
      const unavailable = results.some((result) => result.error !== undefined && apiStatus(result.error) !== 404);
      const next = { ...restored, stagedIds: restored.stagedIds.filter((id) => !missing.has(id)) };
      if (missing.size > 0) saveDraft(draftBotId, draftThreadId, next);
      setDraft(next);
      setStagedAttachments(valid);
      if (missing.size > 0) {
        setSubmitError(`${missing.size === 1 ? "A staged attachment is" : `${missing.size} staged attachments are`} no longer available and ${missing.size === 1 ? "was" : "were"} removed from this draft.`);
      } else if (unavailable) {
        setSubmitError("Some staged attachments could not be checked. Their draft references were preserved.");
      }
    });
  }, [draftBotId, draftThreadId]);

  useEffect(() => () => {
    for (const previewUrl of previewUrlsRef.current.values()) URL.revokeObjectURL(previewUrl);
    previewUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    setVoiceState(dictation.state);
  }, [dictation.state]);

  const onDraftChange = useCallback(
    (value: string) => {
      setDraft((current) => {
        const next: ConversationDraft = { ...current, text: value, cursor: value.length };
        if (draftBotId !== undefined) saveDraft(draftBotId, draftThreadId, next);
        return next;
      });
    },
    [draftBotId, draftThreadId],
  );
  const stageFiles = useCallback(async (files: readonly File[]): Promise<void> => {
    if (draftBotId === undefined || files.length === 0) return;
    const origin = { botId: draftBotId, threadId: draftThreadId };
    setSubmitError(undefined);
    const staged: AttachmentDto[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        const attachment = await api.stageAttachment(origin.botId, file);
        staged.push(attachment);
        if (attachment.mediaType.startsWith("image/")) {
          previewUrlsRef.current.set(attachment.id, URL.createObjectURL(file));
        }
      } catch (error) {
        errors.push(attachmentErrorMessage(error, file.name));
      }
    }
    if (staged.length > 0) {
      const stored = loadDraft(origin.botId, origin.threadId);
      const next: ConversationDraft = {
        ...stored,
        stagedIds: [...new Set([...stored.stagedIds, ...staged.map((attachment) => attachment.id)])],
      };
      saveDraft(origin.botId, origin.threadId, next);
      const selected = selectedDraftRef.current;
      if (selected.botId === origin.botId && selected.threadId === origin.threadId) {
        restoreGenerationRef.current += 1;
        setDraft(next);
        setStagedAttachments((current) => {
          const byId = new Map(current.map((attachment) => [attachment.id, attachment]));
          for (const attachment of staged) byId.set(attachment.id, attachment);
          return [...byId.values()];
        });
      }
    }
    if (errors.length > 0) setSubmitError(errors.join(" "));
  }, [draftBotId, draftThreadId]);

  const selectFiles = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    void stageFiles(files);
  }, [stageFiles]);

  const dropFiles = useCallback((event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    if (event.dataTransfer.files.length > 0) void stageFiles(Array.from(event.dataTransfer.files));
  }, [stageFiles]);

  const removeStagedAttachment = useCallback(async (attachment: AttachmentDto): Promise<void> => {
    if (draftBotId === undefined) return;
    const origin = { botId: draftBotId, threadId: draftThreadId };
    const stored = loadDraft(origin.botId, origin.threadId);
    const next = { ...stored, stagedIds: stored.stagedIds.filter((id) => id !== attachment.id) };
    saveDraft(origin.botId, origin.threadId, next);
    const selected = selectedDraftRef.current;
    if (selected.botId === origin.botId && selected.threadId === origin.threadId) {
      setSubmitError(undefined);
      setDraft(next);
      setStagedAttachments((current) => current.filter((candidate) => candidate.id !== attachment.id));
    }

    try {
      await api.unstageAttachment(attachment.id);
      const previewUrl = previewUrlsRef.current.get(attachment.id);
      if (previewUrl !== undefined) {
        URL.revokeObjectURL(previewUrl);
        previewUrlsRef.current.delete(attachment.id);
      }
    } catch (error) {
      saveDraft(origin.botId, origin.threadId, stored);
      const currentSelection = selectedDraftRef.current;
      if (currentSelection.botId === origin.botId && currentSelection.threadId === origin.threadId) {
        setDraft(stored);
        setStagedAttachments((current) =>
          current.some((candidate) => candidate.id === attachment.id) ? current : [...current, attachment],
        );
        setSubmitError(attachmentErrorMessage(error, attachment.name));
      }
    }
  }, [draftBotId, draftThreadId]);

  const rememberCursor = useCallback(() => {
    if (draftBotId === undefined) return;
    setDraft((current) => {
      const cursor = Math.max(0, Math.min(composerCursor(composerInputRef.current, current.cursor), current.text.length));
      if (cursor === current.cursor) return current;
      const next = { ...current, cursor };
      saveDraft(draftBotId, draftThreadId, next);
      return next;
    });
  }, [draftBotId, draftThreadId]);

  const saveOriginDraft = useCallback((origin: DictationOrigin, next: ConversationDraft): void => {
    saveDraft(origin.target.botId, origin.target.threadId, next);
    const selected = selectedDraftRef.current;
    if (selected.botId === origin.target.botId && selected.threadId === origin.target.threadId) setDraft(next);
  }, []);

  const clearOriginAnchor = useCallback(
    (origin: DictationOrigin): void => {
      const stored = loadDraft(origin.target.botId, origin.target.threadId);
      saveOriginDraft(origin, { text: stored.text, cursor: stored.cursor, stagedIds: stored.stagedIds });
    },
    [saveOriginDraft],
  );

  const startDictation = useCallback(async (): Promise<void> => {
    if (bot === undefined || voiceState.state !== "idle") return;
    const anchor = Math.max(0, Math.min(composerCursor(composerInputRef.current, draft.cursor), draft.text.length));
    const target: VoiceDraftTarget = {
      botId: bot.id,
      ...(thread !== undefined ? { threadId: thread.id } : {}),
    };
    const origin: DictationOrigin = { target, anchor };
    dictationOriginRef.current = origin;
    const anchoredDraft = { ...draft, cursor: anchor, dictationAnchor: anchor };
    saveDraft(target.botId, target.threadId, anchoredDraft);
    setDraft(anchoredDraft);
    setVoiceStatus(undefined);

    try {
      const state = await dictation.start();
      setVoiceState(state);
      if (state.state !== "recording") {
        clearOriginAnchor(origin);
        dictationOriginRef.current = undefined;
        setVoiceStatus(state.error ?? "Voice dictation is unavailable.");
      }
    } catch (error) {
      clearOriginAnchor(origin);
      dictationOriginRef.current = undefined;
      setVoiceStatus(apiErrorMessage(error, "Voice dictation could not start."));
    }
  }, [bot, thread, voiceState.state, draft, dictation, clearOriginAnchor]);

  const stopDictation = useCallback(async (): Promise<void> => {
    const origin = dictationOriginRef.current;
    if (origin === undefined || voiceState.state !== "recording") return;
    setVoiceState({
      state: "transcribing",
      ...(voiceState.recordingId !== undefined ? { recordingId: voiceState.recordingId } : {}),
    });
    setVoiceStatus(undefined);

    try {
      const result = await dictation.stop();
      setVoiceState({ state: "idle" });
      if (result.outcome !== "success" || result.text === undefined) {
        clearOriginAnchor(origin);
        setVoiceStatus(
          result.outcome === "empty"
            ? "No speech detected."
            : result.outcome === "timeout"
              ? "Voice transcription timed out."
              : result.outcome === "cancelled"
                ? undefined
                : result.outcome === "unavailable"
                  ? "Voice dictation is unavailable."
                  : "Voice transcription failed.",
        );
        return;
      }

      const latest = loadDraft(origin.target.botId, origin.target.threadId);
      const inserted = insertDictationTranscript(latest, result.text, origin.anchor);
      saveOriginDraft(origin, inserted);
      if (autoSendVoice) {
        try {
          await onVoiceAutoSend(origin.target, inserted.text);
          saveOriginDraft(origin, { ...EMPTY_DRAFT, stagedIds: inserted.stagedIds });
        } catch (error) {
          setSubmitError(apiErrorMessage(error, "Voice transcription was inserted but could not be sent."));
        }
      }
    } catch (error) {
      clearOriginAnchor(origin);
      setVoiceState({ state: "idle" });
      setVoiceStatus(apiErrorMessage(error, "Voice transcription failed."));
    } finally {
      dictationOriginRef.current = undefined;
    }
  }, [voiceState, dictation, clearOriginAnchor, saveOriginDraft, autoSendVoice, onVoiceAutoSend]);

  const cancelDictation = useCallback(async (): Promise<void> => {
    const origin = dictationOriginRef.current;
    if (origin === undefined) return;
    clearOriginAnchor(origin);
    dictationOriginRef.current = undefined;
    setVoiceStatus(undefined);
    try {
      setVoiceState(await dictation.cancel());
    } catch (error) {
      setVoiceState({ state: "idle" });
      setVoiceStatus(apiErrorMessage(error, "Voice dictation could not be cancelled."));
    }
  }, [clearOriginAnchor, dictation]);

  useEffect(() => {
    if (voiceState.state !== "recording") return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      void cancelDictation();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [voiceState.state, cancelDictation]);

  const delta = useSyncExternalStore(
    subscribeDeltas,
    () => (thread !== undefined ? getDelta(thread.id) : ""),
    () => "",
  );
  const isStreaming = bot?.status === "working" || (thread !== undefined && delta.length > 0);

  const grouped = useMemo(() => groupMessages(messages), [messages]);

  const send = useCallback(
    async (): Promise<void> => {
      const trimmed = trimSendText(draft.text);
      if (trimmed.length === 0 || bot === undefined) return;
      const originThreadId = thread?.id;
      const attachmentIds = [...draft.stagedIds];
      const preservedDraft = { ...draft };
      const body = {
        text: trimmed,
        clientTag: crypto.randomUUID(),
        ...(attachmentIds.length > 0 ? { attachmentIds } : {}),
      };
      setSubmitError(undefined);
      try {
        const response = thread !== undefined
          ? await api.sendMessage(thread.id, body)
          : await api.sendBotMessage(bot.id, body);
        saveDraft(bot.id, originThreadId, EMPTY_DRAFT);
        setDraft(EMPTY_DRAFT);
        setStagedAttachments([]);
        for (const id of attachmentIds) {
          const previewUrl = previewUrlsRef.current.get(id);
          if (previewUrl !== undefined) {
            URL.revokeObjectURL(previewUrl);
            previewUrlsRef.current.delete(id);
          }
        }
        onMessageSent(response.threadId);
      } catch (error) {
        // Astryx clears its controlled editor on submit; restore the originating
        // draft only after the daemon rejects the whole atomic send.
        saveDraft(bot.id, originThreadId, preservedDraft);
        setDraft(preservedDraft);
        setSubmitError(apiErrorMessage(error, "Message could not be sent."));
      }
    },
    [bot, thread, draft, onMessageSent],
  );

  const rows = useMemo(() => {
    const out: ReactNode[] = [];
    for (const g of grouped) {
      if (g.kind === "activity") {
        const calls: ChatToolCallItem[] = g.items.map((message) => {
          const name = stringPayloadField(message.payload, "name");
          const capability = stringPayloadField(message.payload, "capability");
          const state = stringPayloadField(message.payload, "state");
          return {
            key: message.id,
            name: message.kind === "event" ? capability ?? "Agent event" : name ?? "Tool",
            status: state === "running" ? "running" : state === "error" ? "error" : "complete",
            ...(message.payload !== undefined
              ? { resultDetail: <pre style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(message.payload, null, 2)}</pre> }
              : {}),
          };
        });
        out.push(
          <ChatMessage key={g.key} sender="system">
            <div xstyle={styles.activityWrap}>
              <Collapsible trigger={`Activity (${g.items.length})`} defaultIsOpen={false} data-testid="activity">
                <ChatToolCalls calls={calls} isExpanded />
              </Collapsible>
            </div>
          </ChatMessage>,
        );
        continue;
      }
      const m = g.message;
      if (m.author.kind === "system") {
        out.push(<ChatSystemMessage key={m.id}>{m.text ?? ""}</ChatSystemMessage>);
        continue;
      }

      const sender = m.author.kind === "user" ? "user" : "assistant";
      out.push(
        <ChatMessage
          key={m.id}
          sender={sender}
          avatar={
            sender === "assistant" && bot !== undefined ? (
              <AvatarView avatar={bot.avatar} name={bot.name} size="sm" activity={bot.status === "working" ? "working" : "selected"} />
            ) : undefined
          }
          data-testid={sender === "assistant" ? "assistant-message" : "user-message"}
        >
          <ChatMessageBubble variant="filled">
            <div xstyle={styles.messageContent}>
              {m.text !== undefined ? <span>{m.text}</span> : null}
              {m.attachments?.map((attachment) => <AttachmentContent key={attachment.id} attachment={attachment} />)}
            </div>
          </ChatMessageBubble>
        </ChatMessage>,
      );
    }
    return out;
  }, [grouped, bot]);

  const voiceMessage =
    voiceState.state === "recording"
      ? "Listening… Press Escape to cancel."
      : voiceState.state === "transcribing"
        ? "Transcribing voice…"
        : voiceStatus;
  const composerStatus =
    bot !== undefined && !isAgentReady
      ? { type: "warning" as const, message: "The bot's agent is not ready." }
      : submitError !== undefined
        ? { type: "error" as const, message: submitError }
        : voiceMessage !== undefined
          ? {
              type: voiceState.state === "recording" || voiceState.state === "transcribing" ? ("warning" as const) : ("error" as const),
              message: voiceMessage,
            }
          : voiceState.state === "unavailable"
            ? { type: "warning" as const, message: voiceState.error ?? "Voice dictation is unavailable." }
            : undefined;
  const dictationLabel =
    voiceState.state === "recording"
      ? "Stop voice recording"
      : voiceState.state === "transcribing"
        ? "Transcribing voice"
        : voiceState.state === "unavailable"
          ? "Voice dictation unavailable"
          : "Start voice recording";
  const dictationButton = (
    <Button
      label={dictationLabel}
      aria-label={dictationLabel}
      icon={<Icon icon="microphone" size="md" />}
      variant="ghost"
      size="md"
      isIconOnly
      isDisabled={bot === undefined || voiceState.state === "transcribing" || voiceState.state === "unavailable"}
      onClick={() => void (voiceState.state === "recording" ? stopDictation() : startDictation())}
      data-testid="dictation-button"
      data-state={voiceState.state}
    />
  );
  const composerActions = (
    <div xstyle={styles.composerActions}>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={selectFiles}
        xstyle={styles.hiddenFileInput}
        data-testid="attachment-input"
        tabIndex={-1}
      />
      <Button
        label="Attach files"
        variant="ghost"
        size="sm"
        isDisabled={bot === undefined}
        onClick={() => fileInputRef.current?.click()}
        data-testid="attachment-picker"
      />
      {dictationButton}
    </div>
  );
  const composer = (
    <div xstyle={styles.composerWrap}>
      <div
        xstyle={styles.composerDropZone}
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropFiles}
      >
        {stagedAttachments.length > 0 ? (
          <div xstyle={styles.stagedAttachments} aria-label="Staged attachments">
            {stagedAttachments.map((attachment) => (
              <div
                key={attachment.id}
                xstyle={styles.stagedAttachment}
                data-testid="staged-attachment"
                data-attachment-id={attachment.id}
              >
                <AttachmentContent attachment={attachment} previewUrl={previewUrlsRef.current.get(attachment.id)} />
                <Button
                  label={`Remove ${attachment.name}`}
                  variant="ghost"
                  size="sm"
                  onClick={() => void removeStagedAttachment(attachment)}
                  data-testid="remove-staged-attachment"
                />
              </div>
            ))}
          </div>
        ) : null}
        <ChatComposer
          value={draft.text}
          onChange={onDraftChange}
          onSubmit={() => void send()}
          input={<ChatComposerInput ref={composerInputRef} onKeyUp={rememberCursor} onMouseUp={rememberCursor} />}
          sendActions={composerActions}
          placeholder={bot === undefined ? "Select or create a bot" : isAgentReady ? "Message…" : "The bot's agent is not ready"}
          isDisabled={bot === undefined || !isAgentReady}
          data-testid="composer"
          {...(composerStatus !== undefined ? { status: composerStatus } : {})}
        />
      </div>
    </div>
  );

  return (
    <div xstyle={styles.fillColumn} data-testid="chat-panel">
      <ChatLayout composer={composer}>
        <ChatMessageList isStreaming={isStreaming} data-testid="transcript">
          {rows}
          {isStreaming && bot !== undefined ? (
            <ChatMessage
              sender="assistant"
              avatar={<AvatarView avatar={bot.avatar} name={bot.name} size="sm" activity="streaming" />}
              data-testid="streaming-message"
            >
              <ChatMessageBubble variant="filled">{delta}</ChatMessageBubble>
            </ChatMessage>
          ) : null}
        </ChatMessageList>
      </ChatLayout>
    </div>
  );
}
