import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createReadStream } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface SwayRuntimePackage {
  name: string;
  url: string;
  sha256: string;
}

/**
 * Application-owned compositor pack for private Bot Desktop Sessions.
 *
 * GitHub #6 owns first-enable (`omarchy-bot-runtime-<sha>-x86_64.tar.zst`: web
 * dist, C helpers, node_modules) and keeps compositor downloads lazy. This
 * module is that lazy Sway slot — not a second installer and not a change
 * to #6's plugin-packaging scope.
 *
 * Intentionally omitted from this pack:
 * - `@novnc/novnc` ships with the first-enable web dist
 * - capture/input/bot-desktop helpers are compiled by the #6 plugin tarball
 * - grim remains a host Omarchy app
 */
export const SWAY_RUNTIME_PACKAGES: readonly SwayRuntimePackage[] = Object.freeze([
  {
    name: "sway",
    url: "https://archive.archlinux.org/packages/s/sway/sway-1:1.12-4-x86_64.pkg.tar.zst",
    sha256: "5704cfc9eba9804116c665cb4450352bf5a240c1a8300b36aca3218116648443",
  },
  {
    name: "wayvnc",
    url: "https://archive.archlinux.org/packages/w/wayvnc/wayvnc-0.10.1-1-x86_64.pkg.tar.zst",
    sha256: "ccb8a784add0e33691132fc16f7d94faa5d222fdd08424d077fda1a13aa81b5c",
  },
  {
    name: "neatvnc",
    url: "https://archive.archlinux.org/packages/n/neatvnc/neatvnc-1.0.1-2-x86_64.pkg.tar.zst",
    sha256: "52ddca002e0b2d5e820fc7b19dc27ce4deaff211300de37e028dd8e15ae36646",
  },
  {
    name: "aml",
    url: "https://archive.archlinux.org/packages/a/aml/aml-1.0.0-1-x86_64.pkg.tar.zst",
    sha256: "7665bb28a2ce0a116052957e83b5b18dfc7f0061db11255639fe671249d8ad6e",
  },
  {
    name: "wlroots0.20",
    url: "https://archive.archlinux.org/packages/w/wlroots0.20/wlroots0.20-0.20.2-1-x86_64.pkg.tar.zst",
    sha256: "8b1da3fbf29cc45908d8de771bd22a5813b298a9049462df5b8952f23c3ffb8f",
  },
  {
    name: "libliftoff",
    url: "https://archive.archlinux.org/packages/l/libliftoff/libliftoff-0.5.0-1-x86_64.pkg.tar.zst",
    sha256: "59cf08c21500673a14287b83b89b6db5389134cc24c97d9222c7cddefa639ccf",
  },
  {
    name: "wlr-randr",
    url: "https://archive.archlinux.org/packages/w/wlr-randr/wlr-randr-0.5.0-1-x86_64.pkg.tar.zst",
    sha256: "cbefba7fd65a384eb44b12df6fbd36d871782827f21a4c793bff171a298887c9",
  },
]);

export const SWAY_RUNTIME_RELEASE = "sway-1.12-wayvnc-0.10.1-wlroots-0.20.2-x86_64";
const READY_FILE = ".omarchy-bot-runtime";
const DOWNLOAD_TIMEOUT_MS = 60_000;
const REQUIRED_BINARIES = ["sway", "swaymsg", "wayvnc", "wlr-randr"] as const;

export interface SwayRuntimeBinaries {
  swayBin: string;
  swaymsgBin: string;
  wayvncBin: string;
  wlrRandrBin: string;
}

export interface SwayRuntimeSupply {
  ensure(): Promise<SwayRuntimeBinaries>;
}

type RuntimeFetch = (url: string, init?: RequestInit) => Promise<Response>;
type ArchiveExtractor = (archivePath: string, destination: string) => Promise<void>;

export interface PortableSwayRuntimeSupplyOptions {
  rootDir: string;
  packages?: readonly SwayRuntimePackage[];
  fetch?: RuntimeFetch;
  extractArchive?: ArchiveExtractor;
  platform?: string;
  arch?: string;
}

function isExecutableFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile() && (statSync(candidate).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

async function sha256(filePath: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of createReadStream(filePath)) hasher.update(chunk);
  return hasher.digest("hex");
}

