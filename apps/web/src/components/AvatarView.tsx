import { createAvatar } from "@dicebear/core";
import * as micah from "@dicebear/micah";
import * as pixelArt from "@dicebear/pixel-art";
import * as shapes from "@dicebear/shapes";
import * as stylex from "@stylexjs/stylex";
import type { JSX } from "react";
import type { AvatarDto, AvatarRecipeDto } from "@omarchy-bot/protocol";
import { Avatar, AvatarStatusDot } from "@astryxdesign/core/Avatar";

export type AvatarActivity = "idle" | "selected" | "working" | "streaming";

interface AvatarViewProps {
  avatar: AvatarDto;
  name: string;
  size?: "xsm" | "sm" | "md" | "lg" | number;
  activity?: AvatarActivity;
}

const drift = stylex.keyframes({
  "0%, 100%": { transform: "translateY(0) rotate(0deg)" },
  "50%": { transform: "translateY(-2px) rotate(1.5deg)" },
});
const breathe = stylex.keyframes({
  "0%, 100%": { transform: "scale(1)" },
  "50%": { transform: "scale(1.045)" },
});

const styles = stylex.create({
  shell: {
    display: "inline-flex",
    position: "relative",
    flexShrink: 0,
    borderRadius: "var(--radius-full)",
    transitionProperty: "box-shadow",
    transitionDuration: "var(--duration-fast)",
    "@media (prefers-reduced-motion: reduce)": { transitionDuration: "0s" },
  },
  activeShell: {
    boxShadow: "0 0 0 2px var(--color-background-surface), 0 0 0 4px var(--color-text-accent)",
  },
  generatedSelected: {
    animationName: { default: drift, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "3.6s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  generatedWorking: {
    animationName: { default: breathe, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "1.8s",
    animationTimingFunction: "ease-in-out",
    animationIterationCount: "infinite",
  },
  generatedStreaming: {
    animationName: { default: breathe, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "1.1s",
    animationTimingFunction: "ease-in-out",
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
  const generatedMotion =
    avatar.kind === "upload" || activity === "idle"
      ? undefined
      : activity === "selected"
        ? styles.generatedSelected
        : activity === "streaming"
          ? styles.generatedStreaming
          : styles.generatedWorking;

  return (
    <span {...stylex.props(styles.shell, active && styles.activeShell)} data-avatar-activity={activity} data-testid="avatar-view">
      <span {...stylex.props(generatedMotion)}>
        <Avatar
          name={name}
          {...(src !== undefined ? { src } : {})}
          size={size}
          {...(status !== undefined ? { status } : {})}
          data-testid={avatar.kind === "upload" ? "avatar-upload" : `avatar-${avatar.recipe.style}`}
        />
      </span>
    </span>
  );
}
