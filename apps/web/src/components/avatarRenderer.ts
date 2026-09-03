import { Avatar as CurrentAvatar, Style as CurrentStyle } from "@dicebear/core";
import { AVATAR_RENDERER_ID, type AvatarRecipeDto } from "@omarchy-bot/protocol";
import currentPixelbotDefinition from "@dicebear/styles/pixelbot.json";
import currentShapesDefinition from "@dicebear/styles/shapes.json";
import currentThumbsDefinition from "@dicebear/styles/thumbs.json";

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

function renderCurrent(recipe: AvatarRecipeDto, activity: AvatarActivity): string {
  const style = currentStyles[recipe.style];
  const variant = animationVariant(activity);
  const options = variant === undefined
    ? { ...(recipe.options as object), seed: recipe.seed }
    : { ...(recipe.options as object), seed: recipe.seed, animationVariant: variant };
  return new CurrentAvatar(style, options).toDataUri();
}

/** Render a validated recipe with the application's sole pinned renderer. */
export function renderAvatarRecipe(recipe: AvatarRecipeDto, activity: AvatarActivity): string {
  const key = cacheKey(recipe, activity);
  const cached = svgCache.get(key);
  if (cached !== undefined) {
    svgCache.delete(key);
    svgCache.set(key, cached);
    return cached;
  }

  return remember(key, renderCurrent(recipe, activity));
}
