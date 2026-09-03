import type { JSX, ReactNode } from "react";
import { useState } from "react";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import {
  SideNav,
  SideNavItem,
  SideNavSection,
} from "@astryxdesign/core/SideNav";
import { Plus } from "lucide-react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { DropdownMenu } from "@astryxdesign/core/DropdownMenu";
import { Item } from "@astryxdesign/core/Item";
import { Badge } from "@astryxdesign/core/Badge";
import { Icon } from "@astryxdesign/core/Icon";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { IconButton } from "@astryxdesign/core/IconButton";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
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

const STATUS_VARIANT: Record<BotViewDto["status"], "accent" | "warning" | "error" | "neutral"> = {
  idle: "neutral",
  working: "accent",
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
  onPinBot: (botId: string, pinned: boolean) => Promise<void>;
  onArchiveBot: (botId: string, body: { confirmStop?: boolean }) => Promise<BotDto>;
  onBotArchived: (botId: string) => void;
  safetyControl?: ReactNode;
}

const activityTime = (bot: BotViewDto): string => bot.lastActivityAt ?? bot.createdAt;

export function orderSidebarBots(bots: BotViewDto[]): BotViewDto[] {
  return [...bots.filter((bot) => !bot.archived)].sort(
    (a, b) =>
      Number(b.pinned) - Number(a.pinned)
      || activityTime(b).localeCompare(activityTime(a))
      || a.id.localeCompare(b.id),
  );
}

/** Startup deliberately ignores pins: open the teammate with newest activity. */
export function mostRecentlyActiveBot(bots: BotViewDto[]): BotViewDto | undefined {
  return [...bots.filter((bot) => !bot.archived)].sort(
    (a, b) => activityTime(b).localeCompare(activityTime(a)) || a.id.localeCompare(b.id),
  )[0];
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
  onPinBot,
  onArchiveBot,
  onBotArchived,
  safetyControl,
}: SidebarProps): JSX.Element {
  const [pendingBot, setPendingBot] = useState<BotViewDto | undefined>(undefined);
  const [archiveError, setArchiveError] = useState<string | undefined>(undefined);
  const [pinError, setPinError] = useState<string | undefined>(undefined);
  const [archiving, setArchiving] = useState(false);
  const { closeMobileNav, isMobile } = useAppShellMobile();
  const ordered = orderSidebarBots(bots);

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

  const togglePin = async (bot: BotViewDto): Promise<void> => {
    setPinError(undefined);
    try {
      await onPinBot(bot.id, !bot.pinned);
    } catch (error) {
      setPinError(error instanceof Error ? error.message : `Could not ${bot.pinned ? "unpin" : "pin"} ${bot.name}.`);
    }
  };
  return (
    <>
      <VStack height="100%" data-testid="sidebar">
        <SideNav
          aria-label="Bot navigation"
          {...(isMobile ? { "data-testid": "mobile-sidebar" } : {})}
          footer={
            <VStack gap={1}>
              {safetyControl}
              <SideNavItem
                label="Settings"
                aria-label="Settings"
                icon={<Icon icon="wrench" size="sm" />}
                onClick={() => {
                  if (isMobile) closeMobileNav();
                  onOpenSettings();
                }}
                data-testid="sidebar-settings"
              />
            </VStack>
          }
          topContent={
            <HStack justify="end">
              <IconButton
                label="New bot"
                tooltip="New bot"
                variant="primary"
                icon={<Icon icon={Plus} size="md" />}
                onClick={() => {
                  if (isMobile) closeMobileNav();
                  onCreateBot();
                }}
                data-testid="sidebar-create-bot"
              />
            </HStack>
          }
        >
          <SideNavSection title="Bots" isHeaderHidden>
            {pinError !== undefined ? (
              <Text role="alert">{pinError}</Text>
            ) : null}
            {ordered.length === 0 ? (
              <VStack padding={4}>
                <Text color="secondary">No bots yet. Create one to start chatting.</Text>
              </VStack>
            ) : (
              ordered.map((bot) => (
                <Item
                  key={bot.id}
                  startContent={
                    <AvatarView
                      avatar={bot.avatar}
                      name={bot.name}
                      size="lg"
                      activity={bot.status === "working" ? "working" : bot.id === selectedBotId ? "selected" : "idle"}
                      decorative
                    />
                  }
                  label={bot.name}
                  labelLines={1}
                  description={
                    <Text aria-hidden="true" type="supporting" color="secondary" maxLines={1}>
                      {bot.previewText ?? "No output yet"}
                    </Text>
                  }
                  descriptionLines={1}
                  density="compact"
                  isSelected={bot.id === selectedBotId}
                  onClick={() => {
                    onSelectBot(bot.id);
                    if (isMobile) closeMobileNav();
                  }}
                  aria-label={bot.name}
                  endContent={
                    <HStack gap={1} vAlign="center">
                      {bot.status !== "idle" ? (
                        <StatusDot
                          variant={STATUS_VARIANT[bot.status]}
                          label={STATUS_LABEL[bot.status]}
                          tooltip={STATUS_LABEL[bot.status]}
                        />
                      ) : null}
                      {bot.unreadCount > 0 ? (
                        <Badge
                          variant="blue"
                          label={bot.unreadCount}
                          aria-label={`${bot.unreadCount} unread ${bot.unreadCount === 1 ? "message" : "messages"}`}
                          data-testid={`sidebar-unread-${bot.id}`}
                        />
                      ) : null}
                      <DropdownMenu
                        button={{
                          label: `Actions for ${bot.name}`,
                          variant: "ghost",
                          icon: <Icon icon="moreHorizontal" size="sm" />,
                          isIconOnly: true,
                        }}
                        data-testid={`sidebar-bot-actions-${bot.id}`}
                        items={[
                          {
                            id: "pin",
                            label: bot.pinned ? "Unpin" : "Pin",
                            description: bot.pinned ? "Return to recent activity order" : "Keep above recent bots",
                            onClick: () => void togglePin(bot),
                          },
                          {
                            id: "archive",
                            label: "Archive",
                            description: "Move this bot to Settings",
                            onClick: () => requestArchive(bot),
                          },
                        ]}
                        placement="below"
                        alignment="end"
                        hasChevron={false}
                      />
                    </HStack>
                  }
                  data-testid={`sidebar-bot-${bot.id}`}
                />
              ))
            )}
          </SideNavSection>
        </SideNav>
      </VStack>
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
