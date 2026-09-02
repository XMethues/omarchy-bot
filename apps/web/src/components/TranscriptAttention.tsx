import type { JSX, ReactNode, UIEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@astryxdesign/core/Button";

const LATEST_THRESHOLD_PX = 8;

export interface TranscriptAttentionProps {
  botId?: string;
  threadId?: string;
  unreadCount: number;
  unreadThreadId?: string;
  latestMessageId?: string;
  onRead: (botId: string, threadId: string) => Promise<void>;
  children: ReactNode;
}

function scrollViewport(root: HTMLElement): HTMLElement | undefined {
  const candidates: HTMLElement[] = [root, ...root.querySelectorAll<HTMLElement>("*")];
  let ancestor = root.parentElement;
  while (ancestor !== null) {
    candidates.push(ancestor);
    ancestor = ancestor.parentElement;
  }

  let transcript: HTMLElement | undefined;
  for (const candidate of candidates) {
    if (candidate.dataset.testid === "transcript") transcript = candidate;
    const overflow = getComputedStyle(candidate).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll")
      && candidate.scrollHeight > candidate.clientHeight + LATEST_THRESHOLD_PX
    ) {
      return candidate;
    }
  }
  return candidates.find((candidate) => candidate.scrollHeight > candidate.clientHeight + LATEST_THRESHOLD_PX) ?? transcript;
}

function isAtLatest(viewport: HTMLElement): boolean {
  return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= LATEST_THRESHOLD_PX;
}

/**
 * Owns the read boundary without coupling ChatPanel to sidebar state. It may
 * wrap any transcript whose scrolling viewport is inside the wrapper.
 */
export function TranscriptAttention({
  botId,
  threadId,
  unreadCount,
  unreadThreadId,
  latestMessageId,
  onRead,
  children,
}: TranscriptAttentionProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLElement | undefined>(undefined);
  const atLatestRef = useRef(true);
  const readInFlightRef = useRef<string | undefined>(undefined);
  const [showJump, setShowJump] = useState(false);

  const acknowledgeIfLatest = useCallback(
    (atLatest: boolean): void => {
      atLatestRef.current = atLatest;
      const hasMatchingUnread =
        unreadCount > 0
        && botId !== undefined
        && threadId !== undefined
        && unreadThreadId === threadId
        && latestMessageId !== undefined;
      setShowJump(hasMatchingUnread && !atLatest);
      if (!hasMatchingUnread || !atLatest) return;

      const readKey = `${botId}:${threadId}:${latestMessageId}`;
      if (readInFlightRef.current === readKey) return;
      readInFlightRef.current = readKey;
      void onRead(botId, threadId).catch(() => {
        if (readInFlightRef.current === readKey) readInFlightRef.current = undefined;
      });
    },
    [botId, threadId, unreadCount, unreadThreadId, latestMessageId, onRead],
  );

  const inspectViewport = useCallback(
    (candidate?: HTMLElement): void => {
      const root = rootRef.current;
      if (root === null) return;
      const viewport = candidate ?? scrollViewport(root) ?? viewportRef.current;
      if (viewport === undefined) return;
      viewportRef.current = viewport;
      acknowledgeIfLatest(isAtLatest(viewport));
    },
    [acknowledgeIfLatest],
  );

  const onScrollCapture = useCallback(
    (event: UIEvent<HTMLDivElement>): void => {
      if (!(event.target instanceof HTMLElement)) return;
      viewportRef.current = event.target;
      inspectViewport(event.target);
    },
    [inspectViewport],
  );

  useEffect(() => {
    viewportRef.current = undefined;
    atLatestRef.current = true;
    readInFlightRef.current = undefined;
    setShowJump(false);
  }, [botId, threadId]);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const followLatest = atLatestRef.current;
    const frame = requestAnimationFrame(() => {
      const viewport = viewportRef.current ?? scrollViewport(root);
      if (viewport === undefined) return;
      viewportRef.current = viewport;
      if (followLatest) viewport.scrollTop = viewport.scrollHeight;
      inspectViewport(viewport);
    });
    return () => cancelAnimationFrame(frame);
  }, [latestMessageId, botId, threadId, inspectViewport]);

  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const observer = new ResizeObserver(() => inspectViewport());
    observer.observe(root);
    return () => observer.disconnect();
  }, [inspectViewport]);

  useEffect(() => {
    const onAnyScroll = (): void => inspectViewport();
    window.addEventListener("scroll", onAnyScroll, true);
    return () => window.removeEventListener("scroll", onAnyScroll, true);
  }, [inspectViewport]);

  const jumpToLatest = (): void => {
    const root = rootRef.current;
    if (root === null) return;
    const viewport = viewportRef.current ?? scrollViewport(root);
    if (viewport === undefined) return;
    viewportRef.current = viewport;
    viewport.scrollTop = viewport.scrollHeight;
    inspectViewport(viewport);
  };

  return (
    <div
      ref={rootRef}
      onScrollCapture={onScrollCapture}
      data-testid="transcript-attention"
      style={{ position: "relative", display: "flex", flex: 1, minHeight: 0, overflow: "hidden", flexDirection: "column" }}
    >
      {children}
      {showJump ? (
        <div style={{ position: "absolute", insetInlineEnd: "var(--spacing-4)", bottom: "var(--spacing-4)" }}>
          <Button label={`Jump to latest (${unreadCount})`} variant="secondary" size="sm" onClick={jumpToLatest} data-testid="jump-to-latest" />
        </div>
      ) : null}
    </div>
  );
}
