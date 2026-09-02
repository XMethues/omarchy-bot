import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading } from "@astryxdesign/core/Heading";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";
import { useState } from "react";
import styles from "../lib/styles.ts";
import { api } from "../lib/api.ts";
import type { BotDto, ComputerStateDto, ThreadDto } from "@omarchy-bot/protocol";

function holderLabel(lease: ComputerStateDto["lease"], bots: BotDto[]): string {
  if (lease === null) return "free";
  const actor = lease.holder !== "human" ? lease.holder : undefined;
  if (!actor) return "you";
  const bot = bots.find((b) => b.id === actor.botId);
  return `${bot?.displayName ?? actor.botId} (${actor.roleId})`;
}

function expiresIn(lease: ComputerStateDto["lease"]): string {
  if (lease === null) return "";
  const ms = new Date(lease.expiresAt).getTime() - Date.now();
  if (ms <= 0) return "expired";
  const mins = Math.floor(ms / 60_000);
  const secs = Math.floor((ms % 60_000) / 1000);
  return mins > 0 ? `${mins}m ${secs}s left` : `${secs}s left`;
}

export function ComputerPanel({
  state,
  bots,
  threads,
  onSnapshotRequired,
}: {
  state: ComputerStateDto;
  bots: BotDto[];
  threads: ThreadDto[];
  onSnapshotRequired: () => void;
}) {
  const [tick, setTick] = useState(0);
  const holder = holderLabel(state.lease, bots);
  const lease = state.lease;
  const holderBotId = lease !== null && lease.holder !== "human" ? lease.holder.botId : undefined;
  const holderBotThread = holderBotId ? threads.find((t) => t.botId === holderBotId) : undefined;
  const isHuman = state.lease !== null && state.lease.holder === "human";

  const src = `${api.computerImageUrl()}?t=${encodeURIComponent(state.lastImageAt ?? String(tick))}`;

  return (
    <VStack gap={2} padding={2}>
      <HStack gap={2}>
        <Heading level={2}>Computer</Heading>
        <Text type="supporting" size="2xs">
          holder: {holder}
          {state.lease !== null ? ` · ${expiresIn(state.lease)}` : ""}
          {state.queueDepth > 0 ? ` · queue: ${state.queueDepth}` : ""}
        </Text>
      </HStack>

      {state.emergencyStopped && (
        <Banner
          status="error"
          title="Emergency stop active"
          description="All bot computer actions are blocked until released."
          container="card"
          collapsible={false}
          endContent={<Button label="Resume actions" variant="primary" size="sm" onClick={() => void api.resume()} />}
        />
      )}

      {holderBotThread && (
        <Text type="supporting" size="2xs" as="p">
          In use by a bot working on “{holderBotThread.title}”. Take over to interrupt.
        </Text>
      )}

      <HStack gap={2}>
        <Button
          label="Take over"
          variant="primary"
          size="sm"
          isDisabled={state.emergencyStopped || isHuman}
          onClick={async () => {
            await api.takeOver();
            onSnapshotRequired();
          }}
        />
        <Button
          label="I'm done"
          variant="secondary"
          size="sm"
          isDisabled={!isHuman}
          onClick={async () => {
            await api.release();
            onSnapshotRequired();
          }}
        />
        <Button label="Refresh" variant="ghost" size="sm" onClick={() => setTick((t) => t + 1)} />
        <Button
          label="Emergency stop"
          variant="destructive"
          size="sm"
          onClick={() => void api.emergencyStop()}
        />
      </HStack>

      <Divider />

      {state.lastImageAt !== undefined || tick > 0 ? (
        <Card padding={0}>
          <img
            src={src}
            alt="Desktop snapshot"
            xstyle={styles.snapshot}
          />
        </Card>
      ) : (
        <Card padding={3}>
          <Text type="supporting">
            No snapshot yet. Snapshots appear when a bot observes the desktop or you take over.
          </Text>
        </Card>
      )}
    </VStack>
  );
}
