import { createRequire } from "node:module";

let cached: string | undefined;

/** Version of the installed @earendil-works/pi-coding-agent SDK, or "unknown". */
export function sdkVersion(): string {
  cached ??= (() => {
    try {
      const req = createRequire(import.meta.url);
      const pkg = req("@earendil-works/pi-coding-agent/package.json") as { version?: string };
      return typeof pkg.version === "string" ? pkg.version : "unknown";
    } catch {
      return "unknown";
    }
  })();
  return cached;
}
