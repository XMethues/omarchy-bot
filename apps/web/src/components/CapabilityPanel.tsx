import { useCallback, type JSX, type RefObject } from "react";
import { Heading } from "@astryxdesign/core/Heading";
import { useAppShellMobile } from "@astryxdesign/core/AppShell";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { LayoutPanel } from "@astryxdesign/core/Layout";
import { StackItem } from "@astryxdesign/core/Stack";
import { VStack } from "@astryxdesign/core/VStack";
import type { ComputerSurfaceProps } from "./ComputerPanel.tsx";
import { ComputerSurface } from "./ComputerPanel.tsx";

export interface CapabilityPanelProps extends Omit<ComputerSurfaceProps, "onRequestClose"> {
  open: boolean;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
}

/** The workspace's sole right-side Computer Surface region. */
export function CapabilityPanel({
  open,
  returnFocusRef,
  onClose,
  bot,
  ...surfaceProps
}: CapabilityPanelProps): JSX.Element {
  const { isMobile } = useAppShellMobile();
  const closePanel = useCallback((): void => {
    onClose();
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, [onClose, returnFocusRef]);

  return (
    <VStack
      gap={0}
      height="100%"
      className="capability-presence"
      data-open={open}
      data-mobile={isMobile}
      data-testid="capability-presence"
      inert={!open}
      aria-hidden={!open}
    >
    <LayoutPanel
      width="min(560px, 100vw)"
      padding={0}
      hasDivider
      isScrollable
      label="Workspace capabilities"
      role="complementary"
      className="capability-panel"
      style={{ width: "min(560px, 100vw)", minWidth: 0, maxWidth: "100vw", height: "100%", animation: "none" }}
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
      {open ? (
      <section className="capability-panel-content">
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
    </VStack>
  );
}
