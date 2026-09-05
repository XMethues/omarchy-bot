import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "../..");
const launcher = path.join(projectRoot, "plugin", "launch.sh");
const supervisor = path.join(projectRoot, "plugin", "supervise.sh");
const packager = path.join(projectRoot, "scripts", "package-plugin-runtime.sh");
const roots: string[] = [];

const helperPaths = [
  "apps/daemon/dist/native-pointer/omarchy-bot-wayland-input",
  "apps/daemon/dist/native-capture/omarchy-bot-wayland-capture",
  "apps/daemon/dist/native-bot-desktop/omarchy-bot-desktop",
] as const;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function writeExecutable(file: string, contents: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, contents);
  chmodSync(file, 0o700);
}

function writeZstdShim(binDir: string): void {
  writeExecutable(
    path.join(binDir, "zstd"),
    `#!/usr/bin/env python3
import ctypes
import sys

lib = ctypes.CDLL("libzstd.so.1")
lib.ZSTD_compressBound.restype = ctypes.c_size_t
lib.ZSTD_compress.restype = ctypes.c_size_t
lib.ZSTD_decompress.restype = ctypes.c_size_t
lib.ZSTD_isError.restype = ctypes.c_uint
lib.ZSTD_getFrameContentSize.restype = ctypes.c_ulonglong
lib.ZSTD_compressBound.argtypes = [ctypes.c_size_t]
lib.ZSTD_compress.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int]
lib.ZSTD_decompress.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_void_p, ctypes.c_size_t]
lib.ZSTD_getFrameContentSize.argtypes = [ctypes.c_void_p, ctypes.c_size_t]
lib.ZSTD_isError.argtypes = [ctypes.c_size_t]

data = sys.stdin.buffer.read()
decompress = any(
  arg in ("-d", "--decompress") or (arg.startswith("-") and not arg.startswith("--") and "d" in arg[1:])
  for arg in sys.argv[1:]
)
if decompress:
  size = lib.ZSTD_getFrameContentSize(data, len(data))
  if size in (0xFFFFFFFFFFFFFFFF, 0xFFFFFFFFFFFFFFFE):
    size = max(len(data) * 20, 1)
  out = ctypes.create_string_buffer(size)
  written = lib.ZSTD_decompress(out, size, data, len(data))
  if lib.ZSTD_isError(written):
    raise SystemExit("zstd decompress failed")
  sys.stdout.buffer.write(out.raw[:written])
else:
  bound = lib.ZSTD_compressBound(len(data))
  out = ctypes.create_string_buffer(bound)
  written = lib.ZSTD_compress(out, bound, data, len(data), 3)
  if lib.ZSTD_isError(written):
    raise SystemExit("zstd compress failed")
  sys.stdout.buffer.write(out.raw[:written])
`,
  );
}

function writeCurlShim(file: string): void {
  writeExecutable(
    file,
    [
      "#!/bin/sh",
      "out=",
      "url=",
      "while [ $# -gt 0 ]; do",
      "  case $1 in",
      "    -o)",
      "      out=$2",
      "      shift 2",
      "      ;;",
      "    --proto|--max-time)",
      "      shift 2",
      "      ;;",
      "    --tlsv1.2|-*)",
      "      shift",
      "      ;;",
      "    *)",
      "      url=$1",
      "      shift",
      "      ;;",
      "  esac",
      "done",
      'if [ -z "$out" ] || [ -z "$url" ]; then',
      '  echo "curl fixture requires -o and a URL" >&2',
      "  exit 2",
      "fi",
      "case $url in",
      "  http://*)",
      '    echo "curl fixture refused a non-HTTPS URL" >&2',
      "    exit 1",
      "    ;;",
      "  *bun-linux-x64.zip)",
      '    if [ -n "${OMARCHY_BOT_PLUGIN_TEST_BUN_ZIP:-}" ]; then',
      '      cp "$OMARCHY_BOT_PLUGIN_TEST_BUN_ZIP" "$out"',
      "      exit 0",
      "    fi",
      "    exit 22",
      "    ;;",
      "  *.sha256)",
      '    if [ -n "${OMARCHY_BOT_PLUGIN_TEST_RUNTIME_SHA256:-}" ]; then',
      '      printf "%s\\n" "$OMARCHY_BOT_PLUGIN_TEST_RUNTIME_SHA256" > "$out"',
      "      exit 0",
      "    fi",
      "    exit 22",
      "    ;;",
      "  *omarchy-bot-runtime-*)",
      '    if [ -n "${OMARCHY_BOT_PLUGIN_TEST_RUNTIME_ARCHIVE:-}" ]; then',
      '      cp "$OMARCHY_BOT_PLUGIN_TEST_RUNTIME_ARCHIVE" "$out"',
      "      exit 0",
      "    fi",
      "    exit 22",
      "    ;;",
      "esac",
      "exit 22",
      "",
    ].join("\n"),
  );
}

