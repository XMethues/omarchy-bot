import type { JSX } from "react";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@astryxdesign/core/Button";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import type { ComputerViewDto } from "@omarchy-bot/protocol";

export interface EmergencyComputerControlProps {
  view: ComputerViewDto;
  busy?: boolean;
  onEmergencyStop: () => void;
  onResume: () => void;
}

const localStyles = stylex.create({
  root: {
    position: "fixed",
    insetInlineEnd: "var(--spacing-4)",
    insetBlockEnd: "var(--spacing-4)",
    zIndex: 20,
    alignItems: "flex-end",
  },
});

/** Global fail-safe. Mount as an AppShell sibling, never inside conversation actions or the Computer Sheet. */
export function EmergencyComputerControl({
  view,
  busy = false,
  onEmergencyStop,
  onResume,
}: EmergencyComputerControlProps): JSX.Element {
  const stopped = view.state === "emergency-stopped";
  return (
    <VStack
      as="aside"
      gap={1}
      xstyle={localStyles.root}
      aria-label="Global computer safety"
      aria-live="polite"
      data-testid="emergency-computer-control"
    >
      {stopped ? <Text color="secondary">Computer control is stopped</Text> : null}
      <Button
        label={stopped ? "Resume computer control" : "Emergency stop computer"}
        variant={stopped ? "secondary" : "destructive"}
        size="sm"
        isDisabled={busy}
        onClick={stopped ? onResume : onEmergencyStop}
        data-testid={stopped ? "computer-resume" : "computer-emergency-stop"}
      />
    </VStack>
  );
}
