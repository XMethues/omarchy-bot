import * as stylex from "@stylexjs/stylex";
import type { JSX } from "react";
import type { AvatarDto } from "@omarchy-bot/protocol";
import { Avatar, AvatarStatusDot } from "@astryxdesign/core/Avatar";
import { HStack } from "@astryxdesign/core/HStack";
import { renderAvatarRecipe, type AvatarActivity } from "./avatarRenderer.ts";

export type { AvatarActivity } from "./avatarRenderer.ts";

interface AvatarViewBaseProps {
  avatar: AvatarDto;
  name: string;
  size?: "xsm" | "sm" | "md" | "lg" | number;
  activity?: AvatarActivity;
}

export type AvatarViewProps =
  | (AvatarViewBaseProps & { decorative: true; label?: never })
  | (AvatarViewBaseProps & { decorative?: false; label?: string });

const breathe = stylex.keyframes({
  "0%, 100%": { transform: "scale(1)" },
  "50%": { transform: "scale(1.045)" },
});

const styles = stylex.create({
  selected: {
    animationName: { default: breathe, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "calc(var(--duration-slow-max) * 1.8)",
    animationTimingFunction: "var(--ease-standard)",
    animationIterationCount: "infinite",
  },
  working: {
    animationName: { default: breathe, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "var(--duration-slow-max)",
    animationTimingFunction: "var(--ease-standard)",
    animationIterationCount: "infinite",
  },
  streaming: {
    animationName: { default: breathe, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "var(--duration-slow-min)",
    animationTimingFunction: "var(--ease-standard)",
    animationIterationCount: "infinite",
  },
});

/**
 * Safe Bot avatar rendering. Recipe data is rendered by pinned local DiceBear
 * styles only; uploaded images must use the daemon's same-origin avatar route.
 */
export function AvatarView({
  avatar,
  name,
  size = "md",
  activity = "idle",
  decorative = false,
  label,
}: AvatarViewProps): JSX.Element {
  const active = activity !== "idle";
  const status = active ? (
    <AvatarStatusDot
      variant={activity === "selected" ? "neutral" : "success"}
      label={activity === "selected" ? "Selected" : activity === "streaming" ? "Streaming" : "Working"}
    />
  ) : undefined;
  const uploadedUrl = avatar.kind === "upload" && /^\/api\/bots\/[\w-]+\/avatar$/.test(avatar.url) ? avatar.url : undefined;
  const src = avatar.kind === "upload" ? uploadedUrl : renderAvatarRecipe(avatar.recipe, activity);
  const motionStyle =
    avatar.kind !== "upload"
      ? undefined
      : activity === "streaming"
        ? styles.streaming
        : activity === "working"
          ? styles.working
          : activity === "selected"
            ? styles.selected
            : undefined;

  return (
    <HStack
      as="span"
      {...(motionStyle !== undefined ? { xstyle: motionStyle } : {})}
      data-avatar-activity={activity}
      data-testid="avatar-view"
    >
      <Avatar
        name={name}
        {...(decorative
          ? { "aria-hidden": "true" as const, "aria-label": "", role: "presentation" as const, tooltip: false as const }
          : {})}
        {...(!decorative && label !== undefined ? { alt: label } : {})}
        {...(src !== undefined ? { src } : {})}
        size={size}
        {...(status !== undefined ? { status } : {})}
        data-testid={avatar.kind === "upload" ? "avatar-upload" : `avatar-${avatar.recipe.style}`}
      />
    </HStack>
  );
}
