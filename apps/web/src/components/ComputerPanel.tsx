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

export interface ComputerPanelProps {
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
interface ComputerPanelContentProps extends Omit<
  ComputerPanelProps,
  "open" | "returnFocusRef" | "onClose" | "projectionUrl" | "onTakeControl" | "onReturnToBot"
> {
  previewOnly: boolean;
  projectionState: ScreenProjectionState;
  projectionError?: string;
  frameUrl?: string;
  screenRetrying: boolean;
  onProjectionRetry: () => void;
  onRetryScreen: () => void;
  onExpandPreview?: () => void;
  onTakeControl: () => void;
  onContinueTakeover: () => void;
}

function ComputerPanelContent({
  bot,
  view,
  busy = false,
  error,
  loading = false,
  onRetry,
  onTakeControl,
  onContinueTakeover,
  previewOnly,
  projectionState,
  projectionError,
  frameUrl,
  screenRetrying,
  onProjectionRetry,
  onRetryScreen,
  onExpandPreview,
}: ComputerPanelContentProps): JSX.Element {
  const canTakeControl = !previewOnly && view.takeover === "available";
  const projectionUnavailable = projectionState === "unavailable";
  const projectionWaiting =
    screenRetrying || (view.state !== "unavailable" && frameUrl === undefined && !projectionUnavailable);

  return (
    <VStack gap={4} padding={4} aria-busy={loading || busy || projectionWaiting || undefined} data-testid="computer-drawer">
      {!loading && view.state !== "unavailable" && view.state !== "ready" ? (
        <Text color="secondary">{STATE_LABELS[view.state]}</Text>
      ) : null}
      {error !== undefined ? <Banner status="error" title={error} /> : null}
      {loading ? (
        <EmptyState
          icon={<Icon icon="clock" size="lg" />}
          title="Opening screen"
          description={`Connecting to ${bot.name}’s screen.`}
          isCompact
        />
      ) : view.state === "unavailable" ? (
        <EmptyState
          icon={<Icon icon={screenRetrying ? "clock" : "warning"} size="lg" />}
          title={screenRetrying ? "Opening screen" : "Screen unavailable"}
          description={
            screenRetrying
              ? `Starting ${bot.name}’s screen.`
              : view.unavailableReason === "capacity"
                ? view.activity ?? "Bot Screen capacity is full."
                : `Couldn’t start ${bot.name}’s screen.`
          }
          {...(!screenRetrying && onRetry !== undefined
            ? { actions: <Button label="Retry" variant="secondary" onClick={onRetry} /> }
            : !screenRetrying && view.unavailableReason !== "capacity"
              ? { actions: <Button label="Retry" variant="secondary" onClick={onRetryScreen} /> }
              : {})}
          isCompact
        />
      ) : (
        <>
          <AspectRatio ratio={16 / 9} fit="contain" xstyle={localStyles.preview}>
            {frameUrl === undefined ? null : (
              <img
                src={frameUrl}
                alt={`${bot.name} screen`}
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
                  title={projectionUnavailable ? "Screen didn’t load" : "Opening screen"}
                  description={
                    projectionUnavailable
                      ? projectionError ?? "Couldn’t connect to the Bot Screen."
                      : `Connecting to ${bot.name}’s screen.`
                  }
                  {...(projectionUnavailable
                    ? { actions: <Button label="Retry" variant="secondary" onClick={onProjectionRetry} /> }
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
        {!previewOnly && view.takeover === "active" && !loading ? (
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

/** Right-side computer panel at every window width. */
export function ComputerPanel({
  open,
  onClose,
  returnFocusRef,
  projectionUrl,
  bot,
  view,
  onTakeControl,
  onReturnToBot,
  ...contentProps
}: ComputerPanelProps): JSX.Element | null {
  const { isMobile: isSmallScreen } = useAppShellMobile();
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [projectionState, setProjectionState] = useState<ScreenProjectionState>("closed");
  const [projectionError, setProjectionError] = useState<string>();
  const [frameUrl, setFrameUrl] = useState<string>();
  const [projectionAttempt, setProjectionAttempt] = useState(0);
  const [screenRetrying, setScreenRetrying] = useState(false);
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
  const clearBrowserHeldInput = useCallback((): void => {
    for (const pointerId of pressedPointersRef.current.keys()) {
      if (expandedRef.current?.hasPointerCapture(pointerId)) {
        expandedRef.current.releasePointerCapture(pointerId);
      }
    }
    pressedPointersRef.current.clear();
    browserPasteKeysRef.current.clear();
  }, []);
  const closePanel = useCallback((): void => {
    setPreviewExpanded(false);
    setScreenRetrying(false);
    onClose();
    setProjectionError(undefined);
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, [onClose, returnFocusRef]);

  useEffect(() => {
    if (!open || (view.state === "unavailable" && (!screenRetrying || view.unavailableReason === "capacity"))) {
      connectionRef.current?.close();
      connectionRef.current = undefined;
      replaceFrame(undefined);
      setProjectionState("closed");
      return;
    }
    setProjectionError(undefined);
    const connection = new ScreenProjectionConnection(
      projectionUrl,
      { botId: bot.id, surfaceId: view.surfaceId },
      {
        onState: (state) => {
          setProjectionState(state);
          if (state === "unavailable") setScreenRetrying(false);
        },
        onError: setProjectionError,
        onFrame: replaceFrame,
        onControlRevoked: clearBrowserHeldInput,
      },
    );
    connectionRef.current = connection;
    connection.setMode(previewExpanded && !isSmallScreen ? "expanded" : "preview");
    void connection.connect();
    return () => {
      if (connectionRef.current === connection) connectionRef.current = undefined;
      connection.close();
      replaceFrame(undefined);
    };
  }, [
    bot.id,
    clearBrowserHeldInput,
    open,
    projectionAttempt,
    projectionUrl,
    screenRetrying,
    replaceFrame,
    view.state === "unavailable",
    view.unavailableReason,
    view.surfaceId,
  ]);

  useEffect(() => {
    if (view.state !== "unavailable" || view.unavailableReason === "capacity") {
      setScreenRetrying(false);
    }
  }, [view.state, view.unavailableReason]);

  useEffect(() => {
    if (isSmallScreen && previewExpanded) setPreviewExpanded(false);
    if (!previewExpanded || isSmallScreen) clearBrowserHeldInput();
    connectionRef.current?.setMode(previewExpanded && !isSmallScreen ? "expanded" : "preview");
  }, [clearBrowserHeldInput, isSmallScreen, previewExpanded]);

  useEffect(() => {
    if (!open || isSmallScreen || !previewExpanded) return;
    const connection = connectionRef.current;
    requestAnimationFrame(() => expandedRef.current?.focus());
    clearBrowserHeldInput();
    const releaseForBlur = (): void => {
      clearBrowserHeldInput();
      connection?.releaseControl("blur");
    };
    const resumeAfterFocus = (): void => connection?.resumeControl();
    const releaseForNavigation = (): void => {
      clearBrowserHeldInput();
      connection?.releaseControl("navigation");
    };
    const handleVisibility = (): void => {
      if (document.visibilityState === "hidden") {
        clearBrowserHeldInput();
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
      clearBrowserHeldInput();
      document.removeEventListener("visibilitychange", handleVisibility);
      connection?.releaseControl("teardown");
    };
  }, [clearBrowserHeldInput, isSmallScreen, open, previewExpanded]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !previewExpanded) closePanel();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closePanel, open, previewExpanded]);

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
    const sent = connectionRef.current?.pointerButton(
      event.clientX,
      event.clientY,
      image,
      event.button,
      "pressed",
    ) ?? false;
    if (!sent) return;
    event.preventDefault();
    pressedPointersRef.current.set(event.pointerId, event.button);
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const releaseExpandedPointer = (event: ReactPointerEvent<HTMLDialogElement>): void => {
    const button = pressedPointersRef.current.get(event.pointerId);
    if (button === undefined) return;
    const image = event.currentTarget.querySelector("img");
    const sent = image !== null && connectionRef.current?.pointerButton(
      event.clientX,
      event.clientY,
      image,
      button,
      "released",
    ) === true;
    pressedPointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (sent) event.preventDefault();
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
    if (isSmallScreen) return;
    void onTakeControl()
      .then((taken) => {
        if (!taken) return;
        setPreviewExpanded(true);
        if (!isSmallScreen) connectionRef.current?.setMode("expanded");
      })
      .catch(() => {});
  }, [isSmallScreen, onTakeControl]);
  const finishTakeover = useCallback((): void => {
    void onReturnToBot()
      .then((returned) => {
        if (returned) setPreviewExpanded(false);
      })
      .catch(() => {});
  }, [onReturnToBot]);
  const retryUnavailableScreen = useCallback((): void => {
    if (view.unavailableReason === "capacity") return;
    setProjectionError(undefined);
    setProjectionState("connecting");
    setScreenRetrying(true);
    setProjectionAttempt((attempt) => attempt + 1);
  }, [view.unavailableReason]);

  const content = (
    <ComputerPanelContent
      {...contentProps}
      bot={bot}
      view={view}
      onTakeControl={beginTakeover}
      onContinueTakeover={() => setPreviewExpanded(true)}
      previewOnly={isSmallScreen}
      projectionState={projectionState}
      {...(projectionError === undefined ? {} : { projectionError })}
      {...(frameUrl === undefined ? {} : { frameUrl })}
      screenRetrying={
        screenRetrying
        && view.state === "unavailable"
        && view.unavailableReason !== "capacity"
      }
      onProjectionRetry={() => {
        setProjectionError(undefined);
        setProjectionState("connecting");
        setProjectionAttempt((attempt) => attempt + 1);
      }}
      onRetryScreen={retryUnavailableScreen}
      {...(!isSmallScreen && frameUrl !== undefined
        ? {
            onExpandPreview:
              view.takeover === "available"
                ? beginTakeover
                : () => setPreviewExpanded(true),
          }
        : {})}
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
              <Text>{bot.name}’s screen</Text>
              <Button
                label="I'm done"
                variant="primary"
                isLoading={contentProps.busy}
                onClick={finishTakeover}
                data-testid="computer-im-done"
              />
            </HStack>
          ) : (
            `${bot.name}’s screen`
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

  if (!open) return null;

  return (
    <>
      <LayoutPanel
        width="min(560px, 100vw)"
        padding={0}
        hasDivider
        isScrollable
        label="Computer Surface"
        role="complementary"
        style={{ width: "min(560px, 100vw)", minWidth: 0, maxWidth: "100vw" }}
      >
        <HStack gap={2} padding={4} vAlign="center">
          <StackItem size="fill">
            <Heading level={2}>{bot.name}’s screen</Heading>
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
