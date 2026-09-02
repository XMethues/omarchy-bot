import type { JSX, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { ChatComposer } from "@astryxdesign/core/Chat";
import { ChatMessage } from "@astryxdesign/core/Chat";
import { ChatMessageBubble } from "@astryxdesign/core/Chat";
import { ChatMessageList } from "@astryxdesign/core/Chat";
import { ChatSystemMessage } from "@astryxdesign/core/Chat";
import { ChatToolCalls, type ChatToolCallItem } from "@astryxdesign/core/Chat";
import { ChatLayout } from "@astryxdesign/core/Chat";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Button } from "@astryxdesign/core/Button";
import type { BotViewDto, MessageDto, ThreadDto } from "@omarchy-bot/protocol";
import { getDelta, subscribeDeltas } from "../lib/live.ts";
import { api, apiErrorMessage, trimSendText } from "../lib/api.ts";
import { AvatarView } from "./AvatarView.tsx";
import styles from "../lib/styles.ts";

interface ChatPanelProps {
  bot?: BotViewDto;
  thread?: ThreadDto;
  messages: MessageDto[];
  pendingApprovalIds: Set<string>;
  onRespondApproval: (approvalId: string, decision: boolean) => void;
  onMessageSent: (threadId: string) => void;
  isAgentReady: boolean;
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

/** Window-scoped drafts: unsent text belongs to one bot+thread per window. */
function draftKey(botId: string, threadId?: string): string {
  return `draft:v1:${botId}:${threadId ?? "blank"}`;
}

export function ChatPanel({ bot, thread, messages, pendingApprovalIds, onRespondApproval, onMessageSent, isAgentReady }: ChatPanelProps): JSX.Element {
  const [draft, setDraft] = useState("");
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);
  const key = bot !== undefined ? draftKey(bot.id, thread?.id) : undefined;

  // Restore the window-local draft for this bot+thread; hide (not move) others.
  useEffect(() => {
    setSubmitError(undefined);
    if (key === undefined) {
      setDraft("");
      return;
    }
    try {
      setDraft(sessionStorage.getItem(key) ?? "");
    } catch {
      setDraft("");
    }
  }, [key]);

  const onDraftChange = useCallback(
    (value: string) => {
      setDraft(value);
      if (key !== undefined) {
        try {
          if (value !== "") sessionStorage.setItem(key, value);
          else sessionStorage.removeItem(key);
        } catch {
          /* storage unavailable — draft lives in memory only */
        }
      }
    },
    [key],
  );

  const delta = useSyncExternalStore(
    subscribeDeltas,
    () => (thread !== undefined ? getDelta(thread.id) : ""),
    () => "",
  );
  const isStreaming = thread !== undefined && delta.length > 0;

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
          avatar={sender === "assistant" && bot !== undefined ? <AvatarView avatar={bot.avatar} name={bot.name} size="sm" /> : undefined}
          data-testid={sender === "assistant" ? "assistant-message" : "user-message"}
        >
          <ChatMessageBubble variant="filled">{m.text ?? ""}</ChatMessageBubble>
        </ChatMessage>,
      );
    }
    return out;
  }, [grouped, pendingApprovalIds, onRespondApproval, bot]);

  const composerStatus =
    bot !== undefined && !isAgentReady
      ? { type: "warning" as const, message: "The bot's agent is not ready." }
      : submitError !== undefined
        ? { type: "error" as const, message: submitError }
        : undefined;
  const composer = (
    <div xstyle={styles.composerWrap}>
      <ChatComposer
        value={draft}
        onChange={onDraftChange}
        onSubmit={(value) => void send(value)}
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
            <ChatMessage sender="assistant" avatar={<AvatarView avatar={bot.avatar} name={bot.name} size="sm" />} data-testid="streaming-message">
              <ChatMessageBubble variant="filled">{delta}</ChatMessageBubble>
            </ChatMessage>
          ) : null}
        </ChatMessageList>
      </ChatLayout>
    </div>
  );
}
