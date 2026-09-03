import type { JSX, ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { VStack } from "@astryxdesign/core/VStack";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api, apiErrorMessage } from "../lib/api.ts";
import { requestDesktopNotificationPermission, startEventPump, type QueryTag } from "../lib/events.ts";
import { mostRecentlyActiveBot, Sidebar } from "../components/Sidebar.tsx";
import { clearDraftsByBot } from "../lib/drafts.ts";
import { ConversationHeader } from "../components/ConversationHeader.tsx";
import { ChatPanel } from "../components/ChatPanel.tsx";
import { CreateBotDialog } from "../components/CreateBotDialog.tsx";
import { HistoryDialog } from "../components/HistoryDialog.tsx";
import { ProfileDialog } from "../components/ProfileDialog.tsx";
import { SettingsDialog } from "../components/SettingsDialog.tsx";
import { ComputerSheet } from "../components/ComputerSheet.tsx";
import { EmergencyComputerControl } from "../components/EmergencyComputerControl.tsx";
import { VoiceSettingsControl, useVoiceAutoSendSetting } from "../components/VoiceSettingsControl.tsx";
import { TranscriptAttention } from "../components/TranscriptAttention.tsx";

export const Route = createFileRoute("/")({
  component: HomeScreen,
  // Selection lives in the URL so a refresh restores it (contract §Web app).
  validateSearch: (search: Record<string, unknown>): { bot?: string; thread?: string } => ({
    ...(typeof search.bot === "string" ? { bot: search.bot } : {}),
    ...(typeof search.thread === "string" ? { thread: search.thread } : {}),
  }),
});

type Tags = Record<QueryTag, string[]>;
const QUERY_KEYS: Tags = {
  agents: ["agents"],
  bots: ["bots"],
  threads: ["threads"],
  messages: ["messages"],
  dictation: ["dictation"],
  turns: ["turns"],
  computer: ["computer"],
};

