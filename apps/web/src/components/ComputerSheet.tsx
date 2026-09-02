import type { JSX } from "react";
import * as stylex from "@stylexjs/stylex";
import { AspectRatio } from "@astryxdesign/core/AspectRatio";
import { Banner } from "@astryxdesign/core/Banner";
import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import type { BotViewDto, ComputerViewDto } from "@omarchy-bot/protocol";

export interface ComputerSheetProps {
  bot: Pick<BotViewDto, "id" | "name">;
  view: ComputerViewDto;
  snapshotUrl: string;
  open: boolean;
  busy?: boolean;
  error?: string;
  onClose: () => void;
  onTakeControl: () => void;
  onReturnToBot: () => void;
}

const STATE_LABELS: Record<ComputerViewDto["state"], string> = {
  idle: "Computer ready",
  "bot-using": "Using computer",
  waiting: "Waiting for computer",
  "needs-you": "Needs you",
  "user-control": "You have control",
  "emergency-stopped": "Computer control stopped",
  unavailable: "Computer unavailable",
};

const localStyles = stylex.create({
  preview: {
    borderRadius: "var(--radius-md)",
    overflow: "hidden",
    backgroundColor: "var(--color-background-surface)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--color-border-secondary)",
  },
  image: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
});

interface ComputerSheetContentProps extends Omit<ComputerSheetProps, "open" | "onClose"> {
  compactHeading: boolean;
}

function ComputerSheetContent({
  bot,
  view,
  snapshotUrl,
  busy = false,
  error,
  onTakeControl,
  onReturnToBot,
  compactHeading,
}: ComputerSheetContentProps): JSX.Element {
  const canTakeControl = view.state === "bot-using" || view.state === "needs-you";
  return (
    <VStack gap={4} padding={4} data-testid="computer-sheet">
      {compactHeading ? <Heading level={2}>Computer</Heading> : null}
      <VStack gap={1}>
        <Heading level={3}>{STATE_LABELS[view.state]}</Heading>
        <Text color="secondary">{view.activity ?? `${bot.name}'s shared computer view.`}</Text>
      </VStack>
      {error !== undefined ? <Banner status="error" title={error} /> : null}
      <AspectRatio ratio={16 / 9} fit="contain" xstyle={localStyles.preview}>
        <img
          src={snapshotUrl}
          alt={`Latest computer preview for ${bot.name}`}
          {...stylex.props(localStyles.image)}
          data-testid="computer-preview"
        />
      </AspectRatio>
      <HStack gap={2} justify="end">
        {canTakeControl ? (
          <Button
            label="Take control"
            variant="primary"
            isDisabled={busy}
            onClick={onTakeControl}
            data-testid="computer-take-control"
          />
        ) : null}
        {view.state === "user-control" ? (
          <Button
            label="Return to Bot"
            variant="primary"
            isDisabled={busy}
            onClick={onReturnToBot}
            data-testid="computer-return-to-bot"
          />
        ) : null}
      </HStack>
    </VStack>
  );
}

/** Responsive selected-Bot computer surface with arbitration details intentionally omitted. */
export function ComputerSheet({ open, onClose, ...contentProps }: ComputerSheetProps): JSX.Element {
  const isSmallScreen = useMediaQuery("(max-width: 640px)");
  const content = <ComputerSheetContent {...contentProps} compactHeading={isSmallScreen} />;

  if (isSmallScreen) {
    return (
      <BottomSheet label="Computer" isOpen={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} height="tall">
        {content}
      </BottomSheet>
    );
  }

  return (
    <Dialog isOpen={open} onOpenChange={(nextOpen) => !nextOpen && onClose()} width={720}>
      <DialogHeader title="Computer" subtitle={`See what ${contentProps.bot.name} is doing and step in when needed.`} />
      {content}
    </Dialog>
  );
}