function fixture(): {
  root: string;
  pluginRoot: string;
  appRoot: string;
  binDir: string;
  bun: string;
  env: Record<string, string | undefined>;
  invocations: string;
  revision: string;
} {
  const root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-plugin-"));
  roots.push(root);
  const pluginRoot = path.join(root, "plugin-source");
  const runtime = path.join(root, "runtime");
  const data = path.join(root, "data");
  const binDir = path.join(root, "bin");
  mkdirSync(pluginRoot);
  mkdirSync(runtime);
  mkdirSync(binDir);
  writeZstdShim(binDir);
  const osRelease = path.join(root, "os-release");
  writeFileSync(osRelease, 'NAME="Omarchy"\nID=omarchy\nID_LIKE=arch\n');
  const invocations = path.join(root, "bun-invocations");
  const bun = path.join(root, "bun");
  writeExecutable(
    bun,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.4.1; exit 0; fi\nprintf "%s|%s\\n" "$PWD" "$*" >> "$OMARCHY_BOT_PLUGIN_TEST_LOG"\n',
  );
  const curl = path.join(root, "curl");
  writeCurlShim(curl);
  writeFileSync(path.join(pluginRoot, "fixture.txt"), "tracked plugin source\n");

  for (const args of [
    ["init", "--quiet"],
    ["add", "."],
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "fixture"],
  ]) {
    const result = Bun.spawnSync(["git", "-C", pluginRoot, ...args], { stderr: "pipe" });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  }
  const revision = Bun.spawnSync(["git", "-C", pluginRoot, "rev-parse", "HEAD"]).stdout.toString().trim();
  return {
    root,
    pluginRoot,
    appRoot: path.join(data, "omarchy-bot", "app", revision),
    binDir,
    bun,
    invocations,
    revision,
    env: {
      ...process.env,
      PATH: `${binDir}:/usr/bin:/bin`,
      XDG_DATA_HOME: data,
      XDG_STATE_HOME: path.join(root, "state"),
      XDG_RUNTIME_DIR: runtime,
      OMARCHY_BOT_PLUGIN_ROOT: pluginRoot,
      OMARCHY_BOT_PLUGIN_OS_RELEASE: osRelease,
      OMARCHY_BOT_PLUGIN_BUN: bun,
      OMARCHY_BOT_PLUGIN_CURL: curl,
      OMARCHY_BOT_PLUGIN_TEST_LOG: invocations,
    },
  };
}

