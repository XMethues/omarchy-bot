import { Avatar as CurrentAvatar, Style as CurrentStyle } from "@dicebear/core-v10";
import { renderLegacyAvatar } from "@omarchy-bot/avatar-renderer-v9";
import currentPixelbotDefinition from "@dicebear/styles/pixelbot.json";
import currentShapesDefinition from "@dicebear/styles/shapes.json";
import currentThumbsDefinition from "@dicebear/styles/thumbs.json";
import type { AvatarRecipeDto } from "@omarchy-bot/protocol";

export const CURRENT_AVATAR_RENDERER = "dicebear-core@10.7.0+styles@10.6.0";
export const LEGACY_AVATAR_RENDERER = "9.4.3";

export type AvatarActivity = "idle" | "selected" | "working" | "streaming";

type AnimationVariant = "slowest" | "medium" | "fast";

const currentStyles = {
  pixelbot: new CurrentStyle(currentPixelbotDefinition),
  shapes: new CurrentStyle(currentShapesDefinition),
  thumbs: new CurrentStyle(currentThumbsDefinition),
} as const;

const MAX_CACHE_ENTRIES = 256;
const svgCache = new Map<string, string>();

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

function cacheKey(recipe: AvatarRecipeDto, activity: AvatarActivity): string {
  return JSON.stringify([
    recipe.rendererVersion,
    recipe.style,
    recipe.seed,
    Object.entries(recipe.options).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
    activity,
  ]);
}

function remember(key: string, dataUri: string): string {
  svgCache.set(key, dataUri);
  if (svgCache.size > MAX_CACHE_ENTRIES) {
    const oldest = svgCache.keys().next().value;
    if (oldest !== undefined) svgCache.delete(oldest);
  }
  return dataUri;
}

function renderCurrent(recipe: AvatarRecipeDto, activity: AvatarActivity): string | undefined {
  const style = currentStyles[recipe.style as keyof typeof currentStyles];
  if (style === undefined) return undefined;

  const variant = animationVariant(activity);
  const options = variant === undefined
    ? { ...(recipe.options as object), seed: recipe.seed }
    : { ...(recipe.options as object), seed: recipe.seed, animationVariant: variant };
  return new CurrentAvatar(style, options).toDataUri();
}

/** Render only recipes whose exact pinned renderer is available locally. */
export function renderAvatarRecipe(recipe: AvatarRecipeDto, activity: AvatarActivity): string | undefined {
  const key = cacheKey(recipe, activity);
  const cached = svgCache.get(key);
  if (cached !== undefined) {
    svgCache.delete(key);
    svgCache.set(key, cached);
    return cached;
  }

  const dataUri = recipe.rendererVersion === CURRENT_AVATAR_RENDERER
    ? renderCurrent(recipe, activity)
    : recipe.rendererVersion === LEGACY_AVATAR_RENDERER
      ? renderLegacyAvatar(recipe)
      : undefined;
  return dataUri === undefined ? undefined : remember(key, dataUri);
}
