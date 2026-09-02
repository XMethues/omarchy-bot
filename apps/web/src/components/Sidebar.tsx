import type { JSX } from "react";
import { useState } from "react";
import { SideNav } from "@astryxdesign/core/SideNav";
import { SideNavHeading } from "@astryxdesign/core/SideNav";
import { SideNavSection } from "@astryxdesign/core/SideNav";
import { Item } from "@astryxdesign/core/Item";
import { Button } from "@astryxdesign/core/Button";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Badge } from "@astryxdesign/core/Badge";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { Archive, MoreHorizontal, Plus, Settings } from "lucide-react";
import type { BotDto, BotViewDto } from "@omarchy-bot/protocol";
import { AvatarView } from "./AvatarView.tsx";
import { clearDraftsByBot } from "../lib/drafts.ts";

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

export interface SidebarProps {
  bots: BotViewDto[];
  selectedBotId?: string;
  onSelectBot: (botId: string) => void;
  onCreateBot: () => void;
  onOpenSettings: () => void;
  onArchiveBot: (botId: string, body: { confirmStop?: boolean }) => Promise<BotDto>;
  onBotArchived: (botId: string) => void;
}

/**
 * The global navigation surface (workspace-redesign §2–§3): one row per
 * user-created Bot — never one row per Agent. Pinned bots sort first, then
 * recent activity. Settings sits fixed at the bottom.
 */
export function Sidebar({
  bots,
  selectedBotId,
  onSelectBot,
  onCreateBot,
  onOpenSettings,
  onArchiveBot,
  onBotArchived,
}: SidebarProps): JSX.Element {
  const [pendingBot, setPendingBot] = useState<BotViewDto | undefined>(undefined);
  const [archiveError, setArchiveError] = useState<string | undefined>(undefined);
  const [archiving, setArchiving] = useState(false);
  const ordered = [...bots.filter((bot) => !bot.archived)].sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || (b.lastActivityAt ?? "").localeCompare(a.lastActivityAt ?? ""),
  );

  const finishArchive = (botId: string): void => {
    clearDraftsByBot(botId);
    setPendingBot(undefined);
    setArchiveError(undefined);
    onBotArchived(botId);
  };

  const archive = async (bot: BotViewDto, confirmStop: boolean): Promise<void> => {
    setArchiving(true);
    setArchiveError(undefined);
    try {
      await onArchiveBot(bot.id, confirmStop ? { confirmStop: true } : {});
      finishArchive(bot.id);
    } catch (error) {
      const confirmationRequired =
        error !== null
        && typeof error === "object"
        && "status" in error
        && error.status === 409
        && "body" in error
        && error.body !== null
        && typeof error.body === "object"
        && "confirmRequired" in error.body
        && error.body.confirmRequired === true;
      setPendingBot(bot);
      setArchiveError(confirmationRequired ? undefined : error instanceof Error ? error.message : "The bot could not be archived.");
    } finally {
      setArchiving(false);
    }
  };

  const requestArchive = (bot: BotViewDto): void => {
    if (bot.status === "working") {
      setPendingBot(bot);
      setArchiveError(undefined);
      return;
    }
    void archive(bot, false);
  };
  return (
    <>
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
                  <HStack gap={1} align="center">
                    <VStack gap={0.5}>
                      {bot.previewAt !== undefined ? <Timestamp value={bot.previewAt} format="relative_short" /> : null}
                      {bot.status !== "idle" ? <Badge variant={STATUS_VARIANT[bot.status]} label={STATUS_LABEL[bot.status]} /> : null}
                      {bot.unreadCount > 0 ? <Badge variant="blue" label={bot.unreadCount} /> : null}
                    </VStack>
                    <DropdownMenu
                      button={{
                        label: `Actions for ${bot.name}`,
                        variant: "ghost",
                        size: "sm",
                        icon: <MoreHorizontal size={16} />,
                        isIconOnly: true,
                      }}
                      data-testid={`sidebar-bot-actions-${bot.id}`}
                      items={[
                        {
                          id: "archive",
                          label: "Archive",
                          description: "Move this bot to Settings",
                          icon: <Archive size={16} />,
                          onClick: () => requestArchive(bot),
                        },
                      ]}
                      placement="below"
                      alignment="end"
                    />
                  </HStack>
                }
                data-testid={`sidebar-bot-${bot.id}`}
              />
            ))
          )}
        </SideNavSection>
      </SideNav>
      <AlertDialog
        isOpen={pendingBot !== undefined}
        onOpenChange={(open) => {
          if (!open && !archiving) {
            setPendingBot(undefined);
            setArchiveError(undefined);
          }
        }}
        title={archiveError === undefined ? "Stop work and archive?" : "Couldn’t archive bot"}
        description={
          archiveError
            ?? `${pendingBot?.name ?? "This bot"} is working. Its current work will be stopped before the bot is moved to Settings. Conversations are kept.`
        }
        cancelLabel="Keep working"
        actionLabel={archiveError === undefined ? "Stop and archive" : "Try again"}
        actionVariant="destructive"
        isActionLoading={archiving}
        onAction={() => {
          if (pendingBot !== undefined) void archive(pendingBot, true);
        }}
        data-testid="archive-working-confirmation"
      />
    </>
  );
}