function HomeScreen(): JSX.Element {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { bot: selectedBotId, thread: selectedThreadId } = Route.useSearch();
  const [createOpen, setCreateOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [computerOpen, setComputerOpen] = useState(false);
  const [computerError, setComputerError] = useState<string | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autoSendVoice, setAutoSendVoice] = useVoiceAutoSendSetting();
  const [isOnline, setIsOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const selectedBotRef = useRef<string | undefined>(selectedBotId);
  const botNamesRef = useRef<Record<string, string>>({});
  selectedBotRef.current = selectedBotId;

  const invalidate = useCallback(
    (tag: QueryTag, threadId?: string) => {
      void qc.invalidateQueries({ queryKey: threadId ? [tag, threadId] : QUERY_KEYS[tag] });
    },
    [qc],
  );

  useEffect(() => {
    startEventPump(invalidate, () => void qc.invalidateQueries(), () => {
      const current = selectedBotRef.current;
      return {
        ...(current !== undefined ? { selectedBotId: current } : {}),
        botName: (botId) => botNamesRef.current[botId],
      };
    });
  }, [qc, invalidate]);

  useEffect(() => {
    const markOnline = (): void => setIsOnline(true);
    const markOffline = (): void => setIsOnline(false);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);
    return () => {
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
    };
  }, []);

  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api.listAgents(), refetchInterval: 30_000 });
  const bots = useQuery({ queryKey: ["bots"], queryFn: () => api.listBots(), refetchInterval: 30_000 });
  botNamesRef.current = Object.fromEntries((bots.data ?? []).map((candidate) => [candidate.id, candidate.name]));
  const allBots = useQuery({
    queryKey: ["bots", "all"],
    queryFn: () => api.listBots(true),
    enabled: settingsOpen,
  });
  const dictation = useQuery({
    queryKey: ["dictation"],
    queryFn: () => api.dictation(),
    refetchInterval: 15_000,
  });
  const dictationController = useMemo(
    () => ({
      state: dictation.data ?? { state: "unavailable" as const },
      start: async () => {
        const state = await api.startDictation();
        qc.setQueryData(["dictation"], state);
        return state;
      },
      stop: async () => {
        const result = await api.stopDictation();
        invalidate("dictation");
        return result;
      },
      cancel: async () => {
        const state = await api.cancelDictation();
        qc.setQueryData(["dictation"], state);
        return state;
      },
    }),
    [dictation.data, invalidate, qc],
  );

  const bot = useMemo(() => bots.data?.find((b) => b.id === selectedBotId), [bots.data, selectedBotId]);
  const computer = useQuery({
    queryKey: ["computer", bot?.id],
    queryFn: () => api.computerState(bot?.id),
    refetchInterval: 15_000,
  });
  const computerSafety = useQuery({
    queryKey: ["computer", "global"],
    queryFn: () => api.computerState(),
    refetchInterval: 15_000,
  });

  const computerAction = useMutation({
    mutationFn: (action: "take" | "return" | "stop" | "resume") => {
      if (action === "take") return api.takeControl();
      if (action === "return") return api.returnToBot();
      if (action === "stop") return api.emergencyStop();
      return api.resumeComputer();
    },
    onSuccess: () => {
      setComputerError(undefined);
      invalidate("computer");
    },
    onError: (error) => setComputerError(apiErrorMessage(error, "Computer control could not be updated.")),
  });

  const threads = useQuery({
    queryKey: ["threads", bot?.id],
    queryFn: () => api.listBotThreads(bot!.id),
    enabled: bot !== undefined,
    refetchInterval: 60_000,
  });

  // Startup and archive fallback select the most recent available Bot.
  useEffect(() => {
    if (bots.data === undefined) return;
    if (selectedBotId !== undefined && bots.data.some((candidate) => candidate.id === selectedBotId)) return;
    if (selectedBotId !== undefined) clearDraftsByBot(selectedBotId);
    const first = mostRecentlyActiveBot(bots.data);
    if (first === undefined) {
      if (selectedBotId !== undefined) void navigate({ search: {}, replace: true });
      return;
    }
    void navigate({ search: { bot: first.id }, replace: true });
  }, [selectedBotId, bots.data, navigate]);

  // Resolve the selected thread; `blank` keeps the genuinely empty composer.
  const thread = useMemo(() => {
    if (selectedThreadId === undefined || selectedThreadId === "blank") return undefined;
    return threads.data?.find((t) => t.id === selectedThreadId);
  }, [threads.data, selectedThreadId]);

  // When a bot is selected without an explicit thread, open its most recent one.
  useEffect(() => {
    if (bot === undefined || selectedThreadId !== undefined || threads.data === undefined) return;
    const latest = threads.data[0];
    void navigate({ search: { bot: bot.id, thread: latest?.id ?? "blank" }, replace: true });
  }, [bot, selectedThreadId, threads.data, navigate]);

  const messages = useQuery({
    queryKey: ["messages", thread?.id],
    queryFn: () => api.listMessages(thread!.id),
    enabled: thread !== undefined,
    refetchInterval: 15_000,
  });


  const selectBot = useCallback(
    (botId: string): void => {
      invalidate("computer");
      // Drop the thread param: the resolution effect below opens the newly
      // selected bot's most recent thread or a genuinely blank composer.
      void navigate({ search: { bot: botId } });
    },
    [navigate, invalidate],
  );

  const onMessageSent = useCallback(
    (threadId: string): void => {
      invalidate("threads");
      invalidate("bots");
      if (bot !== undefined && threadId !== selectedThreadId) {
        void navigate({ search: { bot: bot.id, thread: threadId } });
      }
    },
    [bot, selectedThreadId, navigate, invalidate],
  );

  const selectedAgent = useMemo(
    () => (bot === undefined ? undefined : agents.data?.find((candidate) => candidate.id === bot.agentId)),
    [agents.data, bot],
  );
  const isAgentReady = selectedAgent?.status === "ready";

  const workspaceBanner: ReactNode =
    !isOnline ? (
      <Banner
        status="warning"
        title="You’re offline"
        description="Drafts remain available. Reconnect to send messages or refresh workspace data."
        container="section"
      />
    ) : bots.error !== null && bots.data !== undefined ? (
      <Banner
        status="error"
        title="Workspace refresh failed"
        description={apiErrorMessage(bots.error, "Your bots could not be refreshed.")}
        container="section"
        endContent={
          <Button label="Retry" variant="secondary" size="sm" onClick={() => void bots.refetch()} />
        }
      />
    ) : undefined;

  const conversationNotice: ReactNode =
    bot !== undefined && threads.error !== null ? (
      <Banner
        status="error"
        title="Conversations could not be loaded"
        description={apiErrorMessage(threads.error, "Try loading this bot’s conversations again.")}
        container="section"
        endContent={
          <Button label="Retry" variant="secondary" size="sm" onClick={() => void threads.refetch()} />
        }
      />
    ) : bot !== undefined && threads.isPending ? (
      <Banner
        status="info"
        title="Loading conversations"
        description="Your composer will be ready while recent conversation history loads."
        container="section"
      />
    ) : bot !== undefined && agents.error !== null ? (
      <Banner
        status="error"
        title="Agent status could not be loaded"
        description={apiErrorMessage(agents.error, "The selected bot’s agent status is unknown.")}
        container="section"
        endContent={
          <Button label="Retry" variant="secondary" size="sm" onClick={() => void agents.refetch()} />
        }
      />
    ) : bot !== undefined && agents.isPending ? (
      <Banner
        status="info"
        title="Checking agent availability"
        description="You can review this conversation while the agent connection is checked."
        container="section"
      />
    ) : bot !== undefined && !isAgentReady ? (
      <Banner
        status="warning"
        title="Agent unavailable"
        description="This bot’s conversation is still available, but new messages cannot be sent until its agent is ready."
        container="section"
      />
    ) : undefined;

  let workspaceContent: ReactNode;
  if (bots.isPending && bots.data === undefined) {
    workspaceContent = (
      <VStack
        gap={3}
        padding={6}
        role="status"
        aria-label="Loading workspace"
        data-testid="workspace-loading"
      >
        <Skeleton width="100%" height="var(--spacing-4)" radius={3} />
        <Skeleton width="100%" height="var(--spacing-10)" radius={3} index={1} />
        <Skeleton width="100%" height="var(--spacing-4)" radius={3} index={2} />
      </VStack>
    );
  } else if (bots.error !== null && bots.data === undefined) {
    workspaceContent = (
      <VStack padding={6}>
        <Banner
          status="error"
          title="Workspace could not be loaded"
          description={apiErrorMessage(bots.error, "Check your connection and try again.")}
          endContent={
            <Button label="Retry" variant="secondary" onClick={() => void bots.refetch()} />
          }
        />
      </VStack>
    );
  } else if ((bots.data?.length ?? 0) === 0) {
    workspaceContent = (
      <VStack height="100%" padding={6} vAlign="center">
        <EmptyState
          headingLevel={2}
          title="Create your first bot"
          description="Give a teammate a name, a job, and an available agent to start a conversation."
          icon={<Icon icon="info" size="lg" />}
          actions={
            <Button
              label="New bot"
              variant="primary"
              onClick={() => setCreateOpen(true)}
              data-testid="empty-create-bot"
            />
          }
        />
      </VStack>
    );
  } else if (bot === undefined) {
    workspaceContent = (
      <VStack
        gap={3}
        padding={6}
        role="status"
        aria-label="Opening bot"
        data-testid="bot-selection-loading"
      >
        <Skeleton width="100%" height="var(--spacing-4)" radius={3} />
        <Skeleton width="100%" height="var(--spacing-10)" radius={3} index={1} />
      </VStack>
    );
  } else {
    workspaceContent = (
      <VStack height="100%" gap={0}>
        {conversationNotice}
          <TranscriptAttention
            botId={bot.id}
            {...(thread !== undefined ? { threadId: thread.id } : {})}
            unreadCount={bot.unreadCount}
            {...(bot.unreadThreadId !== undefined ? { unreadThreadId: bot.unreadThreadId } : {})}
            {...(messages.data?.at(-1)?.id !== undefined ? { latestMessageId: messages.data.at(-1)!.id } : {})}
            onRead={async (botId, threadId) => {
              await api.markBotRead(botId, threadId);
              invalidate("bots");
            }}
          >
            <ChatPanel
              bot={bot}
              {...(thread !== undefined ? { thread } : {})}
              messages={messages.data ?? []}
              {...(thread !== undefined && messages.isPending ? { messagesLoading: true } : {})}
              {...(messages.error !== null
                ? { messagesError: apiErrorMessage(messages.error, "Messages could not be loaded.") }
                : {})}
              {...(thread !== undefined ? { onRetryMessages: () => void messages.refetch() } : {})}
              dictation={dictationController}
              autoSendVoice={autoSendVoice}
              onVoiceAutoSend={async (target, text) => {
                const response =
                  target.threadId !== undefined
                    ? await api.sendMessage(target.threadId, { text, clientTag: crypto.randomUUID() })
                    : await api.sendBotMessage(target.botId, { text, clientTag: crypto.randomUUID() });
                invalidate("threads");
                invalidate("bots");
                invalidate("messages", target.threadId);
                if (target.threadId === undefined && bot.id === target.botId && thread === undefined) onMessageSent(response.threadId);
              }}
              onMessageSent={onMessageSent}
              isAgentReady={isAgentReady}
            />
          </TranscriptAttention>
      </VStack>
    );
  }

  return (
    <AppShell
      height="fill"
      contentPadding={0}
      variant="section"
      mobileNav={{ breakpoint: "md", hasToggle: false }}
      {...(workspaceBanner !== undefined ? { banner: workspaceBanner } : {})}
      sideNav={
        <Sidebar
          bots={bots.data ?? []}
          {...(selectedBotId !== undefined ? { selectedBotId } : {})}
          onSelectBot={selectBot}
          onCreateBot={() => setCreateOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onPinBot={async (botId, pinned) => {
            await api.pinBot(botId, { pinned });
            invalidate("bots");
          }}
          onArchiveBot={(botId, body) => api.archiveBot(botId, body)}
          onBotArchived={(botId) => {
            qc.setQueryData(["bots"], (current: typeof bots.data) => current?.filter((candidate) => candidate.id !== botId));
            invalidate("bots");
            if (selectedBotId === botId) void navigate({ search: {}, replace: true });
          }}
          safetyControl={
            <EmergencyComputerControl
              view={computerSafety.data ?? { state: "unavailable" }}
              busy={computerAction.isPending}
              onEmergencyStop={() => computerAction.mutate("stop")}
              onResume={() => computerAction.mutate("resume")}
            />
          }
        />
      }
    >
      <Layout
        height="fill"
        padding={0}
        header={
          <ConversationHeader
            {...(bot !== undefined ? { bot } : {})}
            {...(thread !== undefined ? { thread } : {})}
            onOpenHistory={() => setHistoryOpen(true)}
            onOpenProfile={() => setProfileOpen(true)}
            computerState={computer.data?.state ?? "unavailable"}
            onOpenComputer={() => setComputerOpen(true)}
          />
        }
        content={
          <LayoutContent padding={0} isScrollable={false} label="Conversation workspace">
            {workspaceContent}
          </LayoutContent>
        }
        end={
          bot !== undefined ? (
            <ComputerSheet
              bot={bot}
              view={
                computer.data
                  ?? {
                    state: "unavailable",
                    activity:
                      computer.error !== null
                        ? apiErrorMessage(computer.error, "Computer status could not be loaded.")
                        : "Computer state is loading.",
                  }
              }
              snapshotUrl={api.computerImageUrl()}
              open={computerOpen}
              busy={computerAction.isPending}
              {...(computer.isPending ? { loading: true } : {})}
              {...(computer.error !== null ? { onRetry: () => void computer.refetch() } : {})}
              {...(computerError !== undefined ? { error: computerError } : {})}
              onClose={() => setComputerOpen(false)}
              onTakeControl={() => computerAction.mutate("take")}
              onReturnToBot={() => computerAction.mutate("return")}
            />
          ) : undefined
        }
      />
      <CreateBotDialog
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(botId) => {
          void qc.invalidateQueries({ queryKey: ["bots"] }).then(() => {
            void navigate({ search: { bot: botId, thread: "blank" } });
          });
        }}
      />
      {bot !== undefined ? (
        <>
          <HistoryDialog
            botId={bot.id}
            open={historyOpen}
            onClose={() => setHistoryOpen(false)}
            onSelectThread={(threadId) => void navigate({ search: { bot: bot.id, thread: threadId } })}
            onNewConversation={() => void navigate({ search: { bot: bot.id, thread: "blank" } })}
          />
          <ProfileDialog
            bot={bot}
            open={profileOpen}
            onClose={() => setProfileOpen(false)}
            onUpdated={() => invalidate("bots")}
          />
        </>
      ) : null}
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        archivedBots={allBots.data ?? []}
        {...(allBots.isPending ? { archivedBotsLoading: true } : {})}
        {...(allBots.error !== null
          ? { archivedBotsError: apiErrorMessage(allBots.error, "Archived bots could not be loaded.") }
          : {})}
        {...(allBots.error !== null ? { onRetryArchivedBots: () => void allBots.refetch() } : {})}
        onRestoreBot={(botId) => api.restoreBot(botId)}
        onBotRestored={() => invalidate("bots")}
        onDeleteBot={async (botId, confirmName) => {
          const result = await api.deleteBot(botId, { confirmName });
          if (result.status === "deleted") await qc.cancelQueries({ queryKey: ["bots"] });
          return result;
        }}
        onBotDeleted={(botId) => {
          qc.setQueryData(["bots"], (current: typeof bots.data) => current?.filter((candidate) => candidate.id !== botId));
          qc.setQueryData(["bots", "all"], (current: typeof allBots.data) => current?.filter((candidate) => candidate.id !== botId));
          qc.removeQueries({ queryKey: ["threads", botId], exact: true });
          qc.removeQueries({ queryKey: ["messages"] });
          clearDraftsByBot(botId);
          invalidate("bots");
          if (selectedBotId === botId) void navigate({ search: {}, replace: true });
        }}
      >
        <>
          <VoiceSettingsControl value={autoSendVoice} onChange={setAutoSendVoice} />
          <Button
            label="Enable desktop notifications"
            variant="secondary"
            onClick={() => void requestDesktopNotificationPermission()}
            data-testid="enable-notifications"
          />
        </>
      </SettingsDialog>
    </AppShell>
  );
}
