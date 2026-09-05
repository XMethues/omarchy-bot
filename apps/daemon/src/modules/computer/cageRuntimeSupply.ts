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

export interface CageRuntimePackage {
  name: string;
  url: string;
  sha256: string;
}

export const CAGE_RUNTIME_PACKAGES: readonly CageRuntimePackage[] = Object.freeze([
  {
    name: "cage",
    url: "https://archive.archlinux.org/packages/c/cage/cage-0.3.1-1-x86_64.pkg.tar.zst",
    sha256: "d8a8a33d864b8aa85b63990ffd1956be20d56df2f50acde1713fd820d60f61a0",
  },
  {
    name: "wlroots0.20",
    url: "https://archive.archlinux.org/packages/w/wlroots0.20/wlroots0.20-0.20.2-1-x86_64.pkg.tar.zst",
    sha256: "8b1da3fbf29cc45908d8de771bd22a5813b298a9049462df5b8952f23c3ffb8f",
  },
  {
    name: "wlr-randr",
    url: "https://archive.archlinux.org/packages/w/wlr-randr/wlr-randr-0.5.0-1-x86_64.pkg.tar.zst",
    sha256: "cbefba7fd65a384eb44b12df6fbd36d871782827f21a4c793bff171a298887c9",
  },
  {
    name: "libliftoff",
    url: "https://archive.archlinux.org/packages/l/libliftoff/libliftoff-0.5.0-1-x86_64.pkg.tar.zst",
    sha256: "59cf08c21500673a14287b83b89b6db5389134cc24c97d9222c7cddefa639ccf",
  },
]);

export const CAGE_RUNTIME_RELEASE = "cage-0.3.1-wlroots-0.20.2-x86_64";
const READY_FILE = ".omarchy-bot-runtime";
const DOWNLOAD_TIMEOUT_MS = 60_000;

export interface CageRuntimeBinaries {
  cageBin: string;
  wlrRandrBin: string;
}

export interface CageRuntimeSupply {
  ensure(): Promise<CageRuntimeBinaries>;
}

type RuntimeFetch = (url: string, init?: RequestInit) => Promise<Response>;
type ArchiveExtractor = (archivePath: string, destination: string) => Promise<void>;

export interface PortableCageRuntimeSupplyOptions {
  rootDir: string;
  packages?: readonly CageRuntimePackage[];
  fetch?: RuntimeFetch;
  extractArchive?: ArchiveExtractor;
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
    throw new Error("portable Cage provisioning requires tar with zstd archive support");
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

function wrapper(binary: "cage" | "wlr-randr"): string {
  return [
    "#!/bin/sh",
    "bundle_root=$(CDPATH= cd -- \"$(dirname -- \"$0\")/..\" && pwd)",
    "export LD_LIBRARY_PATH=\"$bundle_root/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}\"",
    `exec "$bundle_root/usr/bin/${binary}" "$@"`,
    "",
  ].join("\n");
}

/**
 * Lazily installs the pinned Linux x64 Cage runtime into an application-owned
 * directory. Each process shares one in-flight promise; competing processes
 * publish only a fully verified and extracted directory through atomic rename.
 */
export class PortableCageRuntimeSupply implements CageRuntimeSupply {
  readonly #packages: readonly CageRuntimePackage[];
  readonly #fetch: RuntimeFetch;
  readonly #extractArchive: ArchiveExtractor;
  #inFlight: Promise<CageRuntimeBinaries> | undefined;

  constructor(private readonly options: PortableCageRuntimeSupplyOptions) {
    this.#packages = options.packages ?? CAGE_RUNTIME_PACKAGES;
    this.#fetch = options.fetch ?? fetch;
    this.#extractArchive = options.extractArchive ?? extractArchiveWithTar;
  }

  ensure(): Promise<CageRuntimeBinaries> {
    if (this.#inFlight !== undefined) return this.#inFlight;
    const provision = this.#provision().finally(() => {
      if (this.#inFlight === provision) this.#inFlight = undefined;
    });
    this.#inFlight = provision;
    return provision;
  }

  async #provision(): Promise<CageRuntimeBinaries> {
    if (process.platform !== "linux" || process.arch !== "x64") {
      throw new Error(
        `portable Cage provisioning supports Linux x64 only (found ${process.platform} ${process.arch})`,
      );
    }

