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
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(): {
  root: string;
  pluginRoot: string;
  appRoot: string;
  env: Record<string, string | undefined>;
  invocations: string;
} {
  const root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-plugin-"));
  roots.push(root);
  const pluginRoot = path.join(root, "plugin-source");
  const runtime = path.join(root, "runtime");
  const data = path.join(root, "data");
  mkdirSync(pluginRoot);
  mkdirSync(runtime);
  const osRelease = path.join(root, "os-release");
  writeFileSync(osRelease, 'NAME="Omarchy"\nID=omarchy\nID_LIKE=arch\n');
  const invocations = path.join(root, "bun-invocations");
  const bun = path.join(root, "bun");
  writeFileSync(
    bun,
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 1.4.1; exit 0; fi\nprintf "%s|%s\\n" "$PWD" "$*" >> "$OMARCHY_BOT_PLUGIN_TEST_LOG"\n',
  );
  chmodSync(bun, 0o700);
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
    invocations,
    env: {
      ...process.env,
      XDG_DATA_HOME: data,
      XDG_RUNTIME_DIR: runtime,
      OMARCHY_BOT_PLUGIN_ROOT: pluginRoot,
      OMARCHY_BOT_PLUGIN_OS_RELEASE: osRelease,
      OMARCHY_BOT_PLUGIN_BUN: bun,
      OMARCHY_BOT_PLUGIN_TEST_LOG: invocations,
    },
  };
}

async function runLauncher(env: Record<string, string | undefined>): Promise<{ status: number; stderr: string }> {
  const child = Bun.spawn(["bash", launcher], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  return { status, stderr };
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
