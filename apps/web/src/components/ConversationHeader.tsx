import type { JSX } from "react";
import { Heading } from "@astryxdesign/core/Heading";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Text } from "@astryxdesign/core/Text";
import { Monitor, MoreHorizontal } from "lucide-react";
import type { BotViewDto, ThreadDto } from "@omarchy-bot/protocol";
import { AvatarView } from "./AvatarView.tsx";
import styles from "../lib/styles.ts";

interface ConversationHeaderProps {
  bot?: BotViewDto;
  thread?: ThreadDto;
}

/**
 * Conversation-local header (workspace-redesign §2): bot name, thread title,
 * quiet computer icon, bot menu. There is no global TopNav anywhere.
 */
export function ConversationHeader({ bot, thread }: ConversationHeaderProps): JSX.Element {
  return (
    <header xstyle={styles.header} data-testid="conversation-header">
      {bot !== undefined ? <AvatarView avatar={bot.avatar} name={bot.name} size="sm" /> : null}
      <div xstyle={styles.headerGrow} style={{ minWidth: 0 }}>
        <Heading level={2} xstyle={styles.headerTitle}>
          {bot?.name ?? "omarchy-bot"}
        </Heading>
        {thread !== undefined ? (
          <Text type="label-sm" color="secondary" xstyle={styles.headerTitle} data-testid="thread-title">
            {thread.title}
          </Text>
        ) : null}
      </div>
      {/* Computer sheet lands with T10; the icon is present and quiet until then. */}
      <IconButton label="Computer (coming soon)" icon={<Monitor size={18} />} variant="ghost" isDisabled data-testid="header-computer" />
      {/* Bot profile menu lands with T03; the affordance is named and inert until then. */}
      <IconButton label="Bot menu (coming soon)" icon={<MoreHorizontal size={18} />} variant="ghost" isDisabled data-testid="header-bot-menu" />
    </header>
  );
}
