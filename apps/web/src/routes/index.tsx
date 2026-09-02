import type { JSX } from "react";
import { Button } from "@astryxdesign/core/Button";
import { AppShell } from "@astryxdesign/core/AppShell";
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
import styles from "../lib/styles.ts";

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
  approvals: ["approvals"],
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

  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api.listAgents(), refetchInterval: 30_000 });
  const bots = useQuery({ queryKey: ["bots"], queryFn: () => api.listBots(), refetchInterval: 30_000 });
  botNamesRef.current = Object.fromEntries((bots.data ?? []).map((candidate) => [candidate.id, candidate.name]));
  const approvals = useQuery({ queryKey: ["approvals"], queryFn: () => api.listApprovals(), refetchInterval: 15_000 });
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

  const respondApproval = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: boolean }) => api.respondApproval(id, { decision }),
    onSuccess: () => {
      invalidate("approvals");
      invalidate("turns");
      invalidate("messages", thread?.id);
    },
  });

  const pendingApprovalIds = useMemo(
    () => new Set((approvals.data ?? []).filter((a) => a.status === "pending").map((a) => a.id)),
    [approvals.data],
  );

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

  const isAgentReady = useMemo(() => {
    if (bot === undefined) return false;
    return (agents.data ?? []).find((a) => a.id === bot.agentId)?.status === "ready";
  }, [agents.data, bot]);

  return (
    <AppShell
      height="fill"
      contentPadding={0}
      variant="section"
      sideNav={
        <Sidebar
          bots={bots.data ?? []}
          selectedBotId={selectedBotId}
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
        />
      }
    >
      <div xstyle={styles.fillColumn}>
        <ConversationHeader
          bot={bot}
          thread={thread}
          onOpenHistory={() => setHistoryOpen(true)}
          onOpenProfile={() => setProfileOpen(true)}
          computerState={computer.data?.state ?? "unavailable"}
          onOpenComputer={() => setComputerOpen(true)}
        />
        <TranscriptAttention
          {...(bot !== undefined ? { botId: bot.id } : {})}
          {...(thread !== undefined ? { threadId: thread.id } : {})}
          unreadCount={bot?.unreadCount ?? 0}
          {...(bot?.unreadThreadId !== undefined ? { unreadThreadId: bot.unreadThreadId } : {})}
          {...(messages.data?.at(-1)?.id !== undefined ? { latestMessageId: messages.data.at(-1)!.id } : {})}
          onRead={async (botId, threadId) => {
            await api.markBotRead(botId, threadId);
            invalidate("bots");
          }}
        >
        <ChatPanel
          bot={bot}
          thread={thread}
          messages={messages.data ?? []}
          pendingApprovalIds={pendingApprovalIds}
          onRespondApproval={(id, decision) => respondApproval.mutate({ id, decision })}
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
            if (target.threadId === undefined && bot?.id === target.botId && thread === undefined) onMessageSent(response.threadId);
          }}
          onMessageSent={onMessageSent}
          isAgentReady={isAgentReady}
        />
        </TranscriptAttention>
      </div>
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
      {bot !== undefined ? (
        <ComputerSheet
          bot={bot}
          view={computer.data ?? { state: "unavailable", activity: "Computer state is loading." }}
          snapshotUrl={api.computerImageUrl()}
          open={computerOpen}
          busy={computerAction.isPending}
          {...(computerError !== undefined ? { error: computerError } : {})}
          onClose={() => setComputerOpen(false)}
          onTakeControl={() => computerAction.mutate("take")}
          onReturnToBot={() => computerAction.mutate("return")}
        />
      ) : null}
      <EmergencyComputerControl
        view={computer.data ?? { state: "unavailable" }}
        busy={computerAction.isPending}
        onEmergencyStop={() => computerAction.mutate("stop")}
        onResume={() => computerAction.mutate("resume")}
      />
    </AppShell>
  );
}
