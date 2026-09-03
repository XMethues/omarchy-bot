import type { JSX, RefObject } from "react";
import { useRef, useState } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
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
import type { AgentDto, BotDto, BotViewDto, DeleteBotResultDto, DictationDto } from "@omarchy-bot/protocol";
import { agentAvailabilityDescription } from "../lib/agentPresentation.ts";
import { clearDraftsByBot } from "../lib/drafts.ts";
import { AvatarView } from "./AvatarView.tsx";
import { VoiceSettingsControl } from "./VoiceSettingsControl.tsx";
import { BottomSheetWithReturnFocus } from "./BottomSheetWithReturnFocus.tsx";

export interface SettingsDialogProps {
  open: boolean;
  mobileReturnFocusRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  archivedBots: BotViewDto[];
  onRestoreBot: (botId: string) => Promise<BotDto>;
  onBotRestored?: (bot: BotDto) => void;
  onDeleteBot: (botId: string, confirmName: string) => Promise<DeleteBotResultDto>;
  onBotDeleted?: (botId: string) => void;
  archivedBotsLoading?: boolean;
  archivedBotsError?: string;
  onRetryArchivedBots?: () => void;
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
  | "archivedBots"
  | "archivedBotsLoading"
  | "archivedBotsError"
  | "onRetryArchivedBots"
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
  regionRef: RefObject<HTMLDivElement | null>;
  restoringBotId?: string;
  deletingBotId?: string;
  error?: string;
  onRestore: (botId: string) => void;
  onRequestDelete: (bot: BotViewDto) => void;
}

