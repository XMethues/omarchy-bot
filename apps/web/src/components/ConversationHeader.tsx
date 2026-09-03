import type { JSX, RefObject } from "react";
import { Monitor } from "lucide-react";
import { Button } from "@astryxdesign/core/Button";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import { Text } from "@astryxdesign/core/Text";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { LayoutHeader } from "@astryxdesign/core/Layout";
import { StackItem } from "@astryxdesign/core/Stack";
import type { BotViewDto, ComputerViewDto, ThreadDto } from "@omarchy-bot/protocol";
import { AvatarView } from "./AvatarView.tsx";

const COMPUTER_TOOLTIPS: Record<ComputerViewDto["state"], string> = {
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
  computerOpen: boolean;
  profileOpen: boolean;
  onOpenHistory: () => void;
  onToggleProfile: () => void;
  onToggleComputer: () => void;
  mobileNavigationTriggerRef: RefObject<HTMLButtonElement | null>;
  computerTriggerRef: RefObject<HTMLButtonElement | null>;
  profileTriggerRef: RefObject<HTMLButtonElement | null>;
}

function MobileSidebarTrigger({ triggerRef }: { triggerRef: RefObject<HTMLButtonElement | null> }): JSX.Element | null {
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
      ref={triggerRef}
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
  computerOpen,
  profileOpen,
  onOpenHistory,
  onToggleProfile,
  onToggleComputer,
  mobileNavigationTriggerRef,
  computerTriggerRef,
  profileTriggerRef,
}: ConversationHeaderProps): JSX.Element {
  return (
    <LayoutHeader hasDivider label="Conversation" padding={2}>
      <HStack
        gap={3}
        vAlign="center"
        data-testid="conversation-header"
      >
        <MobileSidebarTrigger triggerRef={mobileNavigationTriggerRef} />
        <StackItem size="fill">
          <HStack gap={1} vAlign="center">
            {bot !== undefined ? (
              <Button
                ref={profileTriggerRef}
                label={`${profileOpen ? "Close" : "Open"} profile for ${bot.name}`}
                variant="ghost"
                size="sm"
                onClick={onToggleProfile}
                data-testid="profile-open"
                style={{
                  minWidth: 0,
                  maxWidth: "min(220px, 45vw)",
                  height: "auto",
                  paddingBlock: 4,
                  paddingInline: 6,
                  overflow: "hidden",
                }}
                aria-expanded={profileOpen}
              >
                <HStack gap={1} vAlign="center">
                  <AvatarView
                    avatar={bot.avatar}
                    name={bot.name}
                    size="sm"
                    activity={bot.status === "working" ? "working" : "selected"}
                    decorative
                  />
                  <Text as="h1" type="body" weight="medium" maxLines={1}>
                    {bot.name}
                  </Text>
                </HStack>
              </Button>
            ) : (
              <Text as="h1" type="body" weight="medium" maxLines={1}>
                omarchy-bot
              </Text>
            )}
            <StackItem size="fill">
              <Button
                label="Open conversation history"
                variant="ghost"
                size="sm"
                isDisabled={bot === undefined}
                onClick={onOpenHistory}
                data-testid="thread-history-trigger"
                style={{ minWidth: 0, maxWidth: "100%", overflow: "hidden" }}
              >
                <Text type="supporting" color="secondary" maxLines={1}>
                  {thread?.title ?? "New conversation"}
                </Text>
              </Button>
            </StackItem>
          </HStack>
        </StackItem>
        <IconButton
          ref={computerTriggerRef}
          label={computerOpen ? "Close computer" : "Open computer"}
          tooltip={computerOpen ? "Close computer" : COMPUTER_TOOLTIPS[computerState]}
          isDisabled={bot === undefined}
          icon={<Icon icon={Monitor} size="md" />}
          variant={
            computerOpen || (computerState !== "idle" && computerState !== "unavailable") ? "secondary" : "ghost"
          }
          onClick={onToggleComputer}
          aria-expanded={computerOpen}
          data-state={computerState}
          data-testid="header-computer"
        />
      </HStack>
    </LayoutHeader>
  );
}
