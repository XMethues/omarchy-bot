import { Button } from "@astryxdesign/core/Button";
import { SideNav, SideNavHeading, SideNavSection, SideNavItem } from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { StatusBadge } from "./StatusBadge.tsx";
import styles from "../lib/styles.ts";
import type { BotDto, ThreadDto } from "@omarchy-bot/protocol";

export function BotSidebar({
  bots,
  threads,
  selectedBotId,
  selectedThreadId,
  onSelectBot,
  onSelectThread,
  onNewChat,
  onRecheck,
}: {
  bots: BotDto[];
  threads: ThreadDto[];
  selectedBotId: string | undefined;
  selectedThreadId: string | undefined;
  onSelectBot: (botId: string) => void;
  onSelectThread: (threadId: string) => void;
  onNewChat: () => void;
  onRecheck: (botId: string) => void;
}) {
  const botThreads = threads
    .filter((t) => t.botId === selectedBotId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <SideNav>
      <SideNavHeading heading="omarchy-bot" subheading="M1 · Pi Bot" />
      <SideNavSection title="Bots">
        <VStack gap={1} padding={2}>
          {bots.map((bot) => (
            <VStack gap={0.5} key={bot.id}>
              <Button
                label={bot.displayName}
                variant={bot.id === selectedBotId ? "primary" : "ghost"}
                onClick={() => onSelectBot(bot.id)}
              />
              <button
                type="button"
                title={bot.reason ?? bot.status}
                onClick={() => onRecheck(bot.id)}
                xstyle={styles.recheck}
              >
                <StatusBadge status={bot.status} />
                <Text type="supporting" size="2xs">
                  {bot.agentVersion !== "unknown" ? `v${bot.agentVersion}` : "not installed — click to recheck"}
                </Text>
              </button>
            </VStack>
          ))}
        </VStack>
      </SideNavSection>
      <SideNavSection title="Threads">
        <VStack gap={1} padding={2}>
          <Button label="New chat" variant="secondary" size="sm" isDisabled={selectedBotId === undefined} onClick={onNewChat} />
          {botThreads.map((t) => (
            <SideNavItem
              key={t.id}
              label={t.title}
              isSelected={t.id === selectedThreadId}
              onClick={() => onSelectThread(t.id)}
            />
          ))}
          {botThreads.length === 0 && (
            <Text type="supporting" size="2xs">
              No threads yet
            </Text>
          )}
        </VStack>
      </SideNavSection>
    </SideNav>
  );
}
