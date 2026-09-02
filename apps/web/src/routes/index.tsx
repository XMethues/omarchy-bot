import { AppShell } from "@astryxdesign/core/AppShell";
import { TopNav } from "@astryxdesign/core/TopNav";
import { TopNavHeading } from "@astryxdesign/core/TopNav";
import { Banner } from "@astryxdesign/core/Banner";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "../lib/api.ts";
import { startEventPump } from "../lib/events.ts";
import { BotSidebar } from "../components/BotSidebar.tsx";
import { ChatPanel } from "../components/ChatPanel.tsx";
import { ComputerPanel } from "../components/ComputerPanel.tsx";
import type { QueryTag } from "../lib/events.ts";
import styles from "../lib/styles.ts";

export const Route = createFileRoute("/")({ component: HomeScreen });

type Tags = Record<QueryTag, string[]>;
const QUERY_KEYS: Tags = {
  bots: ["bots"],
  threads: ["threads"],
  messages: ["messages"],
  approvals: ["approvals"],
  tasks: ["tasks"],
  computer: ["computer"],
};

function HomeScreen() {
  const qc = useQueryClient();
  const [selectedBotId, setSelectedBotId] = useState<string>();
  const [selectedThreadId, setSelectedThreadId] = useState<string>();

  const invalidate = useCallback(
    (tag: QueryTag, threadId?: string) => {
      void qc.invalidateQueries({ queryKey: threadId ? [tag, threadId] : QUERY_KEYS[tag] });
    },
    [qc],
  );

  useEffect(() => {
    startEventPump(invalidate, () => void qc.invalidateQueries());
  }, [qc, invalidate]);

  const bots = useQuery({ queryKey: ["bots"], queryFn: () => api.listBots(), refetchInterval: 30_000 });
  const threads = useQuery({ queryKey: ["threads"], queryFn: () => api.listThreads(), refetchInterval: 60_000 });
  const tasks = useQuery({ queryKey: ["tasks"], queryFn: () => api.listTasks(), refetchInterval: 15_000 });
  const approvals = useQuery({ queryKey: ["approvals"], queryFn: () => api.listApprovals(), refetchInterval: 15_000 });
  const computer = useQuery({ queryKey: ["computer"], queryFn: () => api.computerState(), refetchInterval: 5_000 });

  // Default selection: first bot, its latest thread.
  useEffect(() => {
    if (selectedBotId === undefined && bots.data?.length) setSelectedBotId(bots.data[0]?.id);
  }, [bots.data, selectedBotId]);
  useEffect(() => {
    if (!selectedBotId || !threads.data) return;
    const known = threads.data.some((t) => t.id === selectedThreadId);
    if (!known) {
      const latest = threads.data
        .filter((t) => t.botId === selectedBotId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      setSelectedThreadId(latest?.id);
    }
  }, [threads.data, selectedBotId, selectedThreadId]);

  const thread = useMemo(() => threads.data?.find((t) => t.id === selectedThreadId), [threads.data, selectedThreadId]);
  const bot = useMemo(() => bots.data?.find((b) => b.id === selectedBotId), [bots.data, selectedBotId]);

  const messages = useQuery({
    queryKey: ["messages", selectedThreadId],
    queryFn: () => api.listMessages(selectedThreadId!),
    enabled: selectedThreadId !== undefined,
  });

  const recheck = useMutation({ mutationFn: api.recheckBot, onSuccess: () => invalidate("bots") });
  const newChat = useMutation({
    mutationFn: () => api.createThread({ botId: selectedBotId! }),
    onSuccess: (t) => {
      invalidate("threads");
      setSelectedThreadId(t.id);
    },
  });
  const respond = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: boolean }) => api.respondApproval(id, { decision }),
    onSuccess: () => {
      invalidate("approvals");
      invalidate("tasks");
      invalidate("messages", selectedThreadId);
    },
  });

  const pendingPermissionIds = useMemo(
    () => new Set((approvals.data ?? []).filter((a) => a.status === "pending").map((a) => a.id)),
    [approvals.data],
  );

  const needsRecheck = (bots.data ?? []).some((b) => b.status === "missing" || b.status === "unconfigured");

  return (
    <AppShell
      height="fill"
      contentPadding={0}
      variant="section"
      sideNav={
        <BotSidebar
          bots={bots.data ?? []}
          threads={threads.data ?? []}
          selectedBotId={selectedBotId}
          selectedThreadId={selectedThreadId}
          onSelectBot={(id) => {
            setSelectedBotId(id);
            setSelectedThreadId(undefined);
          }}
          onSelectThread={setSelectedThreadId}
          onNewChat={() => newChat.mutate()}
          onRecheck={(id) => recheck.mutate(id)}
        />
      }
      topNav={
        <TopNav
          label="Main"
          heading={<TopNavHeading>omarchy-bot</TopNavHeading>}
          endContent={
            <HStack gap={2}>
              <Text type="supporting" size="2xs">
                M1 · Pi Bot
              </Text>
            </HStack>
          }
        />
      }
    >
      <VStack gap={0} height="fill">
        {needsRecheck && (
          <Banner
            status="warning"
            title="Some agents are not installed or unconfigured"
            description="Click a bot's status pill to re-check it against this machine."
            container="card"
            collapsible={false}
          />
        )}
        {computer.data?.emergencyStopped && (
          <Banner status="error" title="Emergency stop is active" container="card" collapsible={false} />
        )}
        <HStack gap={0} height="fill" xstyle={styles.stretch}>
          <VStack xstyle={styles.fillColumn}>
            {thread && bot ? (
              <ChatPanel
                thread={thread}
                bot={bot}
                messages={messages.data ?? []}
                tasks={tasks.data ?? []}
                pendingPermissionIds={pendingPermissionIds}
                onRespond={(id, decision) => respond.mutate({ id, decision })}
                onSnapshotRequired={() => void qc.invalidateQueries()}
              />
            ) : (
              <VStack gap={2} padding={4}>
                <Text type="supporting">
                  {bots.data?.length ? "Select a bot and start a chat." : "Starting daemon… no bots yet."}
                </Text>
              </VStack>
            )}
          </VStack>
          <VStack padding={0} xstyle={styles.computerColumn}>
            {computer.data && (
              <ComputerPanel
                state={computer.data}
                bots={bots.data ?? []}
                threads={threads.data ?? []}
                onSnapshotRequired={() => void qc.invalidateQueries()}
              />
            )}
          </VStack>
        </HStack>
      </VStack>
    </AppShell>
  );
}
