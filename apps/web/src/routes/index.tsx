import type { JSX } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api } from "../lib/api.ts";
import { startEventPump, type QueryTag } from "../lib/events.ts";
import { Sidebar } from "../components/Sidebar.tsx";
import { ConversationHeader } from "../components/ConversationHeader.tsx";
import { ChatPanel } from "../components/ChatPanel.tsx";
import { CreateBotDialog } from "../components/CreateBotDialog.tsx";
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
  approvals: ["approvals"],
  turns: ["turns"],
  computer: ["computer"],
};

function HomeScreen(): JSX.Element {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { bot: selectedBotId, thread: selectedThreadId } = Route.useSearch();
  const [createOpen, setCreateOpen] = useState(false);

  const invalidate = useCallback(
    (tag: QueryTag, threadId?: string) => {
      void qc.invalidateQueries({ queryKey: threadId ? [tag, threadId] : QUERY_KEYS[tag] });
    },
    [qc],
  );

  useEffect(() => {
    startEventPump(invalidate, () => void qc.invalidateQueries());
  }, [qc, invalidate]);

  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api.listAgents(), refetchInterval: 30_000 });
  const bots = useQuery({ queryKey: ["bots"], queryFn: () => api.listBots(), refetchInterval: 30_000 });
  const approvals = useQuery({ queryKey: ["approvals"], queryFn: () => api.listApprovals(), refetchInterval: 15_000 });

  const bot = useMemo(() => bots.data?.find((b) => b.id === selectedBotId), [bots.data, selectedBotId]);

  const threads = useQuery({
    queryKey: ["threads", bot?.id],
    queryFn: () => api.listBotThreads(bot!.id),
    enabled: bot !== undefined,
    refetchInterval: 60_000,
  });

  // Startup with no URL params: select the most recently active bot. Leaving
  // the thread param absent lets the thread query below resolve its latest
  // conversation; bots with no history resolve to an explicit blank draft.
  useEffect(() => {
    if (selectedBotId !== undefined) return;
    const list = bots.data ?? [];
    if (list.length === 0) return;
    const ordered = [...list].sort(
      (a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""),
    );
    const first = ordered[0];
    if (first === undefined) return;
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
      // Drop the thread param: the resolution effect below opens the newly
      // selected bot's most recent thread or a genuinely blank composer.
      void navigate({ search: { bot: botId } });
    },
    [navigate],
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
          onOpenSettings={() => {
            /* Settings lands with T03; the button is named and inert until then. */
          }}
        />
      }
    >
      <div xstyle={styles.fillColumn}>
        <ConversationHeader bot={bot} thread={thread} />
        <ChatPanel
          bot={bot}
          thread={thread}
          messages={messages.data ?? []}
          pendingApprovalIds={pendingApprovalIds}
          onRespondApproval={(id, decision) => respondApproval.mutate({ id, decision })}
          onMessageSent={onMessageSent}
          isAgentReady={isAgentReady}
        />
      </div>
      <CreateBotDialog
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(botId) => {
          invalidate("bots");
          void navigate({ search: { bot: botId, thread: "blank" } });
        }}
      />
    </AppShell>
  );
}
