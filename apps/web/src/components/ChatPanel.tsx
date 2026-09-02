import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { TextArea } from "@astryxdesign/core/TextArea";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { api } from "../lib/api.ts";
import { getDelta, subscribeDeltas } from "../lib/live.ts";
import styles from "../lib/styles.ts";
import { TASK_STATUS_VARIANT } from "./StatusBadge.tsx";
import { Badge } from "@astryxdesign/core/Badge";
import type { BotDto, MessageDto, TaskDto, ThreadDto } from "@omarchy-bot/protocol";

const TERMINAL_TASK = new Set(["completed", "cancelled", "failed"]);

function ToolCard({ message }: { message: MessageDto }) {
  const p = (message.payload ?? {}) as { toolId?: string; name?: string; state?: string; input?: unknown };
  return (
    <Card padding={2}>
      <VStack gap={1}>
        <HStack gap={2}>
          <Text type="label">tool: {p.name ?? "?"}</Text>
          <Text type="supporting" size="2xs">
            {p.state ?? ""}
          </Text>
        </HStack>
        {p.input !== undefined && (
          <Text type="code" size="2xs" as="div">
            {JSON.stringify(p.input).slice(0, 300)}
          </Text>
        )}
      </VStack>
    </Card>
  );
}

function ApprovalCard({
  message,
  pendingIds,
  onRespond,
}: {
  message: MessageDto;
  pendingIds: Set<string>;
  onRespond: (permissionId: string, decision: boolean) => void;
}) {
  const p = (message.payload ?? {}) as { permissionId?: string; tool?: string; details?: { summary?: string } };
  const permissionId = p.permissionId ?? "";
  const isPending = pendingIds.has(permissionId);
  return (
    <Card padding={2}>
      <VStack gap={1.5}>
        <Text type="label">Permission needed: {p.tool ?? "unknown tool"}</Text>
        {p.details?.summary !== undefined && (
          <Text type="supporting">{String(p.details.summary).slice(0, 400)}</Text>
        )}
        {isPending ? (
          <HStack gap={2}>
            <Button label="Allow" variant="primary" size="sm" onClick={() => onRespond(permissionId, true)} />
            <Button label="Deny" variant="destructive" size="sm" onClick={() => onRespond(permissionId, false)} />
          </HStack>
        ) : (
          <Text type="supporting" size="2xs">
            decided
          </Text>
        )}
      </VStack>
    </Card>
  );
}

function MessageRow({ message }: { message: MessageDto }) {
  if (message.kind === "tool") return <ToolCard message={message} />;
  if (message.kind === "approval") return null; // rendered separately with live pending state
  if (message.kind === "event") {
    return (
      <Text type="supporting" size="2xs" as="p">
        {message.text}
      </Text>
    );
  }
  const isUser = message.author.kind === "user";
  return (
    <VStack gap={0.5} xstyle={isUser ? styles.messageEnd : styles.messageStart}>
      <Text type="supporting" size="2xs">
        {isUser ? "you" : message.author.kind === "bot" ? message.author.botId : "system"} ·{" "}
        {new Date(message.createdAt).toLocaleTimeString()}
      </Text>
      <Card padding={2}>{message.text ?? ""}</Card>
    </VStack>
  );
}

export function ChatPanel({
  thread,
  bot,
  messages,
  tasks,
  pendingPermissionIds,
  onRespond,
  onSnapshotRequired,
}: {
  thread: ThreadDto;
  bot: BotDto;
  messages: MessageDto[];
  tasks: TaskDto[];
  pendingPermissionIds: Set<string>;
  onRespond: (permissionId: string, decision: boolean) => void;
  onSnapshotRequired: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const delta = useSyncExternalStore(
    subscribeDeltas,
    () => getDelta(thread.id),
    () => "",
  );

  const activeTask = useMemo(
    () => tasks.find((t) => t.threadId === thread.id && !TERMINAL_TASK.has(t.status)),
    [tasks, thread.id],
  );

  const approvals = messages.filter((m) => m.kind === "approval");

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, delta, activeTask?.status]);

  const send = async (): Promise<void> => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await api.sendMessage(thread.id, { text, clientTag: crypto.randomUUID() });
      setDraft("");
    } catch (err) {
      // busy or failed — surface as a note; events pump keeps state fresh
      console.error(err);
    } finally {
      setSending(false);
    }
  };

  const runningTask = activeTask ?? tasks.filter((t) => t.threadId === thread.id).at(-1);

  return (
    <VStack gap={0} height="fill">
      <VStack gap={1} padding={2}>
        <HStack gap={2}>
          <Text type="label">{thread.title}</Text>
          <Text type="supporting" size="2xs">
            {bot.displayName} · {thread.cwd ?? bot.defaultCwd}
          </Text>
        </HStack>
        {runningTask && (
          <HStack gap={2}>
            <Badge
              variant={TASK_STATUS_VARIANT[runningTask.status] ?? "neutral"}
              label={`task: ${runningTask.status.replaceAll("_", " ")}`}
            />
            {activeTask && (
              <Button
                label="Stop"
                variant="destructive"
                size="sm"
                onClick={() => void api.abortTask(activeTask.id)}
              />
            )}
          </HStack>
        )}
      </VStack>

      <VStack gap={2} padding={2} xstyle={styles.scrollArea}>
        {messages.map((m) => (
          <MessageRow key={m.id} message={m} />
        ))}
        {approvals.map((m) => (
          <ApprovalCard key={m.id} message={m} pendingIds={pendingPermissionIds} onRespond={onRespond} />
        ))}
        {delta !== "" && (
          <VStack gap={0.5} xstyle={styles.messageStart}>
            <Text type="supporting" size="2xs">
              {bot.displayName} · typing…
            </Text>
            <Card padding={2}>{delta}</Card>
          </VStack>
        )}
        <div ref={bottomRef} />
      </VStack>

      <HStack gap={2} padding={2} xstyle={styles.composer}>
        <TextArea
          label="Message"
          isLabelHidden
          value={draft}
          onChange={setDraft}
          placeholder={`Message ${bot.displayName}…`}
        />
        <Button label={sending ? "Sending…" : "Send"} variant="primary" isLoading={sending} onClick={() => void send()} />
      </HStack>
    </VStack>
  );
}
