import type {
  ClipboardEvent as ReactClipboardEvent,
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
  WheelEvent as ReactWheelEvent,
} from "react";
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
  onTakeControl: () => Promise<boolean>;
  onReturnToBot: () => Promise<boolean>;
}

const STATE_LABELS: Record<ComputerViewDto["state"], string> = {
  starting: "Screen starting",
  ready: "Screen ready",
  "bot-using": "Bot using screen",
  "needs-you": "Needs you",
  "user-control": "You have control",
  unavailable: "Screen unavailable",
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

interface ComputerSheetContentProps extends Omit<
  ComputerSheetProps,
  "onClose" | "projectionUrl" | "onTakeControl" | "onReturnToBot"
> {
  compactHeading: boolean;
  projectionState: ScreenProjectionState;
  frameUrl?: string;
  onProjectionRetry: () => void;
  onExpandPreview?: () => void;
  onTakeControl: () => void;
  onContinueTakeover: () => void;
}

function ComputerSheetContent({
  bot,
  view,
  busy = false,
  error,
  loading = false,
  onRetry,
  onTakeControl,
  onContinueTakeover,
  compactHeading,
  projectionState,
  frameUrl,
  onProjectionRetry,
  onExpandPreview,
}: ComputerSheetContentProps): JSX.Element {
  const canTakeControl = view.takeover === "available";
  const projectionUnavailable = projectionState === "unavailable";
  const projectionWaiting = frameUrl === undefined && !projectionUnavailable;

  return (
    <VStack gap={4} padding={4} aria-busy={loading || busy || projectionWaiting || undefined} data-testid="computer-sheet">
      {compactHeading ? <Heading level={2}>Computer Surface</Heading> : null}
      {!loading && view.state !== "unavailable" ? (
        <VStack gap={1}>
          <Heading level={3}>{STATE_LABELS[view.state]}</Heading>
          <Text color="secondary">{view.activity ?? `${bot.name}’s Bot Screen.`}</Text>
        </VStack>
      ) : null}
      {error !== undefined ? <Banner status="error" title={error} /> : null}
      {loading ? (
        <EmptyState
          icon={<Icon icon="clock" size="lg" />}
          title="Checking the Bot Screen"
          description="The latest Bot Screen state will appear here."
          isCompact
        />
      ) : view.state === "unavailable" ? (
        <EmptyState
          icon={<Icon icon="warning" size="lg" />}
          title="Screen unavailable"
          description={view.activity ?? "This Bot Screen isn’t available right now."}
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
                alt={`Computer Preview for ${bot.name}`}
                {...stylex.props(localStyles.image)}
                data-testid="computer-preview"
              />
            )}
            {onExpandPreview !== undefined && frameUrl !== undefined ? (
              <div {...stylex.props(localStyles.previewAction)}>
                <IconButton
                  label="Open Web Control"
                  tooltip="Open Web Control"
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
                  title={projectionUnavailable ? "Screen Projection unavailable" : PROJECTION_LABELS[projectionState]}
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
        {view.takeover === "active" && !loading ? (
          <Button
            label="Continue takeover"
            variant="primary"
            isLoading={busy}
            onClick={onContinueTakeover}
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
  onTakeControl,
  onReturnToBot,
  ...contentProps
}: ComputerSheetProps): JSX.Element | null {
  const { isMobile: isSmallScreen } = useAppShellMobile();
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [projectionState, setProjectionState] = useState<ScreenProjectionState>("closed");
  const [frameUrl, setFrameUrl] = useState<string>();
  const [projectionAttempt, setProjectionAttempt] = useState(0);
  const connectionRef = useRef<ScreenProjectionConnection | undefined>(undefined);
  const frameUrlRef = useRef<string | undefined>(undefined);
  const expandedRef = useRef<HTMLDialogElement | null>(null);
  const pressedPointersRef = useRef(new Map<number, number>());
  const browserPasteKeysRef = useRef(new Set<string>());

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
    if (!previewExpanded || isSmallScreen) pressedPointersRef.current.clear();
    connectionRef.current?.setMode(previewExpanded && !isSmallScreen ? "expanded" : "preview");
  }, [isSmallScreen, previewExpanded]);

  useEffect(() => {
    if (!open || isSmallScreen || !previewExpanded) return;
    const connection = connectionRef.current;
    requestAnimationFrame(() => expandedRef.current?.focus());
    browserPasteKeysRef.current.clear();
    const releaseForBlur = (): void => {
      pressedPointersRef.current.clear();
      browserPasteKeysRef.current.clear();
      connection?.releaseControl("blur");
    };
    const resumeAfterFocus = (): void => connection?.resumeControl();
    const releaseForNavigation = (): void => {
      pressedPointersRef.current.clear();
      browserPasteKeysRef.current.clear();
      connection?.releaseControl("navigation");
    };
    const handleVisibility = (): void => {
      if (document.visibilityState === "hidden") {
        pressedPointersRef.current.clear();
        browserPasteKeysRef.current.clear();
        connection?.releaseControl("visibility-loss");
      } else {
        connection?.resumeControl();
      }
    };
    window.addEventListener("blur", releaseForBlur);
    window.addEventListener("focus", resumeAfterFocus);
    window.addEventListener("pagehide", releaseForNavigation);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("blur", releaseForBlur);
      window.removeEventListener("focus", resumeAfterFocus);
      window.removeEventListener("pagehide", releaseForNavigation);
      browserPasteKeysRef.current.clear();
      document.removeEventListener("visibilitychange", handleVisibility);
      pressedPointersRef.current.clear();
      connection?.releaseControl("teardown");
    };
  }, [isSmallScreen, open, previewExpanded]);

  useEffect(() => {
    if (!open || isSmallScreen) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !previewExpanded) closePanel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closePanel, isSmallScreen, open, previewExpanded]);

  const sendExpandedMotion = (event: ReactPointerEvent<HTMLDialogElement>): void => {
    const image = event.currentTarget.querySelector("img");
    const overControl = event.target instanceof Element && event.target.closest("button") !== null;
    if (image === null || (overControl && !pressedPointersRef.current.has(event.pointerId))) return;
    connectionRef.current?.pointerMotion(
      event.clientX,
      event.clientY,
      image,
      pressedPointersRef.current.has(event.pointerId),
    );
  };
  const pressExpandedPointer = (event: ReactPointerEvent<HTMLDialogElement>): void => {
    if (event.target instanceof Element && event.target.closest("button") !== null) return;
    const image = event.currentTarget.querySelector("img");
    if (image === null || event.button < 0 || event.button > 2) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pressedPointersRef.current.set(event.pointerId, event.button);
    connectionRef.current?.pointerButton(event.clientX, event.clientY, image, event.button, "pressed");
  };
  const releaseExpandedPointer = (event: ReactPointerEvent<HTMLDialogElement>): void => {
    const button = pressedPointersRef.current.get(event.pointerId);
    const image = event.currentTarget.querySelector("img");
    if (button === undefined || image === null) return;
    event.preventDefault();
    pressedPointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    connectionRef.current?.pointerButton(event.clientX, event.clientY, image, button, "released");
  };
  const scrollExpandedPointer = (event: ReactWheelEvent<HTMLDialogElement>): void => {
    if (event.target instanceof Element && event.target.closest("button") !== null) return;
    const image = event.currentTarget.querySelector("img");
    if (image === null) return;
    event.preventDefault();
    connectionRef.current?.pointerScroll(event.clientX, event.clientY, image, event.deltaX, event.deltaY);
  };
  const suppressExpandedMenu = (event: ReactMouseEvent<HTMLDialogElement>): void => {
    if (!(event.target instanceof Element) || event.target.closest("button") === null) event.preventDefault();
  };
  const sendExpandedKey = (event: ReactKeyboardEvent<HTMLDialogElement>, state: "pressed" | "released"): void => {
    if (event.target instanceof Element && event.target.closest("button") !== null) return;
    if (state === "pressed" && event.code === "KeyV" && (event.ctrlKey || event.metaKey)) {
      browserPasteKeysRef.current.add(event.code);
      return;
    }
    if (state === "released" && browserPasteKeysRef.current.delete(event.code)) return;
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    const sent = connectionRef.current?.keyTransition(event.code, state, {
      control: event.ctrlKey,
      alt: event.altKey,
      shift: event.shiftKey,
      meta: event.metaKey,
    }) ?? false;
    if (sent) event.preventDefault();
  };
  const pasteExpandedText = (event: ReactClipboardEvent<HTMLDialogElement>): void => {
    if (event.target instanceof Element && event.target.closest("button") !== null) return;
    if (connectionRef.current?.paste(event.clipboardData.getData("text/plain")) === true) event.preventDefault();
  };
  const beginTakeover = useCallback((): void => {
    void onTakeControl()
      .then((taken) => {
        if (taken) setPreviewExpanded(true);
      })
      .catch(() => {});
  }, [onTakeControl]);
  const finishTakeover = useCallback((): void => {
    void onReturnToBot()
      .then((returned) => {
        if (returned) setPreviewExpanded(false);
      })
      .catch(() => {});
  }, [onReturnToBot]);

  const content = (
    <ComputerSheetContent
      {...contentProps}
      bot={bot}
      view={view}
      onTakeControl={beginTakeover}
      onContinueTakeover={() => setPreviewExpanded(true)}
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
      ref={expandedRef}
      isOpen={!isSmallScreen && previewExpanded}
      onOpenChange={setPreviewExpanded}
      media={{
        src: frameUrl,
        alt: `Web Control for ${bot.name}`,
        caption:
          view.takeover === "active" ? (
            <HStack gap={2} vAlign="center">
              <Text>{bot.name} Bot Screen — Web Control</Text>
              <Button
                label="I'm done"
                variant="primary"
                isLoading={contentProps.busy}
                onClick={finishTakeover}
                data-testid="computer-im-done"
              />
            </HStack>
          ) : (
            `${bot.name} Bot Screen — Web Control`
          ),
      }}
      {...(previewExpanded
        ? {
            onPointerMove: sendExpandedMotion,
            onPointerDown: pressExpandedPointer,
            onPointerUp: releaseExpandedPointer,
            onPointerCancel: releaseExpandedPointer,
            onWheel: scrollExpandedPointer,
            onContextMenu: suppressExpandedMenu,
            onKeyDown: (event: ReactKeyboardEvent<HTMLDialogElement>) => sendExpandedKey(event, "pressed"),
            onKeyUp: (event: ReactKeyboardEvent<HTMLDialogElement>) => sendExpandedKey(event, "released"),
            onPaste: pasteExpandedText,
            tabIndex: 0,
            "data-testid": "expanded-web-control",
          }
        : {})}
    />
  );

  if (isSmallScreen) {
    return (
      <BottomSheetWithReturnFocus
        label="Computer Surface"
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
      <LayoutPanel width={380} padding={0} hasDivider label="Computer Surface" role="complementary">
        <HStack gap={2} padding={4} vAlign="center">
          <StackItem size="fill">
            <Heading level={2}>Computer Surface</Heading>
          </StackItem>
          <IconButton
            label="Close Computer Surface"
            tooltip="Close Computer Surface"
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
