import type { JSX } from "react";
import { SideNav } from "@astryxdesign/core/SideNav";
import { SideNavHeading } from "@astryxdesign/core/SideNav";
import { SideNavSection } from "@astryxdesign/core/SideNav";
import { Item } from "@astryxdesign/core/Item";
import { Button } from "@astryxdesign/core/Button";
import { Badge } from "@astryxdesign/core/Badge";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { VStack } from "@astryxdesign/core/VStack";
import { Text } from "@astryxdesign/core/Text";
import { Plus, Settings } from "lucide-react";
import type { BotViewDto } from "@omarchy-bot/protocol";
import { AvatarView } from "./AvatarView.tsx";

const STATUS_LABEL: Record<BotViewDto["status"], string> = {
  idle: "Idle",
  working: "Working…",
  waiting: "Waiting",
  needs_you: "Needs you",
  error: "Error",
  unavailable: "Unavailable",
};

const STATUS_VARIANT: Record<BotViewDto["status"], "neutral" | "info" | "warning" | "error" | "success"> = {
  idle: "neutral",
  working: "info",
  waiting: "warning",
  needs_you: "warning",
  error: "error",
  unavailable: "neutral",
};

interface SidebarProps {
  bots: BotViewDto[];
  selectedBotId?: string;
  onSelectBot: (botId: string) => void;
  onCreateBot: () => void;
  onOpenSettings: () => void;
}

/**
 * The global navigation surface (workspace-redesign §2–§3): one row per
 * user-created Bot — never one row per Agent. Pinned bots sort first, then
 * recent activity. Settings sits fixed at the bottom.
 */
export function Sidebar({ bots, selectedBotId, onSelectBot, onCreateBot, onOpenSettings }: SidebarProps): JSX.Element {
  const ordered = [...bots].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""),
  );
  return (
    <SideNav
      data-testid="sidebar"
      header={<SideNavHeading heading="omarchy-bot" subheading="AI teammate workspace" />}
      footerIcons={
        <Button label="Settings" variant="ghost" size="sm" icon={<Settings size={16} />} onClick={onOpenSettings} data-testid="sidebar-settings" />
      }
      topContent={
        <Button label="New bot" variant="primary" size="md" icon={<Plus size={16} />} onClick={onCreateBot} data-testid="sidebar-create-bot" />
      }
    >
      <SideNavSection title="Bots">
        {ordered.length === 0 ? (
          <VStack padding={4}>
            <Text color="secondary">No bots yet. Create one to start chatting.</Text>
          </VStack>
        ) : (
          ordered.map((bot) => (
            <Item
              key={bot.id}
              onClick={() => onSelectBot(bot.id)}
              isSelected={bot.id === selectedBotId}
              startContent={
                <AvatarView
                  avatar={bot.avatar}
                  name={bot.name}
                  size="sm"
                  activity={bot.status === "working" ? "working" : bot.id === selectedBotId ? "selected" : "idle"}
                />
              }
              label={bot.name}
              description={bot.previewText ?? "No messages yet"}
              descriptionLines={1}
              labelLines={1}
              endContent={
                <VStack gap={0.5}>
                  {bot.previewAt !== undefined ? <Timestamp value={bot.previewAt} format="relative_short" /> : null}
                  {bot.status !== "idle" ? <Badge variant={STATUS_VARIANT[bot.status]} label={STATUS_LABEL[bot.status]} /> : null}
                  {bot.unreadCount > 0 ? <Badge variant="blue" label={bot.unreadCount} /> : null}
                </VStack>
              }
              data-testid={`sidebar-bot-${bot.id}`}
            />
          ))
        )}
      </SideNavSection>
    </SideNav>
  );
}
