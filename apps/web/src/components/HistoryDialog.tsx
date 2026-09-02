import type { JSX } from "react";
import { useEffect, useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Item } from "@astryxdesign/core/Item";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { VStack } from "@astryxdesign/core/VStack";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { History, Plus } from "lucide-react";
import type { ThreadDto } from "@omarchy-bot/protocol";
import { api, apiErrorMessage } from "../lib/api.ts";

export interface HistoryDialogProps {
  botId: string;
  open: boolean;
  onClose: () => void;
  onSelectThread: (threadId: string) => void;
  onNewConversation: () => void;
}

interface HistoryContentProps {
  compactHeading: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  threads: ThreadDto[];
  loading: boolean;
  error?: string;
  onSelectThread: (threadId: string) => void;
  onNewConversation: () => void;
}

function HistoryContent({
  compactHeading,
  query,
  onQueryChange,
  threads,
  loading,
  error,
  onSelectThread,
  onNewConversation,
}: HistoryContentProps): JSX.Element {
  return (
    <VStack gap={3} padding={4} data-testid="history-dialog">
      {compactHeading ? <Heading level={2}>Conversation history</Heading> : null}
      <Button
        label="New conversation"
        variant="primary"
        icon={<Plus size={16} />}
        onClick={onNewConversation}
        data-testid="history-new-conversation"
      />
      <TextInput
        label="Search conversations"
        value={query}
        onChange={onQueryChange}
        placeholder="Search by title"
        data-testid="history-search"
      />
      {error !== undefined ? <Banner status="error" title={error} /> : null}
      {loading ? <Text color="secondary">Loading conversations…</Text> : null}
      {!loading && error === undefined && threads.length === 0 ? (
        <EmptyState
          icon={<History size={24} />}
          title={query.trim() === "" ? "No conversations yet" : "No matching conversations"}
          description={query.trim() === "" ? "Start a new conversation when you are ready." : "Try a different title."}
          isCompact
        />
      ) : null}
      {!loading
        ? threads.map((thread) => (
            <Item
              key={thread.id}
              label={thread.title}
              description="Conversation"
              endContent={<Timestamp value={thread.updatedAt} format="relative_short" />}
              onClick={() => onSelectThread(thread.id)}
              data-testid={`history-thread-${thread.id}`}
            />
          ))
        : null}
    </VStack>
  );
}

/** Responsive history surface: Dialog on desktop, native-feeling BottomSheet on small screens. */
export function HistoryDialog({
  botId,
  open,
  onClose,
  onSelectThread,
  onNewConversation,
}: HistoryDialogProps): JSX.Element {
  const isSmallScreen = useMediaQuery("(max-width: 640px)");
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState<ThreadDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setQuery("");
    setThreads([]);
    setError(undefined);
  }, [botId]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(undefined);

    void api
      .listBotThreads(botId, query.trim())
      .then((list) => {
        if (!cancelled) setThreads(list);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setThreads([]);
          setError(apiErrorMessage(loadError, "Conversation history could not be loaded."));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [botId, open, query]);

  const selectThread = (threadId: string): void => {
    onSelectThread(threadId);
    onClose();
  };
  const startNewConversation = (): void => {
    onNewConversation();
    onClose();
  };

  const content = (
    <HistoryContent
      compactHeading={isSmallScreen}
      query={query}
      onQueryChange={setQuery}
      threads={threads}
      loading={loading}
      {...(error !== undefined ? { error } : {})}
      onSelectThread={selectThread}
      onNewConversation={startNewConversation}
    />
  );

  if (isSmallScreen) {
    return (
      <BottomSheet label="Conversation history" isOpen={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} height="tall">
        {content}
      </BottomSheet>
    );
  }

  return (
    <Dialog isOpen={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} width={560}>
      <DialogHeader title="Conversation history" subtitle="Search and return to this bot's recent conversations." />
      {content}
    </Dialog>
  );
}
