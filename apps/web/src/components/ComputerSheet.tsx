import type { JSX, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import * as stylex from "@stylexjs/stylex";
import { Maximize2 } from "lucide-react";
import { AspectRatio } from "@astryxdesign/core/AspectRatio";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
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
import {
  ScreenProjectionConnection,
  type ScreenProjectionState,
} from "../lib/screenProjection.ts";
import { BottomSheetWithReturnFocus } from "./BottomSheetWithReturnFocus.tsx";

export interface ComputerSheetProps {
  bot: Pick<BotViewDto, "id" | "name">;
  view: ComputerViewDto;
  projectionUrl: string;
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
  starting: "Screen starting",
  ready: "Screen ready",
  "bot-using": "Using computer",
  waiting: "Waiting for computer",
  "needs-you": "Needs you",
  "user-control": "You have control",
  "emergency-stopped": "Computer control stopped",
  unavailable: "Computer unavailable",
};

const PROJECTION_LABELS: Record<ScreenProjectionState, string> = {
  connecting: "Connecting Screen Projection",
  preview: "Screen Projection live",
  expanded: "Screen Projection live",
  reconnecting: "Reconnecting Screen Projection",
  unavailable: "Screen Projection unavailable",
  closed: "Screen Projection idle",
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

interface ComputerSheetContentProps extends Omit<ComputerSheetProps, "onClose" | "projectionUrl"> {
  compactHeading: boolean;
  projectionState: ScreenProjectionState;
  frameUrl?: string;
  onProjectionRetry: () => void;
  onExpandPreview?: () => void;
}

function ComputerSheetContent({
  bot,
  view,
  busy = false,
  error,
  loading = false,
  onRetry,
  onTakeControl,
  onReturnToBot,
  compactHeading,
  projectionState,
  frameUrl,
  onProjectionRetry,
  onExpandPreview,
}: ComputerSheetContentProps): JSX.Element {
  const canTakeControl = view.state === "bot-using" || view.state === "needs-you";
  const projectionUnavailable = projectionState === "unavailable";
  const projectionWaiting = frameUrl === undefined && !projectionUnavailable;

  return (
    <VStack gap={4} padding={4} aria-busy={loading || busy || projectionWaiting || undefined} data-testid="computer-sheet">
      {compactHeading ? <Heading level={2}>Computer</Heading> : null}
      {!loading && view.state !== "unavailable" ? (
        <VStack gap={1}>
          <Heading level={3}>{STATE_LABELS[view.state]}</Heading>
          <Text color="secondary">{view.activity ?? `${bot.name}’s computer.`}</Text>
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
            ? { actions: <Button label="Check again" variant="secondary" onClick={onRetry} /> }
            : {})}
          isCompact
        />
      ) : (
        <>
          <VStack gap={1}>
            <Text>{PROJECTION_LABELS[projectionState]}</Text>
            <Text color="secondary">Read-only WebRTC projection. Signaling is unauthenticated; HTTPS is not required.</Text>
          </VStack>
          <AspectRatio ratio={16 / 9} fit="contain" xstyle={localStyles.preview}>
            {frameUrl === undefined ? null : (
              <img
                src={frameUrl}
                alt={`Latest computer preview for ${bot.name}`}
                {...stylex.props(localStyles.image)}
                data-testid="computer-preview"
              />
            )}
            {onExpandPreview !== undefined && frameUrl !== undefined ? (
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
            {frameUrl === undefined ? (
              <div {...stylex.props(localStyles.previewState)}>
                <EmptyState
                  icon={<Icon icon={projectionUnavailable ? "warning" : "clock"} size="lg" />}
                  title={projectionUnavailable ? "Projection unavailable" : PROJECTION_LABELS[projectionState]}
                  description={
                    projectionUnavailable
                      ? "The Computer Surface may still be available. Try the Screen Projection again."
                      : "Waiting for a direct frame from this Computer Surface."
                  }
                  {...(projectionUnavailable
                    ? { actions: <Button label="Try projection again" variant="secondary" onClick={onProjectionRetry} /> }
                    : {})}
                  isCompact
                />
              </div>
            ) : null}
          </AspectRatio>
        </>
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

/** Docked desktop drawer with a preview-only mobile sheet and expanded desktop viewer. */
export function ComputerSheet({
  open,
  onClose,
  returnFocusRef,
  projectionUrl,
  bot,
  view,
  ...contentProps
}: ComputerSheetProps): JSX.Element | null {
  const { isMobile: isSmallScreen } = useAppShellMobile();
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [projectionState, setProjectionState] = useState<ScreenProjectionState>("closed");
  const [frameUrl, setFrameUrl] = useState<string>();
  const [projectionAttempt, setProjectionAttempt] = useState(0);
  const connectionRef = useRef<ScreenProjectionConnection | undefined>(undefined);
  const frameUrlRef = useRef<string | undefined>(undefined);

  const replaceFrame = useCallback((frame: Blob | undefined): void => {
    if (frameUrlRef.current !== undefined) URL.revokeObjectURL(frameUrlRef.current);
    const nextUrl = frame === undefined ? undefined : URL.createObjectURL(frame);
    frameUrlRef.current = nextUrl;
    setFrameUrl(nextUrl);
  }, []);
  const closePanel = useCallback((): void => {
    setPreviewExpanded(false);
    onClose();
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, [onClose, returnFocusRef]);

  useEffect(() => {
    if (!open || view.state === "unavailable") {
      connectionRef.current?.close();
      connectionRef.current = undefined;
      replaceFrame(undefined);
      setProjectionState("closed");
      return;
    }
    const connection = new ScreenProjectionConnection(
      projectionUrl,
      { botId: bot.id, surfaceId: view.surfaceId },
      { onState: setProjectionState, onFrame: replaceFrame },
    );
    connectionRef.current = connection;
    connection.setMode(previewExpanded && !isSmallScreen ? "expanded" : "preview");
    void connection.connect();
    return () => {
      if (connectionRef.current === connection) connectionRef.current = undefined;
      connection.close();
      replaceFrame(undefined);
    };
  }, [bot.id, open, projectionAttempt, projectionUrl, replaceFrame, view.state === "unavailable", view.surfaceId]);

  useEffect(() => {
    if (isSmallScreen && previewExpanded) setPreviewExpanded(false);
    connectionRef.current?.setMode(previewExpanded && !isSmallScreen ? "expanded" : "preview");
  }, [isSmallScreen, previewExpanded]);

  useEffect(() => {
    if (!open || isSmallScreen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !previewExpanded) closePanel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closePanel, isSmallScreen, open, previewExpanded]);

  const content = (
    <ComputerSheetContent
      {...contentProps}
      bot={bot}
      view={view}
      open={open}
      compactHeading={isSmallScreen}
      projectionState={projectionState}
      {...(frameUrl === undefined ? {} : { frameUrl })}
      onProjectionRetry={() => setProjectionAttempt((attempt) => attempt + 1)}
      {...(!isSmallScreen && frameUrl !== undefined ? { onExpandPreview: () => setPreviewExpanded(true) } : {})}
    />
  );
  const lightbox = frameUrl === undefined ? null : (
    <Lightbox
      isOpen={!isSmallScreen && previewExpanded}
      onOpenChange={setPreviewExpanded}
      media={{
        src: frameUrl,
        alt: `Expanded computer preview for ${bot.name}`,
        caption: `${bot.name} computer — read-only Screen Projection`,
      }}
      hasZoom
    />
  );

  if (isSmallScreen) {
    return (
      <BottomSheetWithReturnFocus
        label="Computer"
        returnFocusRef={returnFocusRef}
        isOpen={open}
        onOpenChange={(nextOpen) => !nextOpen && onClose()}
        height="tall"
      >
        {content}
      </BottomSheetWithReturnFocus>
    );
  }
  if (!open) return null;

  return (
    <>
      <LayoutPanel width={380} padding={0} hasDivider label="Computer" role="complementary">
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
