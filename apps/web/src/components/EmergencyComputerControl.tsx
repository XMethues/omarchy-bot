import type { JSX } from "react";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
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
    width: "100%",
    alignItems: "flex-start",
  },
});

/** Selected-Bot fail-safe kept clear of the conversation composer and sheet actions. */
export function EmergencyComputerControl({
  view,
  busy = false,
  onEmergencyStop,
  onResume,
}: EmergencyComputerControlProps): JSX.Element | null {
  const stopped = view.state === "emergency-stopped";
  const canControl =
    view.state === "bot-using"
    || view.state === "waiting"
    || view.state === "needs-you"
    || view.state === "user-control"
    || stopped;
  if (!canControl) return null;
  return (
    <VStack
      as="aside"
      gap={1}
      xstyle={localStyles.root}
      aria-label="Bot Screen safety"
      aria-live="polite"
      data-testid="emergency-computer-control"
    >
      {stopped ? <Text color="secondary">Computer control is stopped</Text> : null}
      <Button
        label={stopped ? "Resume computer control" : "Emergency stop computer"}
        icon={<Icon icon="stop" size="sm" />}
        variant={stopped ? "secondary" : "destructive"}
        size="sm"
        isLoading={busy}
        onClick={stopped ? onResume : onEmergencyStop}
        data-testid={stopped ? "computer-resume" : "computer-emergency-stop"}
      />
    </VStack>
  );
}
