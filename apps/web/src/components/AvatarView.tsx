import { createAvatar } from "@dicebear/core";
import * as micah from "@dicebear/micah";
import * as pixelArt from "@dicebear/pixel-art";
import * as shapes from "@dicebear/shapes";
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

function probability(recipe: AvatarRecipeDto, key: string): number | undefined {
  const value = recipe.options[key];
  return typeof value === "number" ? value : undefined;
}

function recipeDataUri(recipe: AvatarRecipeDto): string {
  if (recipe.rendererVersion !== "9.4.3") return createAvatar(shapes, { seed: recipe.seed }).toDataUri();

  switch (recipe.style) {
    case "micah": {
      const earringsProbability = probability(recipe, "earringsProbability");
      const facialHairProbability = probability(recipe, "facialHairProbability");
      const glassesProbability = probability(recipe, "glassesProbability");
      const hairProbability = probability(recipe, "hairProbability");
      return createAvatar(micah, {
        seed: recipe.seed,
        ...(earringsProbability !== undefined ? { earringsProbability } : {}),
        ...(facialHairProbability !== undefined ? { facialHairProbability } : {}),
        ...(glassesProbability !== undefined ? { glassesProbability } : {}),
        ...(hairProbability !== undefined ? { hairProbability } : {}),
      }).toDataUri();
    }
    case "pixel-art": {
      const accessoriesProbability = probability(recipe, "accessoriesProbability");
      const beardProbability = probability(recipe, "beardProbability");
      const glassesProbability = probability(recipe, "glassesProbability");
      const hatProbability = probability(recipe, "hatProbability");
      return createAvatar(pixelArt, {
        seed: recipe.seed,
        ...(accessoriesProbability !== undefined ? { accessoriesProbability } : {}),
        ...(beardProbability !== undefined ? { beardProbability } : {}),
        ...(glassesProbability !== undefined ? { glassesProbability } : {}),
        ...(hatProbability !== undefined ? { hatProbability } : {}),
      }).toDataUri();
    }
    case "shapes":
    default:
      return createAvatar(shapes, { seed: recipe.seed }).toDataUri();
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
  const src = avatar.kind === "upload" ? uploadedUrl : recipeDataUri(avatar.recipe);
  const motionStyle =
    avatar.kind !== "generated"
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
