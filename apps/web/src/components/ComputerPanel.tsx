import type { JSX, RefObject } from "react";
import { useCallback, useEffect, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { Maximize2 } from "lucide-react";
import { AspectRatio } from "@astryxdesign/core/AspectRatio";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { LayoutPanel } from "@astryxdesign/core/Layout";
import { Lightbox } from "@astryxdesign/core/Lightbox";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { StackItem } from "@astryxdesign/core/Stack";
import { VStack } from "@astryxdesign/core/VStack";
import type { BotViewDto, ComputerViewDto } from "@omarchy-bot/protocol";

export interface ComputerPanelProps {
  bot: Pick<BotViewDto, "id" | "name">;
  view: ComputerViewDto;
  snapshotUrl: string;
  open: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  busy?: boolean;
  error?: string;
  loading?: boolean;
  onRetry?: () => void;
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
    borderRadius: "var(--radius-container)",
    overflow: "hidden",
    backgroundColor: "var(--color-background-surface)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--color-border)",
  },
  image: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  imageLoading: {
    visibility: "hidden",
  },
  previewState: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "var(--spacing-4)",
  },
  previewAction: {
    position: "absolute",
    insetBlockStart: "var(--spacing-2)",
    insetInlineEnd: "var(--spacing-2)",
  },
});
interface ComputerPanelContentProps extends Omit<ComputerPanelProps, "onClose"> {
  onExpandPreview?: () => void;
}

function ComputerPanelContent({
  bot,
  open,
  view,
  snapshotUrl,
  busy = false,
  error,
  loading = false,
  onRetry,
  onTakeControl,
  onReturnToBot,
  onExpandPreview,
}: ComputerPanelContentProps): JSX.Element {
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const canShowPreview = !loading && view.state !== "unavailable";
  const canTakeControl = view.state === "bot-using" || view.state === "needs-you";

  useEffect(() => {
    if (!canShowPreview || !open) return;
    setPreviewLoading(true);
    setPreviewError(false);
  }, [snapshotUrl, canShowPreview, open]);

  const retry = (): void => {
    setPreviewError(false);
    setPreviewLoading(true);
    setPreviewKey((key) => key + 1);
    onRetry?.();
  };

  return (
    <VStack gap={4} padding={4} aria-busy={loading || busy || undefined} data-testid="computer-drawer">
      {!loading && view.state !== "unavailable" ? (
        <VStack gap={1}>
          <Heading level={3}>{STATE_LABELS[view.state]}</Heading>
          <Text color="secondary">{view.activity ?? `${bot.name}’s shared computer view.`}</Text>
        </VStack>
      ) : null}
      {error !== undefined ? <Banner status="error" title={error} /> : null}
      {loading ? (
        <EmptyState
          icon={<Icon icon="clock" size="lg" />}
          title="Checking the computer"
          description="The latest computer state will appear here."
          isCompact
        />
      ) : view.state === "unavailable" ? (
        <EmptyState
          icon={<Icon icon="warning" size="lg" />}
          title="Computer unavailable"
          description={view.activity ?? "This bot’s computer isn’t available right now."}
          {...(onRetry !== undefined
            ? { actions: <Button label="Check again" variant="secondary" onClick={retry} /> }
            : {})}
          isCompact
        />
      ) : (
        <AspectRatio ratio={16 / 9} fit="contain" xstyle={localStyles.preview}>
          <img
            key={previewKey}
            src={snapshotUrl}
            alt={`Latest computer preview for ${bot.name}`}
            onLoad={() => {
              setPreviewLoading(false);
              setPreviewError(false);
            }}
            onError={() => {
              setPreviewLoading(false);
              setPreviewError(true);
            }}
            {...stylex.props(localStyles.image, previewLoading && localStyles.imageLoading)}
            data-testid="computer-preview"
          />
          {onExpandPreview !== undefined && !previewLoading && !previewError ? (
            <div {...stylex.props(localStyles.previewAction)}>
              <IconButton
                label="Expand desktop preview"
                tooltip="Expand desktop preview"
                icon={<Icon icon={Maximize2} size="sm" />}
                variant="secondary"
                onClick={onExpandPreview}
                data-testid="computer-preview-expand"
              />
            </div>
          ) : null}
          {previewLoading || previewError ? (
            <div {...stylex.props(localStyles.previewState)}>
              <EmptyState
                icon={<Icon icon={previewError ? "warning" : "clock"} size="lg" />}
                title={previewError ? "Preview couldn’t load" : "Loading preview"}
                description={previewError ? "The computer may still be available. Try loading the preview again." : "Fetching the latest computer image."}
                {...(previewError
                  ? { actions: <Button label="Try preview again" variant="secondary" onClick={retry} /> }
                  : {})}
                isCompact
              />
            </div>
          ) : null}
        </AspectRatio>
      )}
      <HStack gap={2} justify="end" wrap="wrap">
        {canTakeControl && !loading ? (
          <Button
            label="Take control"
            variant="primary"
            isLoading={busy}
            onClick={onTakeControl}
            data-testid="computer-take-control"
          />
        ) : null}
        {view.state === "user-control" && !loading ? (
          <Button
            label="Return to bot"
            variant="primary"
            isLoading={busy}
            onClick={onReturnToBot}
            data-testid="computer-return-to-bot"
          />
        ) : null}
      </HStack>
    </VStack>
  );
}

/** Right-side computer panel at every window width. */
export function ComputerPanel({
  open,
  onClose,
  returnFocusRef,
  ...contentProps
}: ComputerPanelProps): JSX.Element | null {
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const closePanel = useCallback((): void => {
    onClose();
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, [onClose, returnFocusRef]);
  const content = (
    <ComputerPanelContent
      {...contentProps}
      open={open}
      onExpandPreview={() => setPreviewExpanded(true)}
    />
  );
  const lightbox = (
    <Lightbox
      isOpen={previewExpanded}
      onOpenChange={setPreviewExpanded}
      media={{
        src: contentProps.snapshotUrl,
        alt: `Expanded computer preview for ${contentProps.bot.name}`,
        caption: `${contentProps.bot.name} computer`,
      }}
      hasZoom
    />
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !previewExpanded) closePanel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closePanel, open, previewExpanded]);

  if (!open) return null;

  return (
    <>
      <LayoutPanel
        width="min(440px, 100vw)"
        padding={0}
        hasDivider
        isScrollable
        label="Computer"
        role="complementary"
        style={{ width: "min(440px, 100vw)", minWidth: 0, maxWidth: "100vw" }}
      >
        <HStack gap={2} padding={4} vAlign="center">
          <StackItem size="fill">
            <Heading level={2}>Computer</Heading>
          </StackItem>
          <IconButton
            label="Close computer drawer"
            tooltip="Close computer drawer"
            icon={<Icon icon="close" size="md" />}
            variant="ghost"
            onClick={closePanel}
            data-testid="computer-drawer-close"
          />
        </HStack>
        {content}
      </LayoutPanel>
      {lightbox}
    </>
  );
}
