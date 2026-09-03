import { Avatar as DiceBearAvatar, Style } from "@dicebear/core";
import pixelbotDefinition from "@dicebear/styles/pixelbot.json";
import shapesDefinition from "@dicebear/styles/shapes.json";
import thumbsDefinition from "@dicebear/styles/thumbs.json";
import * as stylex from "@stylexjs/stylex";
import type { JSX } from "react";
import type { AvatarDto, AvatarRecipeDto } from "@omarchy-bot/protocol";
import { Avatar, AvatarStatusDot } from "@astryxdesign/core/Avatar";
import { HStack } from "@astryxdesign/core/HStack";

export type AvatarActivity = "idle" | "selected" | "working" | "streaming";

interface AvatarViewProps {
  avatar: AvatarDto;
  name: string;
  size?: "xsm" | "sm" | "md" | "lg" | number;
  activity?: AvatarActivity;
}

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

const pixelbotStyle = new Style(pixelbotDefinition);
const shapesStyle = new Style(shapesDefinition);
const thumbsStyle = new Style(thumbsDefinition);

type AnimationVariant = "slowest" | "medium" | "fast";

function animationVariant(activity: AvatarActivity): AnimationVariant | undefined {
  switch (activity) {
    case "selected":
      return "slowest";
    case "working":
      return "medium";
    case "streaming":
      return "fast";
    case "idle":
      return undefined;
  }
}

function recipeDataUri(recipe: AvatarRecipeDto, activity: AvatarActivity): string {
  const variant = animationVariant(activity);
  const options = variant === undefined
    ? { seed: recipe.seed }
    : { seed: recipe.seed, animationVariant: variant };

  switch (recipe.style) {
    case "pixelbot":
      return new DiceBearAvatar(pixelbotStyle, options).toDataUri();
    case "thumbs":
      return new DiceBearAvatar(thumbsStyle, options).toDataUri();
    case "shapes":
    default:
      return new DiceBearAvatar(shapesStyle, options).toDataUri();
  }
}

/**
 * Safe Bot avatar rendering. Recipe data is rendered by pinned local DiceBear
 * styles only; uploaded images must use the daemon's same-origin avatar route.
 */
export function AvatarView({ avatar, name, size = "md", activity = "idle" }: AvatarViewProps): JSX.Element {
  const active = activity !== "idle";
  const status = active ? (
    <AvatarStatusDot
      variant={activity === "selected" ? "neutral" : "success"}
      label={activity === "selected" ? "Selected" : activity === "streaming" ? "Streaming" : "Working"}
    />
  ) : undefined;
  const uploadedUrl = avatar.kind === "upload" && /^\/api\/bots\/[\w-]+\/avatar$/.test(avatar.url) ? avatar.url : undefined;
  const src = avatar.kind === "upload" ? uploadedUrl : recipeDataUri(avatar.recipe, activity);
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
        {...(src !== undefined ? { src } : {})}
        size={size}
        {...(status !== undefined ? { status } : {})}
        data-testid={avatar.kind === "upload" ? "avatar-upload" : `avatar-${avatar.recipe.style}`}
      />
    </HStack>
  );
}
