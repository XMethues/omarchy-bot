import { z } from "zod";
import type { AvatarRecipeDto } from "@omarchy-bot/protocol";

export const AVATAR_RENDERER_VERSION = "dicebear-core@10.7.0+styles@10.6.0";
export const ALLOWED_AVATAR_STYLES = ["shapes", "pixelbot", "thumbs"] as const;
export type AllowedAvatarStyle = (typeof ALLOWED_AVATAR_STYLES)[number];

const styleOptions = {
  shapes: z.object({}).strict(),
  pixelbot: z.object({}).strict(),
  thumbs: z.object({}).strict(),
} as const;

const unsafeText = /(?:<\/?(?:svg|html|script)\b|javascript:|data:|https?:\/\/|<|>)/i;
const seed = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => !unsafeText.test(value), "seed must be plain local recipe data");

const responseSchema = z
  .object({
    style: z.enum(ALLOWED_AVATAR_STYLES),
    seed,
    options: z.record(z.union([z.string(), z.number(), z.boolean()])),
  })
  .strict();

/**
 * System contract for an isolated profile operation. The Agent returns data,
 * never markup or a renderable URL; Omarchy Bot remains the only renderer.
 */
export const AVATAR_RECIPE_SYSTEM_INSTRUCTIONS = `You create deterministic animated DiceBear avatar recipes for Omarchy Bot.
Reply with exactly one JSON object and no prose or markdown: {"style":"shapes|pixelbot|thumbs","seed":"plain text seed","options":{}}.
The three allowed styles are animated by Omarchy Bot; options must be an empty object.
Never return SVG, HTML, script, data URLs, remote URLs, or additional keys.`;

/** Strictly parse and validate untrusted Agent output into a pinned recipe. */
export function parseAvatarRecipeResponse(text: string): AvatarRecipeDto {
  if (text.length > 32 * 1024) throw new Error("recipe response is too large");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("agent did not return a JSON avatar recipe");
  }

  const envelope = responseSchema.safeParse(raw);
  if (!envelope.success) {
    throw new Error(envelope.error.issues[0]?.message ?? "invalid avatar recipe");
  }

  const options = styleOptions[envelope.data.style].safeParse(envelope.data.options);
  if (!options.success) {
    throw new Error(options.error.issues[0]?.message ?? `invalid ${envelope.data.style} options`);
  }

  return {
    rendererVersion: AVATAR_RENDERER_VERSION,
    style: envelope.data.style,
    seed: envelope.data.seed,
    options: options.data,
  };
}
