import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PortableSwayRuntimeSupply,
  SWAY_RUNTIME_RELEASE,
  resolveSwayRuntimeBinaries,
  type SwayRuntimePackage,
} from "../../apps/daemon/src/modules/computer/swayRuntimeSupply.ts";

let root: string | undefined;

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

const REQUIRED_BINARIES = ["sway", "swaymsg", "wayvnc", "wlr-randr"] as const;

function fixturePackage(archive = "verified portable sway runtime fixture"): {
  runtimePackage: SwayRuntimePackage;
  archive: string;
} {
  return {
    archive,
    runtimePackage: {
      name: "fixture",
      url: "https://packages.invalid/fixture.pkg.tar.zst",
      sha256: new Bun.CryptoHasher("sha256").update(archive).digest("hex"),
    },
  };
}

function writeExtractedBinaries(destination: string, binaries: readonly string[] = REQUIRED_BINARIES): void {
  const binaryDir = path.join(destination, "usr", "bin");
  mkdirSync(binaryDir, { recursive: true });
  for (const binary of binaries) {
    const executable = path.join(binaryDir, binary);
    writeFileSync(executable, "#!/bin/sh\nexit 0\n");
    chmodSync(executable, 0o700);
  }
}

test("selects the app-owned Sway fallback only when the system set is incomplete", async () => {
  let supplyCalls = 0;
  const appOwned = {
    swayBin: "/app-data/runtime/sway/bin/sway",
    swaymsgBin: "/app-data/runtime/sway/bin/swaymsg",
    wayvncBin: "/app-data/runtime/sway/bin/wayvnc",
    wlrRandrBin: "/app-data/runtime/sway/bin/wlr-randr",
  };
  const supply = {
    ensure: async () => {
      supplyCalls += 1;
      return appOwned;
    },
  };

  await expect(resolveSwayRuntimeBinaries({
    supply,
    findExecutable: () => undefined,
  })).resolves.toEqual(appOwned);
  expect(supplyCalls).toBe(1);

  const system = await resolveSwayRuntimeBinaries({
    supply,
    findExecutable: (candidate) => `/usr/bin/${candidate}`,
  });
  expect(system).toEqual({
    swayBin: "/usr/bin/sway",
    swaymsgBin: "/usr/bin/swaymsg",
    wayvncBin: "/usr/bin/wayvnc",
    wlrRandrBin: "/usr/bin/wlr-randr",
  });
  expect(supplyCalls).toBe(1);
});

test("keeps an unavailable explicit Sway override authoritative", async () => {
  let supplyCalls = 0;
  await expect(resolveSwayRuntimeBinaries({
    swayOverride: "/configured/missing-sway",
    supply: {
      ensure: async () => {
        supplyCalls += 1;
        return {
          swayBin: "/app/sway",
          swaymsgBin: "/app/swaymsg",
          wayvncBin: "/app/wayvnc",
          wlrRandrBin: "/app/wlr-randr",
        };
      },
    },
    findExecutable: (candidate) => candidate === "wayvnc" ? "/usr/bin/wayvnc" : undefined,
  })).rejects.toThrow("configured Sway executable is unavailable: /configured/missing-sway");
  expect(supplyCalls).toBe(0);
});

test("rejects an archive integrity failure and removes its private staging tree", async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-sway-supply-integrity-"));
  const runtimePackage: SwayRuntimePackage = {
    name: "fixture",
    url: "https://packages.invalid/fixture.pkg.tar.zst",
    sha256: "0".repeat(64),
  };
  let extractionCalls = 0;
  const supply = new PortableSwayRuntimeSupply({
    rootDir: root,
    packages: [runtimePackage],
    fetch: async () => new Response("tampered archive"),
    extractArchive: async () => {
      extractionCalls += 1;
    },
  });

  await expect(supply.ensure()).rejects.toThrow("fixture archive failed SHA-256 verification");
  expect(extractionCalls).toBe(0);
  expect(readdirSync(root)).toEqual([]);
});

