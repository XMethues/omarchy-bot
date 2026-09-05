import { useCallback, useEffect, useState, type JSX, type RefObject } from "react";
import { Heading } from "@astryxdesign/core/Heading";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { LayoutPanel } from "@astryxdesign/core/Layout";
import { StackItem } from "@astryxdesign/core/Stack";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import type { ComputerSurfaceProps } from "./ComputerPanel.tsx";
import { ComputerSurface } from "./ComputerPanel.tsx";
import { ChangesPanel } from "./ChangesPanel.tsx";

export type WorkspaceCapability = "changes" | "browser";

export interface CapabilityPanelProps extends Omit<ComputerSurfaceProps, "onRequestClose"> {
  activeCapability: WorkspaceCapability;
  threadId?: string;
  onCapabilityChange: (capability: WorkspaceCapability) => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

/** The workspace's sole right-side capability region. */
export function CapabilityPanel({
  activeCapability,
  onCapabilityChange,
  threadId,
  returnFocusRef,
  onClose,
  bot,
  ...surfaceProps
}: CapabilityPanelProps): JSX.Element {
  const closePanel = useCallback((): void => {
    onClose();
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, [onClose, returnFocusRef]);
  const contextKey = `${bot.id}\0${threadId ?? ""}`;
  const [changesSelection, setChangesSelection] = useState<{ contextKey: string; path: string }>();
  const selectedChangesPath =
    changesSelection?.contextKey === contextKey ? changesSelection.path : undefined;

  useEffect(() => {
    if (changesSelection !== undefined && changesSelection.contextKey !== contextKey) {
      setChangesSelection(undefined);
    }
  }, [changesSelection, contextKey]);


  return (
    <LayoutPanel
      width="min(560px, 100vw)"
      padding={0}
      hasDivider
      isScrollable
      label="Workspace capabilities"
      role="complementary"
      style={{ width: "min(560px, 100vw)", minWidth: 0, maxWidth: "100vw" }}
      data-testid="workspace-capabilities"
    >
      <HStack gap={2} padding={4} vAlign="center">
        <StackItem size="fill">
          <Heading level={2}>Capabilities</Heading>
        </StackItem>
        <IconButton
          label="Close capabilities"
          tooltip="Close capabilities"
          icon={<Icon icon="close" size="md" />}
          variant="ghost"
          onClick={closePanel}
          data-testid="capabilities-close"
        />
      </HStack>
      <TabList
        value={activeCapability}
        onChange={(value) => onCapabilityChange(value as WorkspaceCapability)}
        role="tablist"
        aria-label="Workspace capabilities"
        hasDivider
        style={{ paddingInline: "var(--spacing-4)" }}
      >
        <Tab value="changes" label="Changes" panelId="workspace-capability-changes" />
        <Tab value="browser" label="Browser" panelId="workspace-capability-browser" />
      </TabList>
      {activeCapability === "changes" ? (
        <section
          id="workspace-capability-changes"
          role="tabpanel"
          aria-label="Changes"
        >
          <ChangesPanel
            botId={bot.id}
            {...(threadId === undefined ? {} : { threadId })}
            {...(selectedChangesPath === undefined ? {} : { selectedPath: selectedChangesPath })}
            onSelectedPathChange={(path) =>
              setChangesSelection(path === undefined ? undefined : { contextKey, path })
            }
          />
        </section>
      ) : null}
      {activeCapability === "browser" ? (
      <section
        id="workspace-capability-browser"
        role="tabpanel"
        aria-label="Browser"
      >
        <HStack gap={2} padding={4} paddingBlockEnd={0} vAlign="center">
          <Heading level={3}>{bot.name}’s screen</Heading>
        </HStack>
        <ComputerSurface
          {...surfaceProps}
          bot={bot}
          onRequestClose={closePanel}
        />
      </section>
      ) : null}
    </LayoutPanel>
  );
}
