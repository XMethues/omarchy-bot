import type { JSX, ReactNode } from "react";
import { useState } from "react";
import { Banner } from "@astryxdesign/core/Banner";
import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { Item } from "@astryxdesign/core/Item";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { ArchiveRestore } from "lucide-react";
import type { BotDto, BotViewDto } from "@omarchy-bot/protocol";
import { AvatarView } from "./AvatarView.tsx";

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  archivedBots: BotViewDto[];
  onRestoreBot: (botId: string) => Promise<BotDto>;
  onBotRestored?: (bot: BotDto) => void;
  /** Other Settings domains, such as Voice, compose above Archived Bots. */
  children?: ReactNode;
}

interface SettingsContentProps extends Pick<SettingsDialogProps, "archivedBots" | "children"> {
  compactHeading: boolean;
  restoringBotId?: string;
  error?: string;
  onRestore: (botId: string) => void;
}

function SettingsContent({
  archivedBots,
  children,
  compactHeading,
  restoringBotId,
  error,
  onRestore,
}: SettingsContentProps): JSX.Element {
  const archived = archivedBots.filter((bot) => bot.archived);
  return (
    <VStack gap={4} padding={4} data-testid="settings-dialog">
      {compactHeading ? <Heading level={2}>Settings</Heading> : null}
      {children}
      <VStack gap={2}>
        <VStack gap={0.5}>
          <Heading level={3}>Archived Bots</Heading>
          <Text color="secondary">Restore a bot to return it to the Sidebar. Its conversations stay intact.</Text>
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
                <Button
                  label={`Restore ${bot.name}`}
                  variant="secondary"
                  size="sm"
                  isLoading={restoringBotId === bot.id}
                  isDisabled={restoringBotId !== undefined && restoringBotId !== bot.id}
                  onClick={() => onRestore(bot.id)}
                  data-testid={`settings-restore-${bot.id}`}
                >
                  Restore
                </Button>
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
  children,
}: SettingsDialogProps): JSX.Element {
  const isSmallScreen = useMediaQuery("(max-width: 640px)");
  const [restoringBotId, setRestoringBotId] = useState<string | undefined>(undefined);
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

  const content = (
    <SettingsContent
      archivedBots={archivedBots}
      compactHeading={isSmallScreen}
      {...(restoringBotId !== undefined ? { restoringBotId } : {})}
      {...(error !== undefined ? { error } : {})}
      onRestore={(botId) => void restore(botId)}
    >
      {children}
    </SettingsContent>
  );

  if (isSmallScreen) {
    return (
      <BottomSheet label="Settings" isOpen={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} height="tall">
        {content}
      </BottomSheet>
    );
  }

  return (
    <Dialog isOpen={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} width={600}>
      <DialogHeader title="Settings" subtitle="Manage workspace preferences and archived bots." />
      {content}
    </Dialog>
  );
}
