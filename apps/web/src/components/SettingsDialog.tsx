import type { JSX, ReactNode } from "react";
import { useState } from "react";
import { AlertDialog } from "@astryxdesign/core/AlertDialog";
import { Banner } from "@astryxdesign/core/Banner";
import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Item } from "@astryxdesign/core/Item";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { ArchiveRestore } from "lucide-react";
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
  /** Other Settings domains, such as Voice, compose above Archived Bots. */
  children?: ReactNode;
}

interface SettingsContentProps extends Pick<SettingsDialogProps, "archivedBots" | "children"> {
  compactHeading: boolean;
  restoringBotId?: string;
  deletingBotId?: string;
  error?: string;
  onRestore: (botId: string) => void;
  onRequestDelete: (bot: BotViewDto) => void;
}

function SettingsContent({
  archivedBots,
  children,
  compactHeading,
  restoringBotId,
  deletingBotId,
  error,
  onRestore,
  onRequestDelete,
}: SettingsContentProps): JSX.Element {
  const archived = archivedBots.filter((bot) => bot.archived);
  const operationPending = restoringBotId !== undefined || deletingBotId !== undefined;
  return (
    <VStack gap={4} padding={4} data-testid="settings-dialog">
      {compactHeading ? <Heading level={2}>Settings</Heading> : null}
      {children}
      <VStack gap={2}>
        <VStack gap={0.5}>
          <Heading level={3}>Archived Bots</Heading>
          <Text color="secondary">Restore a Bot or permanently remove its conversations and local data.</Text>
        </VStack>
        {error !== undefined ? <Banner status="error" title={error} /> : null}
        {archived.length === 0 ? (
          <EmptyState
            icon={<ArchiveRestore size={24} />}
            title="No archived bots"
            description="Bots you archive will remain available here."
            isCompact
          />
        ) : (
          archived.map((bot) => (
            <Item
              key={bot.id}
              startContent={<AvatarView avatar={bot.avatar} name={bot.name} size="sm" activity="idle" />}
              label={bot.name}
              description="Conversations preserved"
              endContent={
                <HStack gap={1}>
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
              }
              data-testid={`settings-archived-bot-${bot.id}`}
            />
          ))
        )}
      </VStack>
    </VStack>
  );
}

/** Responsive, composable Settings surface with the archived-Bot lifecycle controls. */
export function SettingsDialog({
  open,
  onClose,
  archivedBots,
  onRestoreBot,
  onBotRestored,
  onDeleteBot,
  onBotDeleted,
  children,
}: SettingsDialogProps): JSX.Element {
  const isSmallScreen = useMediaQuery("(max-width: 640px)");
  const [restoringBotId, setRestoringBotId] = useState<string | undefined>(undefined);
  const [pendingDeleteBot, setPendingDeleteBot] = useState<BotViewDto | undefined>(undefined);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const restore = async (botId: string): Promise<void> => {
    setRestoringBotId(botId);
    setError(undefined);
    try {
      const restored = await onRestoreBot(botId);
      onBotRestored?.(restored);
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "The bot could not be restored.");
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
        setDeleteError("Current-window drafts could not be cleared. The archived Bot was kept so deletion can be retried.");
        return;
      }
      const result = await onDeleteBot(bot.id, bot.name);
      if (result.status === "failed") {
        const detail = result.failures.map((failure) => failure.message).join("; ");
        setDeleteError(`${detail || "Local cleanup did not complete."} The archived Bot was kept so deletion can be retried.`);
        return;
      }
      setPendingDeleteBot(undefined);
      onBotDeleted?.(bot.id);
    } catch (deleteFailure) {
      setDeleteError(deleteFailure instanceof Error ? deleteFailure.message : "The Bot could not be permanently deleted.");
    } finally {
      setDeleting(false);
    }
  };

  const content = (
    <SettingsContent
      archivedBots={archivedBots}
      compactHeading={isSmallScreen}
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
        title={deleteError === undefined ? `Permanently delete ${pendingDeleteBot?.name ?? "this Bot"}?` : "Couldn’t permanently delete Bot"}
        description={
          deleteError
            ?? `${pendingDeleteBot?.name ?? "This Bot"} and all of its Threads, messages, attachments, uploaded avatar, and other local managed data will be permanently removed. This cannot be undone.`
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
