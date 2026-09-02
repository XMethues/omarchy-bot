import type { JSX, ReactNode, RefObject } from "react";
import { useRef, useState } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Item } from "@astryxdesign/core/Item";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import type { BotDto, BotViewDto, DeleteBotResultDto } from "@omarchy-bot/protocol";
import { clearDraftsByBot } from "../lib/drafts.ts";
import { AvatarView } from "./AvatarView.tsx";

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  archivedBots: BotViewDto[];
  onRestoreBot: (botId: string) => Promise<BotDto>;
  onBotRestored?: (bot: BotDto) => void;
  onDeleteBot: (botId: string, confirmName: string) => Promise<DeleteBotResultDto>;
  onBotDeleted?: (botId: string) => void;
  archivedBotsLoading?: boolean;
  archivedBotsError?: string;
  onRetryArchivedBots?: () => void;
  /** Other Settings domains, such as Voice, compose above Archived Bots. */
  children?: ReactNode;
}

interface SettingsContentProps extends Pick<
  SettingsDialogProps,
  "archivedBots" | "archivedBotsLoading" | "archivedBotsError" | "onRetryArchivedBots" | "children"
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
  children,
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
  return (
    <VStack gap={4} padding={4} aria-busy={archivedBotsLoading || operationPending || undefined} data-testid="settings-dialog">
      {compactHeading ? <Heading level={2}>Settings</Heading> : null}
      {children}
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

/** Responsive, composable settings surface with archived-bot lifecycle controls. */
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
  children,
}: SettingsDialogProps): JSX.Element {
  const isSmallScreen = useMediaQuery("(max-width: 767px)");
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
      compactHeading={isSmallScreen}
      regionRef={archivedRegionRef}
      {...(restoringBotId !== undefined ? { restoringBotId } : {})}
      {...(deleting && pendingDeleteBot !== undefined ? { deletingBotId: pendingDeleteBot.id } : {})}
      {...(error !== undefined ? { error } : {})}
      onRestore={(botId) => void restore(botId)}
      onRequestDelete={(bot) => {
        setPendingDeleteBot(bot);
        setDeleteError(undefined);
      }}
    >
      {children}
    </SettingsContent>
  );

  const settingsSurface = isSmallScreen ? (
    <BottomSheet label="Settings" isOpen={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} height="tall">
      {content}
    </BottomSheet>
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