test("shares one provision across concurrent callers and atomically publishes launch wrappers", async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-sway-supply-concurrent-"));
  const { archive, runtimePackage } = fixturePackage();
  const fetchStarted = Promise.withResolvers<void>();
  const releaseFetch = Promise.withResolvers<void>();
  let fetchCalls = 0;
  let extractionCalls = 0;
  const supply = new PortableSwayRuntimeSupply({
    rootDir: root,
    packages: [runtimePackage],
    fetch: async () => {
      fetchCalls += 1;
      fetchStarted.resolve();
      await releaseFetch.promise;
      return new Response(archive);
    },
    extractArchive: async (_archivePath, destination) => {
      extractionCalls += 1;
      writeExtractedBinaries(destination);
    },
  });

  const first = supply.ensure();
  await fetchStarted.promise;
  const second = supply.ensure();
  const third = supply.ensure();
  releaseFetch.resolve();
  const results = await Promise.all([first, second, third]);

  expect(fetchCalls).toBe(1);
  expect(extractionCalls).toBe(1);
  expect(results[1]).toEqual(results[0]);
  expect(results[2]).toEqual(results[0]);
  expect(readdirSync(root)).toEqual([SWAY_RUNTIME_RELEASE]);
  const published = path.join(root, SWAY_RUNTIME_RELEASE);
  const expected = {
    swayBin: "sway",
    swaymsgBin: "swaymsg",
    wayvncBin: "wayvnc",
    wlrRandrBin: "wlr-randr",
  } as const;
  for (const [name, binary] of Object.entries(expected)) {
    const executable = results[0]![name as keyof typeof expected];
    expect(executable.startsWith(published)).toBeTrue();
    expect(statSync(executable).mode & 0o111).not.toBe(0);
    const contents = readFileSync(executable, "utf8");
    expect(contents).toContain("$bundle_root/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}");
    expect(contents).toContain(`/usr/bin/${binary}`);
  }
});

test("reuses a verified cached Sway runtime without fetching again", async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-sway-supply-reuse-"));
  const { archive, runtimePackage } = fixturePackage();
  let fetchCalls = 0;
  const supply = new PortableSwayRuntimeSupply({
    rootDir: root,
    packages: [runtimePackage],
    fetch: async () => {
      fetchCalls += 1;
      return new Response(archive);
    },
    extractArchive: async (_archivePath, destination) => {
      writeExtractedBinaries(destination);
    },
  });

  const first = await supply.ensure();
  const second = await supply.ensure();
  expect(fetchCalls).toBe(1);
  expect(second).toEqual(first);
});

test("rejects an incomplete extract and leaves no ready destination", async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-sway-supply-incomplete-"));
  const { archive, runtimePackage } = fixturePackage();
  const supply = new PortableSwayRuntimeSupply({
    rootDir: root,
    packages: [runtimePackage],
    fetch: async () => new Response(archive),
    extractArchive: async (_archivePath, destination) => {
      writeExtractedBinaries(destination, ["sway", "swaymsg"]);
    },
  });

  await expect(supply.ensure()).rejects.toThrow("did not contain executable usr/bin/wayvnc");
  expect(readdirSync(root)).toEqual([]);
});

test("rejects an unsupported architecture before downloading", async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-sway-supply-arch-"));
  let fetchCalls = 0;
  const supply = new PortableSwayRuntimeSupply({
    rootDir: root,
    platform: "linux",
    arch: "arm64",
    packages: [fixturePackage().runtimePackage],
    fetch: async () => {
      fetchCalls += 1;
      return new Response("unused");
    },
  });

  await expect(supply.ensure()).rejects.toThrow("portable Sway provisioning requires Omarchy on x64");
  expect(fetchCalls).toBe(0);
  expect(readdirSync(root)).toEqual([]);
});

test("ensure does not create or touch a running Bot Desktop Session directory", async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-sway-supply-session-"));
  const sessionDir = path.join(root, "running-session");
  const sentinel = path.join(sessionDir, "session.json");
  mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  writeFileSync(sentinel, "{\"generation\":1}\n", { mode: 0o600 });
  const before = {
    entries: readdirSync(sessionDir),
    sentinel: readFileSync(sentinel, "utf8"),
    mode: statSync(sessionDir).mode,
    mtimeMs: statSync(sentinel).mtimeMs,
  };

  const { archive, runtimePackage } = fixturePackage();
  const supplyRoot = path.join(root, "runtime", "sway");
  const supply = new PortableSwayRuntimeSupply({
    rootDir: supplyRoot,
    packages: [runtimePackage],
    fetch: async () => new Response(archive),
    extractArchive: async (_archivePath, destination) => {
      writeExtractedBinaries(destination);
    },
  });

  await supply.ensure();
  expect(readdirSync(sessionDir)).toEqual(before.entries);
  expect(readFileSync(sentinel, "utf8")).toBe(before.sentinel);
  expect(statSync(sessionDir).mode).toBe(before.mode);
  expect(statSync(sentinel).mtimeMs).toBe(before.mtimeMs);
  expect(existsReadyRelease(supplyRoot)).toBeTrue();
});

function existsReadyRelease(supplyRoot: string): boolean {
  try {
    return readdirSync(supplyRoot).includes(SWAY_RUNTIME_RELEASE);
  } catch {
    return false;
  }
}
