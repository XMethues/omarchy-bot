import type { JSX, RefObject } from "react";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Item } from "@astryxdesign/core/Item";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { AgentDto, BotViewDto, DictationDto } from "@omarchy-bot/protocol";
import { agentAvailabilityDescription } from "../lib/agentPresentation.ts";
import { AvatarView } from "./AvatarView.tsx";
import { VoiceSettingsControl } from "./VoiceSettingsControl.tsx";
import { BottomSheetWithReturnFocus } from "./BottomSheetWithReturnFocus.tsx";

export interface SettingsDialogProps {
  open: boolean;
  mobileReturnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  bots: BotViewDto[];
  deletingBotId?: string;
  onRequestDeleteBot: (bot: BotViewDto) => void;
  botsLoading?: boolean;
  botsError?: string;
  onRetryBots?: () => void;
  agents: AgentDto[];
  agentsLoading?: boolean;
  agentsError?: string;
  dictation: DictationDto;
  autoSendVoice: boolean;
  onAutoSendVoiceChange: (enabled: boolean) => void;
  notificationPermission: NotificationPermission | "unsupported";
  onRequestNotifications: () => void;
}

interface SettingsContentProps extends Pick<
  SettingsDialogProps,
  | "bots"
  | "botsLoading"
  | "botsError"
  | "onRetryBots"
  | "agents"
  | "agentsLoading"
  | "agentsError"
  | "dictation"
  | "autoSendVoice"
  | "onAutoSendVoiceChange"
  | "notificationPermission"
  | "onRequestNotifications"
> {
  compactHeading: boolean;
  deletingBotId?: string;
  onRequestDelete: (bot: BotViewDto) => void;
}

function SettingsContent({
  bots,
  botsLoading = false,
  botsError,
  onRetryBots,
  agents,
  agentsLoading = false,
  agentsError,
  dictation,
  autoSendVoice,
  onAutoSendVoiceChange,
  notificationPermission,
  onRequestNotifications,
  compactHeading,
  deletingBotId,
  onRequestDelete,
}: SettingsContentProps): JSX.Element {
  const unavailableAgents = agents.filter((agent) => agent.status !== "ready");
  const operationPending = deletingBotId !== undefined;
  const notificationsDescription =
    notificationPermission === "unsupported"
      ? "Desktop notifications are not available in this browser."
      : notificationPermission === "denied"
        ? "Notifications are blocked. Allow them in this site’s browser settings."
        : notificationPermission === "granted"
          ? "Enabled for background Bot completions and requests for your attention."
          : "Enable alerts for background Bot completions and requests for your attention.";
  return (
    <VStack
      gap={4}
      padding={4}
      aria-busy={botsLoading || agentsLoading || operationPending || undefined}
      data-testid="settings-dialog"
    >
      {compactHeading ? <Heading level={2}>Settings</Heading> : null}
      <VStack gap={2}>
        <VStack gap={0.5}>
          <Heading level={3}>Appearance</Heading>
          <Text color="secondary">Theme follows Omarchy and your system preference.</Text>
        </VStack>
        <Item
          label="Omarchy / system"
          description="Follows your current Omarchy and system appearance."
          align="start"
        />
      </VStack>

      <VStack gap={2}>
        <VStack gap={0.5}>
          <Heading level={3}>Local integrations</Heading>
          <Text color="secondary">Setup guidance appears here when a local integration cannot run.</Text>
        </VStack>
        {agentsLoading ? (
          <EmptyState
            icon={<Icon icon="clock" size="lg" />}
            title="Checking Agent integrations"
            description="Finding installed execution backends."
            isCompact
          />
        ) : agentsError !== undefined ? (
          <Banner status="error" title="Agent integrations couldn’t be checked" description={agentsError} />
        ) : unavailableAgents.length === 0 && dictation.state !== "unavailable" ? (
          <Text color="secondary">Detected Agent and voice integrations are ready.</Text>
        ) : (
          unavailableAgents.map((agent) => (
            <Item
              key={agent.id}
              label={agent.displayName}
              description={agent.guidance ?? agentAvailabilityDescription(agent)}
              align="start"
            />
          ))
        )}
        {dictation.state === "unavailable" ? (
          <Banner
            status="warning"
            title="Voice dictation unavailable"
            description={
              dictation.error
              ?? "Voxtype is unavailable. Install or start Voxtype, then reopen Settings to check again."
            }
          />
        ) : null}
      </VStack>

      <VStack gap={2}>
        <VStack gap={0.5}>
          <Heading level={3}>Voice and notifications</Heading>
          <Text color="secondary">Control browser-local input and attention preferences.</Text>
        </VStack>
        <VoiceSettingsControl value={autoSendVoice} onChange={onAutoSendVoiceChange} />
        <Item label="Desktop notifications" description={notificationsDescription} align="start" />
        {notificationPermission === "default" ? (
          <Button
            label="Enable desktop notifications"
            variant="secondary"
            onClick={onRequestNotifications}
            data-testid="enable-notifications"
          />
        ) : null}
      </VStack>
      <VStack gap={3}>
        <VStack gap={0.5}>
          <Heading level={3}>Bots</Heading>
          <Text color="secondary">Permanently delete a Bot and its Omarchy Bot-owned data.</Text>
        </VStack>
        {botsLoading ? (
          <EmptyState
            icon={<Icon icon="clock" size="lg" />}
            title="Loading bots"
            description="Fetching bots."
            isCompact
          />
        ) : botsError !== undefined ? (
          <EmptyState
            icon={<Icon icon="warning" size="lg" />}
            title="Bots couldn’t load"
            description={botsError}
            {...(onRetryBots !== undefined
              ? { actions: <Button label="Try loading again" variant="secondary" onClick={onRetryBots} /> }
              : {})}
            isCompact
          />
        ) : bots.length === 0 ? (
          <EmptyState
            icon={<Icon icon="checkDouble" size="lg" />}
            title="No bots"
            description="Create a Bot from the workspace to start chatting."
            isCompact
          />
        ) : (
          bots.map((bot) => (
            <VStack key={bot.id} gap={1}>
              <Item
                startContent={<AvatarView avatar={bot.avatar} name={bot.name} size="sm" presentation="static" />}
                label={bot.name}
                labelLines={2}
                description="Deletion permanently removes Omarchy Bot-owned data."
                align="start"
                data-testid={`settings-bot-${bot.id}`}
              />
              <HStack gap={1} wrap="wrap" justify="end">
                <Button
                  label={`Delete ${bot.name}`}
                  variant="destructive"
                  size="sm"
                  isLoading={deletingBotId === bot.id}
                  isDisabled={operationPending}
                  onClick={() => onRequestDelete(bot)}
                  data-testid={`settings-delete-${bot.id}`}
                >
                  Delete
                </Button>
              </HStack>
            </VStack>
          ))
        )}
      </VStack>
    </VStack>
  );
}

