import { createAvatar } from "@dicebear/core";
import * as shapes from "@dicebear/shapes";
import type { JSX } from "react";
import type { AvatarDto } from "@omarchy-bot/protocol";
import { Avatar } from "@astryxdesign/core/Avatar";

interface AvatarViewProps {
  avatar: AvatarDto;
  name: string;
  size?: "xsm" | "sm" | "md" | "lg" | number;
}

/**
 * Bot avatar rendering. Uploaded images load from the daemon; generated and
 * recipe avatars are rendered locally by DiceBear — agent-authored recipes are
 * validated by the daemon, and agent-produced SVG/HTML/URLs are never rendered.
 */
export function AvatarView({ avatar, name, size = "md" }: AvatarViewProps): JSX.Element {
  if (avatar.kind === "upload") {
    return <Avatar name={name} src={avatar.url} size={size} />;
  }
  const dataUri = createAvatar(shapes, {
    seed: avatar.recipe.seed,
    ...avatar.recipe.options,
  }).toDataUri();
  return <Avatar name={name} src={dataUri} size={size} />;
}
