import type { ChangeEvent, DragEvent, JSX, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import * as stylex from "@stylexjs/stylex";
import { Paperclip } from "lucide-react";
import { AspectRatio } from "@astryxdesign/core/AspectRatio";
import { Button } from "@astryxdesign/core/Button";
import {
  ChatComposer,
  ChatComposerDrawer,
  ChatComposerInput,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatSystemMessage,
  ChatToolCalls,
  type ChatToolCallItem,
} from "@astryxdesign/core/Chat";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Item } from "@astryxdesign/core/Item";
import { Token } from "@astryxdesign/core/Token";
import { VStack } from "@astryxdesign/core/VStack";
import type { AttachmentDto, BotViewDto, DictationDto, DictationResultDto, MessageDto, ThreadDto } from "@omarchy-bot/protocol";
import { getDelta, subscribeDeltas } from "../lib/live.ts";
import { api, apiErrorMessage, trimSendText } from "../lib/api.ts";
import { loadDraft, saveDraft, type ConversationDraft } from "../lib/drafts.ts";
import { insertDictationTranscript } from "../lib/dictation.ts";
import { AvatarView } from "./AvatarView.tsx";
import { useTranscriptAttentionSurface } from "./TranscriptAttention.tsx";
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
  supportsSteering: boolean;
  dictation: DictationController;
  autoSendVoice: boolean;
  onVoiceAutoSend: (target: VoiceDraftTarget, text: string) => Promise<void>;
  messagesLoading?: boolean;
  messagesError?: string;
  onRetryMessages?: () => void;
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
  const status = apiStatus(error);
  if (status === 413) return `${fileName} is too large to attach. Choose a smaller file and try again.`;
  if (status === 400 || status === 415) {
    return `This bot can’t use ${fileName}. Remove it or choose a supported file.`;
  }
  return `${fileName} couldn’t be attached. Check your connection and try again.`;
}

