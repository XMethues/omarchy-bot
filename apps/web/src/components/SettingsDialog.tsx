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
  bots: BotViewDto[];
  onArchiveBot: (botId: string, body: { confirmStop?: boolean }) => Promise<BotDto>;
  onBotArchived?: (botId: string) => void;
  onRestoreBot: (botId: string) => Promise<BotDto>;
  onBotRestored?: (bot: BotDto) => void;
  onDeleteBot: (botId: string, confirmName: string) => Promise<DeleteBotResultDto>;
  onBotDeleted?: (botId: string) => void;
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
  activeRegionRef: RefObject<HTMLDivElement | null>;
  archivedRegionRef: RefObject<HTMLDivElement | null>;
  archivingBotId?: string;
  restoringBotId?: string;
  deletingBotId?: string;
  error?: string;
  onRequestArchive: (bot: BotViewDto) => void;
  onRestore: (botId: string) => void;
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
  activeRegionRef,
  archivedRegionRef,
  archivingBotId,
  restoringBotId,
  deletingBotId,
  error,
  onRequestArchive,
  onRestore,
  onRequestDelete,
}: SettingsContentProps): JSX.Element {
  const active = bots.filter((bot) => !bot.archived);
  const archived = bots.filter((bot) => bot.archived);
  const unavailableAgents = agents.filter((agent) => agent.status !== "ready");
  const operationPending = archivingBotId !== undefined || restoringBotId !== undefined || deletingBotId !== undefined;
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
          <Text color="secondary">Archive active bots or restore and permanently remove archived bots.</Text>
        </VStack>
        {error !== undefined ? <Banner status="error" title={error} /> : null}
        {botsLoading ? (
          <EmptyState
            icon={<Icon icon="clock" size="lg" />}
            title="Loading bots"
            description="Fetching active and archived bots."
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
        ) : (
          <>
            <VStack ref={activeRegionRef} gap={2} tabIndex={-1}>
              <Heading level={4}>Active bots</Heading>
              {active.length === 0 ? (
                <EmptyState
                  icon={<Icon icon="checkDouble" size="lg" />}
                  title="No active bots"
                  description="Restore an archived bot or create a new one from the workspace."
                  isCompact
                />
              ) : (
                active.map((bot) => (
                  <VStack key={bot.id} gap={1}>
                    <Item
                      startContent={<AvatarView avatar={bot.avatar} name={bot.name} size="sm" activity="idle" />}
                      label={bot.name}
                      labelLines={2}
                      description="Conversations are preserved when archived"
                      align="start"
                      data-testid={`settings-active-bot-${bot.id}`}
                    />
                    <HStack justify="end">
                      <Button
                        label={`Archive ${bot.name}`}
                        variant="secondary"
                        size="sm"
                        isLoading={archivingBotId === bot.id}
                        isDisabled={operationPending && archivingBotId !== bot.id}
                        onClick={() => onRequestArchive(bot)}
                        data-testid={`settings-archive-${bot.id}`}
                      >
                        Archive
                      </Button>
                    </HStack>
                  </VStack>
                ))
              )}
            </VStack>
            <VStack ref={archivedRegionRef} gap={2} tabIndex={-1}>
              <Heading level={4}>Archived bots</Heading>
              {archived.length === 0 ? (
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
          </>
        )}
      </VStack>
    </VStack>
  );
}

/** Responsive workspace settings with local preferences, integration guidance, and Bot lifecycle controls. */
export function SettingsDialog({
  open,
  onClose,
  bots,
  onArchiveBot,
  onBotArchived,
  onRestoreBot,
  onBotRestored,
  onDeleteBot,
  onBotDeleted,
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
  const [pendingArchiveBot, setPendingArchiveBot] = useState<BotViewDto | undefined>(undefined);
  const [archivingBotId, setArchivingBotId] = useState<string | undefined>(undefined);
  const [archiveError, setArchiveError] = useState<string | undefined>(undefined);
  const [restoringBotId, setRestoringBotId] = useState<string | undefined>(undefined);
  const [pendingDeleteBot, setPendingDeleteBot] = useState<BotViewDto | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const activeRegionRef = useRef<HTMLDivElement>(null);
  const archivedRegionRef = useRef<HTMLDivElement>(null);

  const focusRegion = (region: RefObject<HTMLDivElement | null>): void => {
    requestAnimationFrame(() => region.current?.focus());
  };

  const archive = async (bot: BotViewDto, confirmStop: boolean): Promise<void> => {
    setArchivingBotId(bot.id);
    setArchiveError(undefined);
    setError(undefined);
    try {
      await onArchiveBot(bot.id, confirmStop ? { confirmStop: true } : {});
      clearDraftsByBot(bot.id);
      setPendingArchiveBot(undefined);
      onBotArchived?.(bot.id);
      focusRegion(activeRegionRef);
    } catch (archiveFailure) {
      const confirmationRequired =
        archiveFailure !== null
        && typeof archiveFailure === "object"
        && "status" in archiveFailure
        && archiveFailure.status === 409
        && "body" in archiveFailure
        && archiveFailure.body !== null
        && typeof archiveFailure.body === "object"
        && "confirmRequired" in archiveFailure.body
        && archiveFailure.body.confirmRequired === true;
      if (confirmationRequired || confirmStop) {
        setPendingArchiveBot(bot);
        setArchiveError(
          confirmationRequired
            ? undefined
            : archiveFailure instanceof Error
              ? archiveFailure.message
              : "The bot could not be archived.",
        );
      } else {
        setError(archiveFailure instanceof Error ? archiveFailure.message : "The bot could not be archived.");
      }
    } finally {
      setArchivingBotId(undefined);
    }
  };

  const requestArchive = (bot: BotViewDto): void => {
    if (bot.status === "working") {
      setPendingArchiveBot(bot);
      setArchiveError(undefined);
      return;
    }
    void archive(bot, false);
  };

  const restore = async (botId: string): Promise<void> => {
    setRestoringBotId(botId);
    setError(undefined);
    try {
      const restored = await onRestoreBot(botId);
      onBotRestored?.(restored);
      focusRegion(archivedRegionRef);
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
      focusRegion(archivedRegionRef);
    } catch (deleteFailure) {
      setDeleteError(deleteFailure instanceof Error ? deleteFailure.message : "This bot couldn’t be permanently deleted. Try again.");
    } finally {
      setDeleting(false);
    }
  };

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
      activeRegionRef={activeRegionRef}
      archivedRegionRef={archivedRegionRef}
      {...(archivingBotId !== undefined ? { archivingBotId } : {})}
      {...(restoringBotId !== undefined ? { restoringBotId } : {})}
      {...(deleting && pendingDeleteBot !== undefined ? { deletingBotId: pendingDeleteBot.id } : {})}
      {...(error !== undefined ? { error } : {})}
      onRequestArchive={requestArchive}
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
      <DialogHeader title="Settings" subtitle="Manage workspace preferences and bot lifecycle." />
      {content}
    </Dialog>
  );

  return (
    <>
      {settingsSurface}
      <AlertDialog
        isOpen={pendingArchiveBot !== undefined}
        onOpenChange={(nextOpen) => {
          if (!nextOpen && archivingBotId === undefined) {
            setPendingArchiveBot(undefined);
            setArchiveError(undefined);
          }
        }}
        title={archiveError === undefined ? "Stop work and archive?" : "Couldn’t archive bot"}
        description={
          archiveError
          ?? `${pendingArchiveBot?.name ?? "This bot"} is working. Its current work will be stopped before the bot is archived. Conversations are kept.`
        }
        cancelLabel="Keep working"
        actionLabel={archiveError === undefined ? "Stop and archive" : "Try again"}
        actionVariant="destructive"
        isActionLoading={archivingBotId !== undefined}
        onAction={() => {
          if (pendingArchiveBot !== undefined) void archive(pendingArchiveBot, true);
        }}
        data-testid="archive-working-confirmation"
      />
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
