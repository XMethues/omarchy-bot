import type { JSX } from "react";
import { Button } from "@astryxdesign/core/Button";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { LayoutHeader } from "@astryxdesign/core/Layout";
import { StackItem } from "@astryxdesign/core/Stack";
import { VStack } from "@astryxdesign/core/VStack";
import type { BotViewDto, ComputerViewDto, ThreadDto } from "@omarchy-bot/protocol";
import { AvatarView } from "./AvatarView.tsx";

const COMPUTER_LABELS: Record<ComputerViewDto["state"], string> = {
  idle: "Open computer",
  "bot-using": "Open computer, this bot is using it",
  waiting: "Open computer, this bot is waiting",
  "needs-you": "Open computer, this bot needs you",
  "user-control": "Open computer, you have control",
  "emergency-stopped": "Open computer, control is stopped",
  unavailable: "Open computer, unavailable",
};

export interface ConversationHeaderProps {
  bot?: BotViewDto;
  thread?: ThreadDto;
  computerState: ComputerViewDto["state"];
  onOpenHistory: () => void;
  onOpenProfile: () => void;
  onOpenComputer: () => void;
}

function MobileSidebarTrigger(): JSX.Element | null {
  const {
    isMobile,
    isMobileNavEnabled,
    isMobileNavOpen,
    mobileNavId,
    openMobileNav,
  } = useAppShellMobile();

  if (!isMobile || !isMobileNavEnabled) return null;

  return (
    <IconButton
      label="Open bot navigation"
      tooltip="Open bot navigation"
      icon={<Icon icon="menu" size="md" />}
      variant="ghost"
      onClick={openMobileNav}
      aria-expanded={isMobileNavOpen}
      {...(mobileNavId !== undefined ? { "aria-controls": mobileNavId } : {})}
      data-testid="mobile-sidebar-trigger"
    />
  );
}

/**
 * Conversation-local header: the sole page heading, thread history, Computer,
 * and profile actions. AppShell provides the global navigation frame.
 */
export function ConversationHeader({
  bot,
  thread,
  computerState,
  onOpenHistory,
  onOpenProfile,
  onOpenComputer,
}: ConversationHeaderProps): JSX.Element {
  return (
    <LayoutHeader hasDivider label="Conversation">
      <HStack
        gap={3}
        paddingInline={6}
        paddingBlock={3}
        vAlign="center"
        data-testid="conversation-header"
      >
        <MobileSidebarTrigger />
        {bot !== undefined ? (
          <AvatarView
            avatar={bot.avatar}
            name={bot.name}
            size="sm"
            activity={bot.status === "working" ? "working" : "selected"}
          />
        ) : null}
        <StackItem size="fill">
          <VStack gap={0.5}>
            <Heading level={1} maxLines={1}>
              {bot?.name ?? "omarchy-bot"}
            </Heading>
            <HStack>
              <Button
                label={thread?.title ?? "New conversation"}
                variant="ghost"
                size="sm"
                isDisabled={bot === undefined}
                onClick={onOpenHistory}
                data-testid="thread-history-trigger"
              />
            </HStack>
          </VStack>
        </StackItem>
        <IconButton
          label={COMPUTER_LABELS[computerState]}
          tooltip={COMPUTER_LABELS[computerState]}
          isDisabled={bot === undefined}
          icon={<Icon icon="viewColumns" size="md" />}
          variant={computerState === "idle" || computerState === "unavailable" ? "ghost" : "secondary"}
          onClick={onOpenComputer}
          data-state={computerState}
          data-testid="header-computer"
        />
        <IconButton
          label="Edit bot profile"
          tooltip="Edit bot profile"
          icon={<Icon icon="moreHorizontal" size="md" />}
          variant="ghost"
          onClick={onOpenProfile}
          isDisabled={bot === undefined}
          data-testid="profile-open"
        />
      </HStack>
    </LayoutHeader>
  );
}