/** Responsive workspace settings with preferences, integration guidance, and permanent Bot deletion. */
export function SettingsDialog({
  open,
  onClose,
  bots,
  deletingBotId,
  onRequestDeleteBot,
  botsLoading = false,
  botsError,
  onRetryBots,
  agents,
  agentsLoading = false,
  agentsError,
  dictation,
  autoSendVoice,
  onAutoSendVoiceChange,
  mobileReturnFocusRef,
  notificationPermission,
  onRequestNotifications,
}: SettingsDialogProps): JSX.Element {
  const { isMobile } = useAppShellMobile();
  const content = (
    <SettingsContent
      bots={bots}
      botsLoading={botsLoading}
      {...(botsError !== undefined ? { botsError } : {})}
      {...(onRetryBots !== undefined ? { onRetryBots } : {})}
      agents={agents}
      agentsLoading={agentsLoading}
      {...(agentsError !== undefined ? { agentsError } : {})}
      dictation={dictation}
      autoSendVoice={autoSendVoice}
      onAutoSendVoiceChange={onAutoSendVoiceChange}
      notificationPermission={notificationPermission}
      onRequestNotifications={onRequestNotifications}
      compactHeading={isMobile}
      {...(deletingBotId !== undefined ? { deletingBotId } : {})}
      onRequestDelete={onRequestDeleteBot}
    />
  );

  return isMobile ? (
    <BottomSheetWithReturnFocus
      label="Settings"
      returnFocusRef={mobileReturnFocusRef}
      isOpen={open}
      onOpenChange={(nextOpen) => !nextOpen && onClose()}
      height="tall"
    >
      {content}
    </BottomSheetWithReturnFocus>
  ) : (
    <Dialog isOpen={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} width={600}>
      <DialogHeader title="Settings" subtitle="Manage workspace preferences and bot lifecycle." />
      {content}
    </Dialog>
  );
}
