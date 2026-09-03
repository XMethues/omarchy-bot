import { createAvatar } from "@dicebear/core";
import * as micahStyle from "@dicebear/micah";
import * as pixelArtStyle from "@dicebear/pixel-art";
import * as shapesStyle from "@dicebear/shapes";

type LegacyAvatarOption = string | number | boolean | Array<string | number | boolean>;

export interface LegacyAvatarRecipe {
  style: string;
  seed: string;
  options: Record<string, LegacyAvatarOption>;
}

/** Render an exact DiceBear 9.4.3 recipe without involving the current renderer stack. */
export function renderLegacyAvatar(recipe: LegacyAvatarRecipe): string | undefined {
  const options = { ...(recipe.options as object), seed: recipe.seed };
  switch (recipe.style) {
    case "micah":
      return createAvatar(micahStyle, options).toDataUri();
    case "pixel-art":
      return createAvatar(pixelArtStyle, options).toDataUri();
    case "shapes":
      return createAvatar(shapesStyle, options).toDataUri();
    default:
      return undefined;
  }
}