function AttachmentContent({ attachment, previewUrl }: { attachment: AttachmentDto; previewUrl?: string }): JSX.Element {
  const imageUrl = attachment.mediaType.startsWith("image/")
    ? previewUrl ?? attachment.url
    : undefined;
  const metadata = `${attachment.mediaType} · ${formatAttachmentSize(attachment.size)}`;
  if (imageUrl !== undefined) {
    return (
      <AspectRatio ratio={4 / 3} fit="cover" xstyle={styles.attachmentPreview}>
        <img
          src={imageUrl}
          alt={attachment.name}
          loading="lazy"
          {...stylex.props(styles.attachmentImage)}
          data-testid={attachment.kind === "managed" ? "message-image-attachment" : "staged-image-preview"}
        />
      </AspectRatio>
    );
  }
  return (
    <Item
      label={attachment.name}
      description={metadata}
      density="compact"
      {...(attachment.url !== undefined ? { href: attachment.url } : {})}
      data-testid={attachment.url !== undefined ? "message-file-attachment" : "staged-file-row"}
    />
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
  supportsSteering,
  dictation,
  autoSendVoice,
  onVoiceAutoSend,
  messagesLoading = false,
  messagesError,
  onRetryMessages,
}: ChatPanelProps): JSX.Element {
  const [draft, setDraft] = useState<ConversationDraft>(EMPTY_DRAFT);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  const [voiceStatus, setVoiceStatus] = useState<string | undefined>(undefined);
  const [voiceState, setVoiceState] = useState<DictationDto>(dictation.state);
  const [stagedAttachments, setStagedAttachments] = useState<AttachmentDto[]>([]);
  const [restoringAttachments, setRestoringAttachments] = useState(false);
  const composerInputRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Map<string, string>());
  const restoreGenerationRef = useRef(0);
  const dictationOriginRef = useRef<DictationOrigin | undefined>(undefined);
  const draftBotId = bot?.id;
  const draftThreadId = thread?.id;
  const selectedDraftRef = useRef({ botId: draftBotId, threadId: draftThreadId });
  const transcriptAttention = useTranscriptAttentionSurface();
  selectedDraftRef.current = { botId: draftBotId, threadId: draftThreadId };

  // Restore this conversation's staged files without blocking text editing.
  useEffect(() => {
    const generation = ++restoreGenerationRef.current;
    setSubmitError(undefined);
    setStagedAttachments([]);
    if (draftBotId === undefined) {
      setDraft(EMPTY_DRAFT);
      setRestoringAttachments(false);
      return;
    }

    const restored = loadDraft(draftBotId, draftThreadId);
    setDraft(restored);
    if (restored.stagedIds.length === 0) {
      setRestoringAttachments(false);
      return;
    }
    setRestoringAttachments(true);
    const draftToken = restored.attachmentDraftToken;
    if (draftToken === undefined) {
      const next = { ...restored, stagedIds: [] };
      saveDraft(draftBotId, draftThreadId, next);
      setDraft(next);
      setRestoringAttachments(false);
      setSubmitError("Staged attachments from an older draft are no longer available and were removed from this draft.");
      return;
    }
    void Promise.all(restored.stagedIds.map(async (id): Promise<AttachmentRestoreResult> => {
      try {
        return { id, attachment: await api.getStagedAttachment(id, draftToken) };
      } catch (error) {
        return { id, error };
      }
    })).then((results) => {
      if (restoreGenerationRef.current !== generation) return;
      const valid = results.flatMap((result) => result.attachment === undefined ? [] : [result.attachment]);
      const missing = new Set(results.filter((result) => result.error !== undefined && apiStatus(result.error) === 404).map((result) => result.id));
      const unavailable = results.some((result) => result.error !== undefined && apiStatus(result.error) !== 404);
      const stagedIds = restored.stagedIds.filter((id) => !missing.has(id));
      const next: ConversationDraft = {
        ...restored,
        stagedIds,
        ...(stagedIds.length === 0 ? { attachmentDraftToken: undefined } : {}),
      };
      if (missing.size > 0) saveDraft(draftBotId, draftThreadId, next);
      setDraft(next);
      setStagedAttachments(valid);
      setRestoringAttachments(false);
      if (missing.size > 0) {
        setSubmitError(`${missing.size === 1 ? "A staged attachment is" : `${missing.size} staged attachments are`} no longer available and ${missing.size === 1 ? "was" : "were"} removed from this draft.`);
      } else if (unavailable) {
        setSubmitError("Some draft attachments couldn’t be checked. They are still saved with this draft; check your connection and try again.");
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
    const storedDraft = loadDraft(origin.botId, origin.threadId);
    const draftToken = storedDraft.attachmentDraftToken ?? crypto.randomUUID();
    const ownedDraft = { ...storedDraft, attachmentDraftToken: draftToken };
    saveDraft(origin.botId, origin.threadId, ownedDraft);
    setDraft((current) => {
      const selected = selectedDraftRef.current;
      return selected.botId === origin.botId && selected.threadId === origin.threadId
        ? { ...current, attachmentDraftToken: draftToken }
        : current;
    });
    setSubmitError(undefined);
    const staged: AttachmentDto[] = [];
    const errors: string[] = [];
    for (const file of files) {
      try {
        const attachment = await api.stageAttachment(origin.botId, draftToken, file);
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
        attachmentDraftToken: draftToken,
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
    if (errors.length > 0) {
      const selected = selectedDraftRef.current;
      if (selected.botId === origin.botId && selected.threadId === origin.threadId) {
        setSubmitError(errors.join(" "));
      }
    }
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
    const draftToken = stored.attachmentDraftToken;
    const next = { ...stored, stagedIds: stored.stagedIds.filter((id) => id !== attachment.id) };
    saveDraft(origin.botId, origin.threadId, next);
    const selected = selectedDraftRef.current;
    if (selected.botId === origin.botId && selected.threadId === origin.threadId) {
      setSubmitError(undefined);
      setDraft(next);
      setStagedAttachments((current) => current.filter((candidate) => candidate.id !== attachment.id));
    }

    try {
      if (draftToken === undefined) return;
      await api.unstageAttachment(attachment.id, draftToken);
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
      saveOriginDraft(origin, {
        text: stored.text,
        cursor: stored.cursor,
        stagedIds: stored.stagedIds,
        ...(stored.attachmentDraftToken !== undefined
          ? { attachmentDraftToken: stored.attachmentDraftToken }
          : {}),
      });
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
      const inserted: ConversationDraft = {
        ...insertDictationTranscript(latest, result.text, origin.anchor),
        ...(latest.attachmentDraftToken !== undefined
          ? { attachmentDraftToken: latest.attachmentDraftToken }
          : {}),
      };
      saveOriginDraft(origin, inserted);
      if (autoSendVoice) {
        try {
          await onVoiceAutoSend(origin.target, inserted.text);
          saveOriginDraft(origin, {
            ...EMPTY_DRAFT,
            stagedIds: inserted.stagedIds,
            ...(inserted.attachmentDraftToken !== undefined
              ? { attachmentDraftToken: inserted.attachmentDraftToken }
              : {}),
          });
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
  const activeTurnCannotSteer = thread?.activeTurn !== undefined && !supportsSteering;

  const grouped = useMemo(() => groupMessages(messages), [messages]);

  const send = useCallback(
    async (): Promise<void> => {
      const trimmed = trimSendText(draft.text);
      if (trimmed.length === 0 || bot === undefined || activeTurnCannotSteer) return;
      const originThreadId = thread?.id;
      const attachmentIds = [...draft.stagedIds];
      const preservedDraft = { ...draft };
      const origin = { botId: bot.id, threadId: originThreadId };
      const body = {
        text: trimmed,
        clientTag: crypto.randomUUID(),
        ...(attachmentIds.length > 0
          ? { attachmentIds, attachmentDraftToken: draft.attachmentDraftToken }
          : {}),
      };
      setSubmitError(undefined);
      try {
        const response = thread !== undefined
          ? await api.sendMessage(thread.id, body)
          : await api.sendBotMessage(bot.id, body);
        saveDraft(bot.id, originThreadId, EMPTY_DRAFT);
        const selected = selectedDraftRef.current;
        if (selected.botId === origin.botId && selected.threadId === origin.threadId) {
          setDraft(EMPTY_DRAFT);
          setStagedAttachments([]);
        }
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
        const selected = selectedDraftRef.current;
        if (selected.botId === origin.botId && selected.threadId === origin.threadId) {
          setDraft(preservedDraft);
          setSubmitError(apiErrorMessage(error, "Message could not be sent."));
        }
      }
    },
    [bot, thread, draft, onMessageSent, activeTurnCannotSteer],
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
          };
        });
        out.push(
          <ChatMessage key={g.key} sender="system">
            <div {...stylex.props(styles.activityWrap)}>
              <Collapsible trigger={`Activity (${g.items.length})`} defaultIsOpen={false} data-testid="activity">
                <ChatToolCalls calls={calls} isExpanded />
              </Collapsible>
            </div>
          </ChatMessage>,
        );
        continue;
      }
      const message = g.message;
      if (message.author.kind === "system") {
        out.push(<ChatSystemMessage key={message.id}>{message.text ?? ""}</ChatSystemMessage>);
        continue;
      }

      const sender = message.author.kind === "user" ? "user" : "assistant";
      out.push(
        <ChatMessage
          key={message.id}
          sender={sender}
          avatar={
            sender === "assistant" && bot !== undefined ? (
              <AvatarView avatar={bot.avatar} name={bot.name} size="sm" activity={bot.status === "working" ? "working" : "selected"} />
            ) : undefined
          }
          data-testid={sender === "assistant" ? "assistant-message" : "user-message"}
        >
          <ChatMessageBubble variant="filled">
            <div {...stylex.props(styles.messageContent)}>
              {message.text !== undefined ? <span>{message.text}</span> : null}
              {message.attachments?.map((attachment) => <AttachmentContent key={attachment.id} attachment={attachment} />)}
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
    submitError !== undefined
      ? { type: "error" as const, message: submitError }
      : voiceMessage !== undefined
        ? {
            type: voiceState.state === "recording" || voiceState.state === "transcribing" ? ("warning" as const) : ("error" as const),
            message: voiceMessage,
          }
        : voiceState.state === "unavailable"
          ? { type: "warning" as const, message: voiceState.error ?? "Voice dictation isn’t available right now." }
          : restoringAttachments
            ? { type: "warning" as const, message: "Checking draft attachments…" }
            : activeTurnCannotSteer
              ? { type: "warning" as const, message: "This agent does not support steering an active turn." }
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
      isDisabled={bot === undefined || activeTurnCannotSteer || voiceState.state === "transcribing" || voiceState.state === "unavailable"}
      onClick={() => void (voiceState.state === "recording" ? stopDictation() : startDictation())}
      data-testid="dictation-button"
      data-state={voiceState.state}
    />
  );

  const attachmentDrawer = stagedAttachments.length > 0 ? (
    <ChatComposerDrawer count={stagedAttachments.length} label="Attachments">
      <VStack gap={1} aria-label="Staged attachments">
        {stagedAttachments.map((attachment) => {
          const previewUrl = previewUrlsRef.current.get(attachment.id);
          const isImage = attachment.mediaType.startsWith("image/") && previewUrl !== undefined;
          return (
            <div
              key={attachment.id}
              data-testid="staged-attachment"
              data-attachment-id={attachment.id}
            >
              <Item
                label={attachment.name}
                description={attachment.mediaType}
                density="compact"
                startContent={
                  isImage ? (
                    <AspectRatio ratio={1} fit="cover" xstyle={styles.attachmentThumbnail}>
                      <img
                        src={previewUrl}
                        alt={attachment.name}
                        {...stylex.props(styles.attachmentImage)}
                        data-testid="staged-image-preview"
                      />
                    </AspectRatio>
                  ) : (
                    <Icon icon="info" size="sm" />
                  )
                }
                endContent={
                  <HStack gap={1}>
                    <Token
                      label={formatAttachmentSize(attachment.size)}
                      size="sm"
                      description={`File size for ${attachment.name}`}
                    />
                    <Button
                      label={`Remove ${attachment.name}`}
                      icon={<Icon icon="close" size="sm" />}
                      variant="ghost"
                      size="sm"
                      isIconOnly
                      onClick={() => void removeStagedAttachment(attachment)}
                      data-testid="remove-staged-attachment"
                    />
                  </HStack>
                }
                {...(!isImage ? { "data-testid": "staged-file-row" } : {})}
              />
            </div>
          );
        })}
      </VStack>
    </ChatComposerDrawer>
  ) : undefined;

  const composer = (
    <div {...stylex.props(styles.composerWrap)}>
      <div
        {...stylex.props(styles.composerDropZone)}
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropFiles}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          aria-label="Choose files to attach"
          onChange={selectFiles}
          {...stylex.props(styles.hiddenFileInput)}
          data-testid="attachment-input"
          tabIndex={-1}
        />
        <ChatComposer
          value={draft.text}
          onChange={onDraftChange}
          onSubmit={() => void send()}
          input={<ChatComposerInput ref={composerInputRef} onKeyUp={rememberCursor} onMouseUp={rememberCursor} />}
          {...(attachmentDrawer !== undefined ? { drawer: attachmentDrawer } : {})}
          headerActions={
            <Button
              label="Attach files"
              icon={<Icon icon={Paperclip} size="sm" />}
              variant="ghost"
              size="sm"
              isIconOnly
              isDisabled={bot === undefined || activeTurnCannotSteer}
              onClick={() => fileInputRef.current?.click()}
              data-testid="attachment-picker"
            />
          }
          sendActions={dictationButton}
          placeholder={
            bot === undefined
              ? "Select or create a bot"
              : !isAgentReady
                ? "This bot’s agent isn’t ready"
                : activeTurnCannotSteer
                  ? "Wait for this turn to finish"
                  : "Message…"
          }
          isDisabled={bot === undefined || !isAgentReady || activeTurnCannotSteer}
          data-testid="composer"
          {...(composerStatus !== undefined ? { status: composerStatus } : {})}
        />
      </div>
    </div>
  );

  const transcriptEmptyState = messagesLoading ? (
    <EmptyState
      icon={<Icon icon="clock" size="lg" />}
      title="Loading conversation"
      description="Fetching this bot’s messages."
      isCompact
    />
  ) : messagesError !== undefined ? (
    <EmptyState
      icon={<Icon icon="warning" size="lg" />}
      title="Conversation couldn’t load"
      description={messagesError}
      {...(onRetryMessages !== undefined
        ? { actions: <Button label="Try loading again" variant="secondary" onClick={onRetryMessages} /> }
        : {})}
      isCompact
    />
  ) : bot === undefined ? (
    <EmptyState
      icon={<Icon icon="info" size="lg" />}
      title="Choose a bot"
      description="Select or create a bot to begin a conversation."
      isCompact
    />
  ) : undefined;

  const transcriptContent = messagesLoading || messagesError !== undefined ? [] : [...rows];
  if (isStreaming && bot !== undefined && !messagesLoading && messagesError === undefined) {
    transcriptContent.push(
      <ChatMessage
        key="streaming-response"
        sender="assistant"
        avatar={<AvatarView avatar={bot.avatar} name={bot.name} size="sm" activity="streaming" />}
        data-testid="streaming-message"
      >
        <ChatMessageBubble variant="filled">
          {delta.length > 0 ? delta : <span {...stylex.props(styles.workingIndicator)}>{bot.name} is working…</span>}
        </ChatMessageBubble>
      </ChatMessage>,
    );
  }

  return (
    <div {...stylex.props(styles.fillColumn)} data-testid="chat-panel">
      <ChatLayout
        {...(transcriptAttention !== null
          ? { ref: transcriptAttention.viewportRef, onScroll: transcriptAttention.onViewportScroll }
          : {})}
        composer={composer}
      >
        <ChatMessageList
          isStreaming={isStreaming && !messagesLoading && messagesError === undefined}
          emptyState={transcriptEmptyState}
          data-testid="transcript"
        >
          {transcriptContent}
        </ChatMessageList>
      </ChatLayout>
    </div>
  );
}