async function extractArchiveWithTar(archivePath: string, destination: string): Promise<void> {
  const tar = Bun.which("tar");
  if (tar === null) {
    throw new Error("portable Sway provisioning requires tar with zstd archive support");
  }
  const child = Bun.spawn([tar, "--extract", "--file", archivePath, "--directory", destination], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [status, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (status !== 0) {
    throw new Error(
      `tar could not extract ${path.basename(archivePath)}${stderr.trim() === "" ? "" : `: ${stderr.trim()}`}`,
    );
  }
}

function wrapper(binary: (typeof REQUIRED_BINARIES)[number]): string {
  return [
    "#!/bin/sh",
    "bundle_root=$(CDPATH= cd -- \"$(dirname -- \"$0\")/..\" && pwd)",
    "export LD_LIBRARY_PATH=\"$bundle_root/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}\"",
    `exec "$bundle_root/usr/bin/${binary}" "$@"`,
    "",
  ].join("\n");
}

/**
 * Lazily installs the pinned Sway/WayVNC runtime for Omarchy x64 into an
 * application-owned directory. Each process shares one in-flight promise;
 * competing processes publish only a fully verified and extracted directory
 * through atomic rename. `ensure()` never touches Bot Desktop Session trees.
 */
export class PortableSwayRuntimeSupply implements SwayRuntimeSupply {
  readonly #packages: readonly SwayRuntimePackage[];
  readonly #fetch: RuntimeFetch;
  readonly #extractArchive: ArchiveExtractor;
  readonly #platform: string;
  readonly #arch: string;
  #inFlight: Promise<SwayRuntimeBinaries> | undefined;

  constructor(private readonly options: PortableSwayRuntimeSupplyOptions) {
    this.#packages = options.packages ?? SWAY_RUNTIME_PACKAGES;
    this.#fetch = options.fetch ?? fetch;
    this.#extractArchive = options.extractArchive ?? extractArchiveWithTar;
    this.#platform = options.platform ?? process.platform;
    this.#arch = options.arch ?? process.arch;
  }

  ensure(): Promise<SwayRuntimeBinaries> {
    if (this.#inFlight !== undefined) return this.#inFlight;
    const provision = this.#provision().finally(() => {
      if (this.#inFlight === provision) this.#inFlight = undefined;
    });
    this.#inFlight = provision;
    return provision;
  }

  async #provision(): Promise<SwayRuntimeBinaries> {
    if (this.#platform !== "linux" || this.#arch !== "x64") {
      throw new Error(
        `portable Sway provisioning requires Omarchy on x64 (found ${this.#platform} ${this.#arch})`,
      );
    }

    const destination = path.join(this.options.rootDir, SWAY_RUNTIME_RELEASE);
    const ready = this.#readyBinaries(destination);
    if (ready !== undefined) return ready;

    mkdirSync(this.options.rootDir, { recursive: true, mode: 0o700 });
    chmodSync(this.options.rootDir, 0o700);
    const staging = `${destination}.stage-${process.pid}-${randomUUID()}`;
    const archives = path.join(staging, ".archives");
    mkdirSync(archives, { recursive: true, mode: 0o700 });

    try {
      const downloaded = await Promise.all(this.#packages.map(async (runtimePackage, index) => {
        const archivePath = path.join(archives, `${index}-${runtimePackage.name}.pkg.tar.zst`);
        await this.#downloadVerified(runtimePackage, archivePath);
        return archivePath;
      }));
      for (const archivePath of downloaded) {
        await this.#extractArchive(archivePath, staging);
      }
      rmSync(archives, { recursive: true, force: true });
      for (const metadata of [".BUILDINFO", ".INSTALL", ".MTREE", ".PKGINFO"]) {
        rmSync(path.join(staging, metadata), { force: true });
      }

      for (const binary of REQUIRED_BINARIES) {
        const extracted = path.join(staging, "usr", "bin", binary);
        if (!isExecutableFile(extracted)) {
          throw new Error(`portable Sway package set did not contain executable usr/bin/${binary}`);
        }
        const launchWrapper = path.join(staging, "bin", binary);
        mkdirSync(path.dirname(launchWrapper), { recursive: true, mode: 0o700 });
        writeFileSync(launchWrapper, wrapper(binary), { mode: 0o700 });
        chmodSync(launchWrapper, 0o700);
      }
      writeFileSync(path.join(staging, READY_FILE), `${SWAY_RUNTIME_RELEASE}\n`, { mode: 0o600 });

      try {
        renameSync(staging, destination);
      } catch (error) {
        const concurrentlyPublished = this.#readyBinaries(destination);
        if (concurrentlyPublished !== undefined) return concurrentlyPublished;
        throw new Error(
          `could not publish the app-owned Sway runtime at ${destination}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      const published = this.#readyBinaries(destination);
      if (published === undefined) {
        throw new Error(`app-owned Sway runtime at ${destination} was not complete after publication`);
      }
      return published;
    } catch (error) {
      throw new Error(
        `unable to provision the app-owned Sway runtime under ${this.options.rootDir}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  async #downloadVerified(runtimePackage: SwayRuntimePackage, archivePath: string): Promise<void> {
    if (!runtimePackage.url.startsWith("https://")) {
      throw new Error(`${runtimePackage.name} runtime archive must use HTTPS`);
    }
    let response: Response;
    try {
      response = await this.#fetch(runtimePackage.url, {
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      });
    } catch (error) {
      throw new Error(
        `could not download ${runtimePackage.name} from ${runtimePackage.url}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    if (!response.ok) {
      throw new Error(
        `could not download ${runtimePackage.name} from ${runtimePackage.url}: HTTP ${response.status}`,
      );
    }
    await Bun.write(archivePath, response);
    const actual = await sha256(archivePath);
    if (actual !== runtimePackage.sha256) {
      throw new Error(
        `${runtimePackage.name} archive failed SHA-256 verification (expected ${runtimePackage.sha256}, received ${actual})`,
      );
    }
  }

  #readyBinaries(destination: string): SwayRuntimeBinaries | undefined {
    try {
      if (readFileSync(path.join(destination, READY_FILE), "utf8") !== `${SWAY_RUNTIME_RELEASE}\n`) {
        return undefined;
      }
      const swayBin = path.join(destination, "bin", "sway");
      const swaymsgBin = path.join(destination, "bin", "swaymsg");
      const wayvncBin = path.join(destination, "bin", "wayvnc");
      const wlrRandrBin = path.join(destination, "bin", "wlr-randr");
      if (
        !REQUIRED_BINARIES.every((binary) => existsSync(path.join(destination, "usr", "bin", binary)))
        || !isExecutableFile(swayBin)
        || !isExecutableFile(swaymsgBin)
        || !isExecutableFile(wayvncBin)
        || !isExecutableFile(wlrRandrBin)
      ) {
        return undefined;
      }
      return { swayBin, swaymsgBin, wayvncBin, wlrRandrBin };
    } catch {
      return undefined;
    }
  }
}

export interface ResolveSwayRuntimeOptions {
  swayOverride?: string;
  swaymsgOverride?: string;
  wayvncOverride?: string;
  wlrRandrOverride?: string;
  supply?: SwayRuntimeSupply;
  findExecutable?: (candidate: string) => string | undefined;
}

function findExecutable(candidate: string): string | undefined {
  if (candidate.includes("/")) return isExecutableFile(candidate) ? candidate : undefined;
  return Bun.which(candidate) ?? undefined;
}

/** Keeps explicit overrides authoritative, then prefers a complete installed set. */
export async function resolveSwayRuntimeBinaries(
  options: ResolveSwayRuntimeOptions,
): Promise<SwayRuntimeBinaries> {
  const find = options.findExecutable ?? findExecutable;
  const explicit = {
    sway: resolveOverride("Sway", options.swayOverride, find),
    swaymsg: resolveOverride("swaymsg", options.swaymsgOverride, find),
    wayvnc: resolveOverride("WayVNC", options.wayvncOverride, find),
    wlrRandr: resolveOverride("wlr-randr", options.wlrRandrOverride, find),
  };

  const swayBin = explicit.sway ?? find("sway");
  const swaymsgBin = explicit.swaymsg ?? find("swaymsg");
  const wayvncBin = explicit.wayvnc ?? find("wayvnc");
  const wlrRandrBin = explicit.wlrRandr ?? find("wlr-randr");
  if (
    swayBin !== undefined
    && swaymsgBin !== undefined
    && wayvncBin !== undefined
    && wlrRandrBin !== undefined
  ) {
    return { swayBin, swaymsgBin, wayvncBin, wlrRandrBin };
  }
  if (options.supply === undefined) {
    throw new Error("Sway, swaymsg, WayVNC, and wlr-randr are unavailable and no app-owned runtime supply is configured");
  }

  const supplied = await options.supply.ensure();
  return {
    swayBin: swayBin ?? supplied.swayBin,
    swaymsgBin: swaymsgBin ?? supplied.swaymsgBin,
    wayvncBin: wayvncBin ?? supplied.wayvncBin,
    wlrRandrBin: wlrRandrBin ?? supplied.wlrRandrBin,
  };
}

function resolveOverride(
  label: string,
  override: string | undefined,
  find: (candidate: string) => string | undefined,
): string | undefined {
  if (override === undefined) return undefined;
  const resolved = find(override);
  if (resolved === undefined) {
    throw new Error(`configured ${label} executable is unavailable: ${override}`);
  }
  return resolved;
}
