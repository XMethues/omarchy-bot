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
  CAGE_RUNTIME_RELEASE,
  PortableCageRuntimeSupply,
  resolveCageRuntimeBinaries,
  type CageRuntimePackage,
} from "../../apps/daemon/src/modules/computer/cageRuntimeSupply.ts";

let root: string | undefined;

afterEach(() => {
  if (root !== undefined) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

test("selects the app-owned Cage fallback only when the system pair is incomplete", async () => {
  let supplyCalls = 0;
  const appOwned = {
    cageBin: "/app-data/runtime/cage/bin/cage",
    wlrRandrBin: "/app-data/runtime/cage/bin/wlr-randr",
  };
  const supply = {
    ensure: async () => {
      supplyCalls += 1;
      return appOwned;
    },
  };

  await expect(resolveCageRuntimeBinaries({
    supply,
    findExecutable: () => undefined,
  })).resolves.toEqual(appOwned);
  expect(supplyCalls).toBe(1);

  const system = await resolveCageRuntimeBinaries({
    supply,
    findExecutable: (candidate) => `/usr/bin/${candidate}`,
  });
  expect(system).toEqual({
    cageBin: "/usr/bin/cage",
    wlrRandrBin: "/usr/bin/wlr-randr",
  });
  expect(supplyCalls).toBe(1);
});

test("keeps an unavailable explicit Cage override authoritative", async () => {
  let supplyCalls = 0;
  await expect(resolveCageRuntimeBinaries({
    cageOverride: "/configured/missing-cage",
    supply: {
      ensure: async () => {
        supplyCalls += 1;
        return { cageBin: "/app/cage", wlrRandrBin: "/app/wlr-randr" };
      },
    },
    findExecutable: (candidate) => candidate === "wlr-randr" ? "/usr/bin/wlr-randr" : undefined,
  })).rejects.toThrow("configured Cage executable is unavailable: /configured/missing-cage");
  expect(supplyCalls).toBe(0);
});

test("rejects an archive integrity failure and removes its private staging tree", async () => {
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-cage-supply-integrity-"));
  const runtimePackage: CageRuntimePackage = {
    name: "fixture",
    url: "https://packages.invalid/fixture.pkg.tar.zst",
    sha256: "0".repeat(64),
  };
  let extractionCalls = 0;
  const supply = new PortableCageRuntimeSupply({
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
  root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-cage-supply-concurrent-"));
  const archive = new TextEncoder().encode("verified portable runtime fixture");
  const expectedSha256 = new Bun.CryptoHasher("sha256").update(archive).digest("hex");
  const runtimePackage: CageRuntimePackage = {
    name: "fixture",
    url: "https://packages.invalid/fixture.pkg.tar.zst",
    sha256: expectedSha256,
  };
  const fetchStarted = Promise.withResolvers<void>();
  const releaseFetch = Promise.withResolvers<void>();
  let fetchCalls = 0;
  let extractionCalls = 0;
  const supply = new PortableCageRuntimeSupply({
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
      const binaryDir = path.join(destination, "usr", "bin");
      mkdirSync(binaryDir, { recursive: true });
      for (const binary of ["cage", "wlr-randr"]) {
        const executable = path.join(binaryDir, binary);
        writeFileSync(executable, "#!/bin/sh\nexit 0\n");
        chmodSync(executable, 0o700);
      }
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
  expect(readdirSync(root)).toEqual([CAGE_RUNTIME_RELEASE]);
  const published = path.join(root, CAGE_RUNTIME_RELEASE);
  for (const [name, executable] of Object.entries(results[0]!)) {
    expect(executable.startsWith(published)).toBeTrue();
    expect(statSync(executable).mode & 0o111).not.toBe(0);
    const contents = readFileSync(executable, "utf8");
    expect(contents).toContain("$bundle_root/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}");
    expect(contents).toContain(`/usr/bin/${name === "cageBin" ? "cage" : "wlr-randr"}`);
  }
});