function SettingsContent({
  archivedBots,
  archivedBotsLoading = false,
  archivedBotsError,
  onRetryArchivedBots,
  agents,
  agentsLoading = false,
  agentsError,
  dictation,
  autoSendVoice,
  onAutoSendVoiceChange,
  notificationPermission,
  onRequestNotifications,
  compactHeading,
  regionRef,
  restoringBotId,
  deletingBotId,
  error,
  onRestore,
  onRequestDelete,
}: SettingsContentProps): JSX.Element {
  const archived = archivedBots.filter((bot) => bot.archived);
  const operationPending = restoringBotId !== undefined || deletingBotId !== undefined;
  const unavailableAgents = agents.filter((agent) => agent.status !== "ready");
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
      aria-busy={archivedBotsLoading || agentsLoading || operationPending || undefined}
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
      <VStack ref={regionRef} gap={2} tabIndex={-1}>
        <VStack gap={0.5}>
          <Heading level={3}>Archived bots</Heading>
          <Text color="secondary">Restore a bot or permanently remove its conversations and saved data.</Text>
        </VStack>
        {error !== undefined ? <Banner status="error" title={error} /> : null}
        {archivedBotsLoading ? (
          <EmptyState
            icon={<Icon icon="clock" size="lg" />}
            title="Loading archived bots"
            description="Fetching bots that can be restored or removed."
            isCompact
          />
        ) : archivedBotsError !== undefined ? (
          <EmptyState
            icon={<Icon icon="warning" size="lg" />}
            title="Archived bots couldn’t load"
            description={archivedBotsError}
            {...(onRetryArchivedBots !== undefined
              ? { actions: <Button label="Try loading again" variant="secondary" onClick={onRetryArchivedBots} /> }
              : {})}
            isCompact
          />
        ) : archived.length === 0 ? (
          <EmptyState
            icon={<Icon icon="checkDouble" size="lg" />}
            title="No archived bots"
            description="Bots you archive will remain available here."
            isCompact
          />
        ) : (
          archived.map((bot) => (
            <VStack key={bot.id} gap={1}>
              <Item
                startContent={<AvatarView avatar={bot.avatar} name={bot.name} size="sm" activity="idle" />}
                label={bot.name}
                labelLines={2}
                description="Conversations preserved"
                align="start"
                data-testid={`settings-archived-bot-${bot.id}`}
              />
              <HStack gap={1} wrap="wrap" justify="end">
                <Button
                  label={`Restore ${bot.name}`}
                  variant="secondary"
                  size="sm"
                  isLoading={restoringBotId === bot.id}
                  isDisabled={operationPending && restoringBotId !== bot.id}
                  onClick={() => onRestore(bot.id)}
                  data-testid={`settings-restore-${bot.id}`}
                >
                  Restore
                </Button>
                <Button
                  label={`Permanently delete ${bot.name}`}
                  variant="secondary"
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

/** Responsive workspace settings with local preferences, integration guidance, and Bot lifecycle controls. */
export function SettingsDialog({
  open,
  onClose,
  archivedBots,
  onRestoreBot,
  onBotRestored,
  onDeleteBot,
  onBotDeleted,
  archivedBotsLoading = false,
  archivedBotsError,
  onRetryArchivedBots,
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
  const [restoringBotId, setRestoringBotId] = useState<string | undefined>(undefined);
  const [pendingDeleteBot, setPendingDeleteBot] = useState<BotViewDto | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const archivedRegionRef = useRef<HTMLDivElement>(null);

  const focusArchivedRegion = (): void => {
    requestAnimationFrame(() => archivedRegionRef.current?.focus());
  };

  const restore = async (botId: string): Promise<void> => {
    setRestoringBotId(botId);
    setError(undefined);
    try {
      const restored = await onRestoreBot(botId);
      onBotRestored?.(restored);
      focusArchivedRegion();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "This bot couldn’t be restored. Try again.");
    } finally {
      setRestoringBotId(undefined);
    }
  };

  const permanentlyDelete = async (): Promise<void> => {
    const bot = pendingDeleteBot;
    if (bot === undefined) return;
    setDeleting(true);
    setDeleteError(undefined);
    setError(undefined);
    try {
      if (!clearDraftsByBot(bot.id)) {
        setDeleteError("Drafts saved in this browser couldn’t be cleared. The bot remains archived so you can try again.");
        return;
      }
      const result = await onDeleteBot(bot.id, bot.name);
      if (result.status === "failed") {
        setDeleteError("Some saved data couldn’t be removed. The bot remains archived so you can try again.");
        return;
      }
      setPendingDeleteBot(undefined);
      onBotDeleted?.(bot.id);
      focusArchivedRegion();
    } catch (deleteFailure) {
      setDeleteError(deleteFailure instanceof Error ? deleteFailure.message : "This bot couldn’t be permanently deleted. Try again.");
    } finally {
      setDeleting(false);
    }
  };

  const content = (
    <SettingsContent
      archivedBots={archivedBots}
      archivedBotsLoading={archivedBotsLoading}
      {...(archivedBotsError !== undefined ? { archivedBotsError } : {})}
      {...(onRetryArchivedBots !== undefined ? { onRetryArchivedBots } : {})}
      agents={agents}
      agentsLoading={agentsLoading}
      {...(agentsError !== undefined ? { agentsError } : {})}
      dictation={dictation}
      autoSendVoice={autoSendVoice}
      onAutoSendVoiceChange={onAutoSendVoiceChange}
      notificationPermission={notificationPermission}
      onRequestNotifications={onRequestNotifications}
      compactHeading={isMobile}
      regionRef={archivedRegionRef}
      {...(restoringBotId !== undefined ? { restoringBotId } : {})}
      {...(deleting && pendingDeleteBot !== undefined ? { deletingBotId: pendingDeleteBot.id } : {})}
      {...(error !== undefined ? { error } : {})}
      onRestore={(botId) => void restore(botId)}
      onRequestDelete={(bot) => {
        setPendingDeleteBot(bot);
        setDeleteError(undefined);
      }}
    />
  );

  const settingsSurface = isMobile ? (
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
      <DialogHeader title="Settings" subtitle="Manage workspace preferences and archived bots." />
      {content}
    </Dialog>
  );

  return (
    <>
      {settingsSurface}
      <AlertDialog
        isOpen={pendingDeleteBot !== undefined}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && !deleting) {
            setPendingDeleteBot(undefined);
            setDeleteError(undefined);
          }
        }}
        title={deleteError === undefined ? `Permanently delete ${pendingDeleteBot?.name ?? "this bot"}?` : "Couldn’t permanently delete bot"}
        description={
          deleteError
            ?? `${pendingDeleteBot?.name ?? "This bot"}’s Threads and local managed data, including messages, attachments, and avatar data, will be permanently removed. This cannot be undone.`
        }
        cancelLabel="Keep archived Bot"
        actionLabel={deleteError === undefined ? "Delete permanently" : "Try again"}
        actionVariant="destructive"
        isActionLoading={deleting}
        onAction={() => void permanentlyDelete()}
        data-testid="permanent-delete-confirmation"
      />
    </>
  );
}
