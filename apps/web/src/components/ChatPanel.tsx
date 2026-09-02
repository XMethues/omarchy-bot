import type { JSX, ReactNode } from "react";
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
import type { BotViewDto, DictationDto, DictationResultDto, MessageDto, ThreadDto } from "@omarchy-bot/protocol";
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
  pendingApprovalIds: Set<string>;
  onRespondApproval: (approvalId: string, decision: boolean) => void;
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
      message.kind === "approval" ||
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
interface DictationOrigin {
  target: VoiceDraftTarget;
  anchor: number;
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
  pendingApprovalIds,
  onRespondApproval,
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
  const composerInputRef = useRef<HTMLDivElement>(null);
  const dictationOriginRef = useRef<DictationOrigin | undefined>(undefined);
  const draftBotId = bot?.id;
  const draftThreadId = thread?.id;
  const selectedDraftRef = useRef({ botId: draftBotId, threadId: draftThreadId });
  selectedDraftRef.current = { botId: draftBotId, threadId: draftThreadId };

  // Restore the window-local draft for this bot+thread; hide (not move) others.
  useEffect(() => {
    setSubmitError(undefined);
    setDraft(draftBotId === undefined ? EMPTY_DRAFT : loadDraft(draftBotId, draftThreadId));
  }, [draftBotId, draftThreadId]);

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
          saveOriginDraft(origin, EMPTY_DRAFT);
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
    async (text: string): Promise<void> => {
      const trimmed = trimSendText(text);
      if (trimmed.length === 0 || bot === undefined) return;
      setSubmitError(undefined);
      try {
        if (thread !== undefined) {
          const res = await api.sendMessage(thread.id, { text: trimmed, clientTag: crypto.randomUUID() });
          onMessageSent(res.threadId);
        } else {
          const res = await api.sendBotMessage(bot.id, { text: trimmed, clientTag: crypto.randomUUID() });
          onMessageSent(res.threadId);
        }
        onDraftChange("");
      } catch (error) {
        setSubmitError(apiErrorMessage(error, "Message could not be sent."));
      }
    },
    [bot, thread, onMessageSent, onDraftChange],
  );

  const rows = useMemo(() => {
    const out: ReactNode[] = [];
    for (const g of grouped) {
      if (g.kind === "activity") {
        const calls: ChatToolCallItem[] = g.items.map((message) => {
          const tool = stringPayloadField(message.payload, "tool");
          const name = stringPayloadField(message.payload, "name");
          const capability = stringPayloadField(message.payload, "capability");
          const state = stringPayloadField(message.payload, "state");
          const isApproval = message.kind === "approval";
          return {
            key: message.id,
            name: isApproval
              ? `Approval: ${tool ?? "tool"}`
              : message.kind === "event"
                ? capability ?? "Agent event"
                : name ?? "Tool",
            status: isApproval ? "pending" : state === "running" ? "running" : state === "error" ? "error" : "complete",
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
                {g.items.map((message) => {
                  const approvalId = stringPayloadField(message.payload, "approvalId");
                  if (message.kind !== "approval" || approvalId === undefined) return null;
                  const tool = stringPayloadField(message.payload, "tool");
                  const pending = pendingApprovalIds.has(approvalId);
                  return (
                    <div key={`${message.id}-approval`} xstyle={styles.approvalRow} data-testid="approval-card">
                      <span>{`Approval requested: ${tool ?? "tool"}`}</span>
                      {pending ? (
                        <>
                          <Button label="Allow" variant="primary" size="sm" onClick={() => onRespondApproval(approvalId, true)} data-testid="approval-allow" />
                          <Button label="Deny" variant="secondary" size="sm" onClick={() => onRespondApproval(approvalId, false)} data-testid="approval-deny" />
                        </>
                      ) : (
                        <span style={{ color: "var(--color-text-secondary)" }}>decided</span>
                      )}
                    </div>
                  );
                })}
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
          <ChatMessageBubble variant="filled">{m.text ?? ""}</ChatMessageBubble>
        </ChatMessage>,
      );
    }
    return out;
  }, [grouped, pendingApprovalIds, onRespondApproval, bot]);

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
  const composer = (
    <div xstyle={styles.composerWrap}>
      <ChatComposer
        value={draft.text}
        onChange={onDraftChange}
        onSubmit={(value) => void send(value)}
        input={<ChatComposerInput ref={composerInputRef} onKeyUp={rememberCursor} onMouseUp={rememberCursor} />}
        sendActions={dictationButton}
        placeholder={bot === undefined ? "Select or create a bot" : isAgentReady ? "Message…" : "The bot's agent is not ready"}
        isDisabled={bot === undefined || !isAgentReady}
        data-testid="composer"
        {...(composerStatus !== undefined ? { status: composerStatus } : {})}
      />
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
