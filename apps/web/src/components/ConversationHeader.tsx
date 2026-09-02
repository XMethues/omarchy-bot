import type { JSX } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Monitor, MoreHorizontal } from "lucide-react";
import type { BotViewDto, ComputerViewDto, ThreadDto } from "@omarchy-bot/protocol";
import { AvatarView } from "./AvatarView.tsx";
import styles from "../lib/styles.ts";

const COMPUTER_LABELS: Record<ComputerViewDto["state"], string> = {
  idle: "Open computer",
  "bot-using": "Open computer, this bot is using it",
  waiting: "Open computer, this bot is waiting",
  "needs-you": "Open computer, this bot needs you",
  "user-control": "Open computer, you have control",
  "emergency-stopped": "Open computer, control is stopped",
  unavailable: "Open computer, unavailable",
};

export interface ConversationHeaderProps {
  bot?: BotViewDto;
  thread?: ThreadDto;
  computerState: ComputerViewDto["state"];
  onOpenHistory: () => void;
  onOpenProfile: () => void;
  onOpenComputer: () => void;
}

/**
 * Conversation-local header (workspace-redesign §2): bot name, thread title,
 * quiet computer icon, bot menu. There is no global TopNav anywhere.
 */
export function ConversationHeader({
  bot,
  thread,
  computerState,
  onOpenHistory,
  onOpenProfile,
  onOpenComputer,
}: ConversationHeaderProps): JSX.Element {
  return (
    <header xstyle={styles.header} data-testid="conversation-header">
      {bot !== undefined ? (
        <AvatarView avatar={bot.avatar} name={bot.name} size="sm" activity={bot.status === "working" ? "working" : "selected"} />
      ) : null}
      <div xstyle={styles.headerGrow} style={{ minWidth: 0 }}>
        <Heading level={2} xstyle={styles.headerTitle}>
          {bot?.name ?? "omarchy-bot"}
        </Heading>
        <Button
          label={thread?.title ?? "New conversation"}
          variant="ghost"
          size="sm"
          onClick={onOpenHistory}
          data-testid="thread-history-trigger"
        />
      </div>
      <IconButton
        label={COMPUTER_LABELS[computerState]}
        icon={<Monitor size={18} />}
        variant={computerState === "idle" || computerState === "unavailable" ? "ghost" : "secondary"}
        onClick={onOpenComputer}
        data-state={computerState}
        data-testid="header-computer"
      />
      <IconButton
        label="Edit bot profile"
        icon={<MoreHorizontal size={18} />}
        variant="ghost"
        onClick={onOpenProfile}
        data-testid="profile-open"
      />
    </header>
  );
}