    const destination = path.join(this.options.rootDir, CAGE_RUNTIME_RELEASE);
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

      for (const binary of ["cage", "wlr-randr"] as const) {
        const extracted = path.join(staging, "usr", "bin", binary);
        if (!isExecutableFile(extracted)) {
          throw new Error(`portable Cage package set did not contain executable usr/bin/${binary}`);
        }
        const launchWrapper = path.join(staging, "bin", binary);
        mkdirSync(path.dirname(launchWrapper), { recursive: true, mode: 0o700 });
        writeFileSync(launchWrapper, wrapper(binary), { mode: 0o700 });
        chmodSync(launchWrapper, 0o700);
      }
      writeFileSync(path.join(staging, READY_FILE), `${CAGE_RUNTIME_RELEASE}\n`, { mode: 0o600 });

      try {
        renameSync(staging, destination);
      } catch (error) {
        const concurrentlyPublished = this.#readyBinaries(destination);
        if (concurrentlyPublished !== undefined) return concurrentlyPublished;
        throw new Error(
          `could not publish the app-owned Cage runtime at ${destination}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
      const published = this.#readyBinaries(destination);
      if (published === undefined) {
        throw new Error(`app-owned Cage runtime at ${destination} was not complete after publication`);
      }
      return published;
    } catch (error) {
      throw new Error(
        `unable to provision the app-owned Cage runtime under ${this.options.rootDir}: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }

  async #downloadVerified(runtimePackage: CageRuntimePackage, archivePath: string): Promise<void> {
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

  #readyBinaries(destination: string): CageRuntimeBinaries | undefined {
    try {
      if (readFileSync(path.join(destination, READY_FILE), "utf8") !== `${CAGE_RUNTIME_RELEASE}\n`) {
        return undefined;
      }
      const cageBin = path.join(destination, "bin", "cage");
      const wlrRandrBin = path.join(destination, "bin", "wlr-randr");
      if (
        !existsSync(path.join(destination, "usr", "bin", "cage"))
        || !existsSync(path.join(destination, "usr", "bin", "wlr-randr"))
        || !isExecutableFile(cageBin)
        || !isExecutableFile(wlrRandrBin)
      ) {
        return undefined;
      }
      return { cageBin, wlrRandrBin };
    } catch {
      return undefined;
    }
  }
}

export interface ResolveCageRuntimeOptions {
  cageOverride?: string;
  wlrRandrOverride?: string;
  supply?: CageRuntimeSupply;
  findExecutable?: (candidate: string) => string | undefined;
}

function findExecutable(candidate: string): string | undefined {
  if (candidate.includes("/")) return isExecutableFile(candidate) ? candidate : undefined;
  return Bun.which(candidate) ?? undefined;
}

/** Keeps explicit overrides authoritative, then prefers a complete system pair. */
export async function resolveCageRuntimeBinaries(
  options: ResolveCageRuntimeOptions,
): Promise<CageRuntimeBinaries> {
  const find = options.findExecutable ?? findExecutable;
  const explicitCage = options.cageOverride === undefined
    ? undefined
    : find(options.cageOverride);
  if (options.cageOverride !== undefined && explicitCage === undefined) {
    throw new Error(`configured Cage executable is unavailable: ${options.cageOverride}`);
  }
  const explicitWlrRandr = options.wlrRandrOverride === undefined
    ? undefined
    : find(options.wlrRandrOverride);
  if (options.wlrRandrOverride !== undefined && explicitWlrRandr === undefined) {
    throw new Error(`configured wlr-randr executable is unavailable: ${options.wlrRandrOverride}`);
  }

  const cageBin = explicitCage ?? find("cage");
  const wlrRandrBin = explicitWlrRandr ?? find("wlr-randr");
  if (cageBin !== undefined && wlrRandrBin !== undefined) return { cageBin, wlrRandrBin };
  if (options.supply === undefined) {
    throw new Error("Cage and wlr-randr are unavailable and no app-owned runtime supply is configured");
  }

  const supplied = await options.supply.ensure();
  return {
    cageBin: cageBin ?? supplied.cageBin,
    wlrRandrBin: wlrRandrBin ?? supplied.wlrRandrBin,
  };
}
