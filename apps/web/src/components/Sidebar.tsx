import type { JSX, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import {
  SideNav,
  SideNavItem,
  SideNavSection,
} from "@astryxdesign/core/SideNav";
import { Plus } from "lucide-react";
import { Item } from "@astryxdesign/core/Item";
import { Badge } from "@astryxdesign/core/Badge";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { VStack } from "@astryxdesign/core/VStack";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { ContextMenu } from "@astryxdesign/core/ContextMenu";
import type { BotViewDto } from "@omarchy-bot/protocol";
import { AvatarStatusDot } from "@astryxdesign/core/Avatar";
import { AvatarView } from "./AvatarView.tsx";

export interface SidebarProps {
  bots: BotViewDto[];
  selectedBotId?: string;
  onSelectBot: (botId: string) => void;
  onEditProfile: (botId: string) => void;
  onDeleteBot: (bot: BotViewDto) => void;
  onCreateBot: () => void;
  onOpenSettings: () => void;
  safetyControl?: ReactNode;
}

const activityTime = (bot: BotViewDto): string => bot.lastActivityAt ?? bot.createdAt;

export function orderSidebarBots(bots: BotViewDto[]): BotViewDto[] {
  return [...bots].sort(
    (a, b) => activityTime(b).localeCompare(activityTime(a)) || a.id.localeCompare(b.id),
  );
}

/** Open the teammate with newest activity. */
export function mostRecentlyActiveBot(bots: BotViewDto[]): BotViewDto | undefined {
  return [...bots].sort(
    (a, b) => activityTime(b).localeCompare(activityTime(a)) || a.id.localeCompare(b.id),
  )[0];
}

/**
 * The global navigation surface (workspace-redesign §2–§3): one row per
 * user-created Bot — never one row per Agent. Bots sort by recent activity;
 * Settings sits fixed at the bottom.
 */
export function Sidebar({
  bots,
  selectedBotId,
  onSelectBot,
  onEditProfile,
  onDeleteBot,
  onCreateBot,
  onOpenSettings,
  safetyControl,
}: SidebarProps): JSX.Element {
  const { closeMobileNav, isMobile } = useAppShellMobile();
  const sidebarRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const suppressKeyboardContextMenu = (event: MouseEvent): void => {
      if (event.button === 2 || !sidebarRef.current?.contains(event.target as Node)) return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("contextmenu", suppressKeyboardContextMenu, true);
    return () => document.removeEventListener("contextmenu", suppressKeyboardContextMenu, true);
  }, []);
  const ordered = orderSidebarBots(bots);
  const renderBot = (bot: BotViewDto): JSX.Element => (
    <ContextMenu
      key={bot.id}
      label={`${bot.name} actions`}
      items={[
        { label: "Edit Profile", onClick: () => onEditProfile(bot.id) },
        {
          label: "Delete",
          variant: "destructive",
          onClick: () => onDeleteBot(bot),
        },
      ]}
    >
      <Item
        startContent={
          <HStack height={48} vAlign="center">
            <AvatarView
              avatar={bot.avatar}
              name={bot.name}
              size={42}
              presentation="ambient"
              decorative
            />
          </HStack>
        }
        label={<strong>{bot.name}</strong>}
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
        endContent={
          bot.status === "active" || bot.unreadCount > 0 ? (
            <HStack gap={1} vAlign="center">
              {bot.status === "active" ? (
                <span data-testid="sidebar-activity-point">
                  <AvatarStatusDot variant="success" label={`${bot.name} is active`} />
                </span>
              ) : null}
              {bot.unreadCount > 0 ? (
                <Badge
                  variant="blue"
                  label={bot.unreadCount}
                  aria-label={`${bot.unreadCount} unread ${bot.unreadCount === 1 ? "message" : "messages"}`}
                  data-testid={`sidebar-unread-${bot.id}`}
                />
              ) : null}
            </HStack>
          ) : undefined
        }
        data-testid={`sidebar-bot-${bot.id}`}
      />
    </ContextMenu>
  );

  return (
    <VStack ref={sidebarRef} height="100%" data-testid="sidebar">
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
          {ordered.length === 0 ? (
            <VStack padding={4}>
              <Text color="secondary">No bots yet. Create one to start chatting.</Text>
            </VStack>
          ) : (
            ordered.map(renderBot)
          )}
        </SideNavSection>
      </SideNav>
    </VStack>
  );
}