async function runCommand(
  command: string[],
  env: Record<string, string | undefined>,
): Promise<{ status: number; stdout: string; stderr: string }> {
  const child = Bun.spawn(command, {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { status, stdout, stderr };
}

async function runLauncher(env: Record<string, string | undefined>): Promise<{ status: number; stderr: string }> {
  const result = await runCommand(["bash", launcher], env);
  return { status: result.status, stderr: result.stderr };
}

function writeRuntimeTree(tree: string): void {
  mkdirSync(path.join(tree, "apps", "web", "dist"), { recursive: true });
  mkdirSync(path.join(tree, "node_modules"), { recursive: true });
  writeFileSync(path.join(tree, "package.json"), `${JSON.stringify({ scripts: { start: "true" } })}\n`);
  writeFileSync(path.join(tree, "apps", "web", "dist", "index.html"), "ok\n");
  for (const helper of helperPaths) {
    writeExecutable(path.join(tree, helper), "#!/bin/sh\nexit 0\n");
  }
}

function makeRuntimeArchive(root: string): { archive: string; sha256: string } {
  const tree = path.join(root, "runtime-tree");
  writeRuntimeTree(tree);
  const archive = path.join(root, "omarchy-bot-runtime-fixture.tar.zst");
  const packed = Bun.spawnSync(["tar", "--zstd", "-cf", archive, "-C", tree, "."], {
    env: { ...process.env, PATH: `${path.join(root, "bin")}:/usr/bin:/bin` },
    stderr: "pipe",
  });
  if (packed.exitCode !== 0) throw new Error(packed.stderr.toString());
  const sha256 = new Bun.CryptoHasher("sha256").update(readFileSync(archive)).digest("hex");
  return { archive, sha256 };
}

function makeBunZip(root: string, bunSource: string): string {
  const zipRoot = path.join(root, "bun-zip");
  mkdirSync(path.join(zipRoot, "bun-linux-x64"), { recursive: true });
  const bun = path.join(zipRoot, "bun-linux-x64", "bun");
  writeFileSync(bun, readFileSync(bunSource));
  chmodSync(bun, 0o700);
  const zip = path.join(root, "bun-linux-x64.zip");
  const result = Bun.spawnSync(["python3", "-c", "import shutil, sys; shutil.make_archive(sys.argv[1], 'zip', sys.argv[2])", zip.replace(/\.zip$/, ""), zipRoot], {
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return zip;
}

test("repository exposes the official Omarchy service plugin contract", () => {
  const manifest = JSON.parse(readFileSync(path.join(projectRoot, "manifest.json"), "utf8")) as {
    schemaVersion: number;
    id: string;
    kinds: string[];
    entryPoints: Record<string, string>;
  };
  expect(manifest).toMatchObject({
    schemaVersion: 1,
    id: "io.github.xmethues.omarchy-bot",
    kinds: ["service"],
    entryPoints: { service: "plugin/Service.qml" },
  });
  expect(existsSync(path.join(projectRoot, manifest.entryPoints.service!))).toBeTrue();
  const qml = readFileSync(path.join(projectRoot, "plugin", "Service.qml"), "utf8");
  expect(qml).toContain("supervise.sh");
});

test("plugin lifecycle builds one revision once and starts the daemon every time", async () => {
  const setup = fixture();
  await expect(runLauncher(setup.env)).resolves.toEqual({ status: 0, stderr: "" });
  await expect(runLauncher(setup.env)).resolves.toEqual({ status: 0, stderr: "" });

  const invocations = readFileSync(setup.invocations, "utf8").trim().split("\n");
  expect(invocations.map((invocation) => invocation.slice(invocation.indexOf("|") + 1))).toEqual([
    "install --frozen-lockfile",
    "run --filter=@omarchy-bot/web build",
    "apps/daemon/native/pointer-helper/build.ts",
    "apps/daemon/native/capture-helper/build.ts",
    "apps/daemon/native/bot-desktop/build.ts",
    "run start",
    "run start",
  ]);
  const buildDirectories = invocations.slice(0, 5).map((invocation) => invocation.slice(0, invocation.indexOf("|")));
  expect(new Set(buildDirectories).size).toBe(1);
  expect(buildDirectories[0]).toStartWith(`${path.dirname(setup.appRoot)}/.stage-${path.basename(setup.appRoot)}-`);
  expect(invocations.slice(5).map((invocation) => invocation.slice(0, invocation.indexOf("|")))).toEqual([
    setup.appRoot,
    setup.appRoot,
  ]);
  expect(readFileSync(path.join(setup.appRoot, ".omarchy-bot-plugin-ready"), "utf8")).toBe(
    `${path.basename(setup.appRoot)}\n`,
  );
  expect(Bun.spawnSync(["git", "-C", setup.pluginRoot, "status", "--porcelain"]).stdout.toString()).toBe("");
});

test("plugin lifecycle prefers a verified runtime artifact over source-build", async () => {
  const setup = fixture();
  const runtime = makeRuntimeArchive(setup.root);
  setup.env.OMARCHY_BOT_PLUGIN_TEST_RUNTIME_ARCHIVE = runtime.archive;
  setup.env.OMARCHY_BOT_PLUGIN_TEST_RUNTIME_SHA256 = `${runtime.sha256}  omarchy-bot-runtime-${setup.revision}-x86_64.tar.zst`;

  await expect(runLauncher(setup.env)).resolves.toEqual({ status: 0, stderr: "" });
  await expect(runLauncher(setup.env)).resolves.toEqual({ status: 0, stderr: "" });

  expect(readFileSync(setup.invocations, "utf8").trim().split("\n").map((line) => line.slice(line.indexOf("|") + 1))).toEqual([
    "run start",
    "run start",
  ]);
  expect(existsSync(path.join(setup.appRoot, "apps", "web", "dist", "index.html"))).toBeTrue();
  for (const helper of helperPaths) {
    expect(existsSync(path.join(setup.appRoot, helper))).toBeTrue();
  }
  expect(readFileSync(path.join(setup.appRoot, ".omarchy-bot-plugin-ready"), "utf8")).toBe(`${setup.revision}\n`);
});

test("plugin lifecycle rejects a runtime SHA-256 mismatch without extracting", async () => {
  const setup = fixture();
  const runtime = makeRuntimeArchive(setup.root);
  setup.env.OMARCHY_BOT_PLUGIN_TEST_RUNTIME_ARCHIVE = runtime.archive;
  setup.env.OMARCHY_BOT_PLUGIN_TEST_RUNTIME_SHA256 = `${"0".repeat(64)}  omarchy-bot-runtime-${setup.revision}-x86_64.tar.zst`;

  const result = await runLauncher(setup.env);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("plugin runtime failed SHA-256 verification");
  expect(existsSync(setup.appRoot)).toBeFalse();
  expect(existsSync(setup.invocations)).toBeFalse();
});

test("plugin lifecycle rejects a non-HTTPS runtime URL", async () => {
  const setup = fixture();
  setup.env.OMARCHY_BOT_PLUGIN_RUNTIME_URL = "http://packages.invalid/omarchy-bot-runtime.tgz";
  setup.env.OMARCHY_BOT_PLUGIN_RUNTIME_SHA256 = "0".repeat(64);

  const result = await runLauncher(setup.env);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("plugin runtime must use HTTPS");
  expect(existsSync(setup.invocations)).toBeFalse();
});

test("plugin lifecycle resolves Bun from mise before downloading a pin", async () => {
  const setup = fixture();
  writeExecutable(
    path.join(setup.binDir, "mise"),
    '#!/bin/sh\nif [ "$1" = "which" ] && [ "$2" = "bun" ]; then printf "%s\\n" "$OMARCHY_BOT_PLUGIN_TEST_MISE_BUN"; exit 0; fi\nexit 1\n',
  );
  const env = { ...setup.env };
  delete env.OMARCHY_BOT_PLUGIN_BUN;
  env.OMARCHY_BOT_PLUGIN_TEST_MISE_BUN = setup.bun;

  await expect(runLauncher(env)).resolves.toEqual({ status: 0, stderr: "" });
  expect(readFileSync(setup.invocations, "utf8")).toContain("install --frozen-lockfile");
});

test("plugin lifecycle downloads pinned Bun when PATH and mise are empty", async () => {
  const setup = fixture();
  const zip = makeBunZip(setup.root, setup.bun);
  const env = { ...setup.env };
  delete env.OMARCHY_BOT_PLUGIN_BUN;
  env.OMARCHY_BOT_PLUGIN_TEST_BUN_ZIP = zip;
  env.OMARCHY_BOT_PLUGIN_BUN_URL = "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64.zip";
  env.OMARCHY_BOT_PLUGIN_BUN_SHA256 = new Bun.CryptoHasher("sha256").update(readFileSync(zip)).digest("hex");

  await expect(runLauncher(env)).resolves.toEqual({ status: 0, stderr: "" });
  expect(existsSync(path.join(setup.env.XDG_DATA_HOME!, "omarchy-bot", "runtime", "bun", "1.4.2", "bin", "bun"))).toBeTrue();
  expect(readFileSync(setup.invocations, "utf8")).toContain("run start");
});

test("plugin supervisor logs a launch failure and notifies the desktop", async () => {
  const setup = fixture();
  const failing = path.join(setup.root, "failing-launch.sh");
  writeExecutable(failing, "#!/bin/sh\nprintf 'launcher exploded\\n' >&2\nexit 7\n");
  writeExecutable(
    path.join(setup.binDir, "notify-send"),
    '#!/bin/sh\nprintf "%s\\n" "$*" >> "$OMARCHY_BOT_PLUGIN_TEST_NOTIFY"\n',
  );
  const notifyLog = path.join(setup.root, "notify.log");
  const result = await runCommand(["bash", supervisor], {
    ...setup.env,
    OMARCHY_BOT_PLUGIN_LAUNCH: failing,
    OMARCHY_BOT_PLUGIN_TEST_NOTIFY: notifyLog,
  });

  expect(result.status).toBe(7);
  const log = readFileSync(path.join(setup.env.XDG_STATE_HOME!, "omarchy-bot", "plugin-launch.log"), "utf8");
  expect(log).toContain("launcher exploded");
  expect(readFileSync(notifyLog, "utf8")).toContain("Failed to start. See");
});

test("plugin runtime packager writes a named archive and SHA-256 sidecar", async () => {
  const setup = fixture();
  const tree = path.join(setup.root, "payload");
  writeRuntimeTree(tree);
  writeFileSync(path.join(tree, "bun.lock"), "{}\n");
  const packaged = await runCommand(["bash", packager, tree, path.join(setup.root, "dist-runtime")], {
    ...setup.env,
    OMARCHY_BOT_PLUGIN_REVISION: setup.revision,
  });
  expect(packaged.status).toBe(0);
  const archive = path.join(setup.root, "dist-runtime", `omarchy-bot-runtime-${setup.revision}-x86_64.tar.zst`);
  const sidecar = `${archive}.sha256`;
  expect(packaged.stdout.trim()).toBe(archive);
  expect(existsSync(archive)).toBeTrue();
  expect(readFileSync(sidecar, "utf8")).toContain(`${new Bun.CryptoHasher("sha256").update(readFileSync(archive)).digest("hex")}  omarchy-bot-runtime-${setup.revision}-x86_64.tar.zst`);
});

test("plugin lifecycle rejects non-Omarchy hosts before invoking Bun", async () => {
  const setup = fixture();
  writeFileSync(setup.env.OMARCHY_BOT_PLUGIN_OS_RELEASE!, "ID=arch\n");

  const result = await runLauncher(setup.env);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("supports Omarchy on x86_64 only");
  expect(existsSync(setup.invocations)).toBeFalse();
});

test("plugin lifecycle rejects an unsupported Bun before building", async () => {
  const setup = fixture();
  writeFileSync(setup.env.OMARCHY_BOT_PLUGIN_BUN!, "#!/bin/sh\necho 1.3.9\n");
  chmodSync(setup.env.OMARCHY_BOT_PLUGIN_BUN!, 0o700);

  const result = await runLauncher(setup.env);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("requires Bun 1.4 or newer (found 1.3.9)");
  expect(existsSync(setup.invocations)).toBeFalse();
});
