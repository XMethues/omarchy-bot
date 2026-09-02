import type { JSX } from "react";
import { Button } from "@astryxdesign/core/Button";
import { Heading } from "@astryxdesign/core/Heading";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Monitor, MoreHorizontal } from "lucide-react";
import type { BotViewDto, ThreadDto } from "@omarchy-bot/protocol";
import { AvatarView } from "./AvatarView.tsx";
import styles from "../lib/styles.ts";

interface ConversationHeaderProps {
  bot?: BotViewDto;
  thread?: ThreadDto;
  onOpenHistory: () => void;
  onOpenProfile: () => void;
}

/**
 * Conversation-local header (workspace-redesign §2): bot name, thread title,
 * quiet computer icon, bot menu. There is no global TopNav anywhere.
 */
export function ConversationHeader({ bot, thread, onOpenHistory, onOpenProfile }: ConversationHeaderProps): JSX.Element {
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
      {/* Computer sheet lands with T10; the icon is present and quiet until then. */}
      <IconButton label="Computer (coming soon)" icon={<Monitor size={18} />} variant="ghost" isDisabled data-testid="header-computer" />
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
