import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dir, "../..");
const installScript = path.join(projectRoot, ".cursor", "install.sh");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function executable(file: string, contents: string): string {
  writeFileSync(file, contents);
  chmodSync(file, 0o700);
  return file;
}

function cloudFixture(existingBunVersion: string, installerBunVersion = "1.4.2"): {
  home: string;
  fixtureBin: string;
  env: Record<string, string | undefined>;
} {
  const root = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-cloud-"));
  roots.push(root);
  const home = path.join(root, "home");
  const bunBin = path.join(home, ".bun", "bin");
  const fixtureBin = path.join(root, "bin");
  mkdirSync(bunBin, { recursive: true });
  mkdirSync(fixtureBin);

  executable(
    path.join(bunBin, "bun"),
    `#!/usr/bin/env bash\nif [ "$1" = "--version" ]; then printf '%s\\n' '${existingBunVersion}'; fi\n`,
  );
  executable(path.join(bunBin, "bunx"), "#!/usr/bin/env bash\nexit 0\n");
  executable(
    path.join(fixtureBin, "sudo"),
    `#!/usr/bin/env bash\nif [ "$1" = "ln" ]; then case "$4" in /usr/local/bin/bun|/usr/local/bin/bunx) ln -sf "$3" "$CLOUD_TEST_BIN/\${4##*/}" ;; *) exit 1 ;; esac; fi\n`,
  );

  const installer = path.join(root, "bun-installer.sh");
  writeFileSync(
    installer,
    `mkdir -p "$HOME/.bun/bin"\nprintf '%s\\n' '#!/usr/bin/env bash' 'if [ "$1" = "--version" ]; then printf "%s\\\\n" "${installerBunVersion}"; fi' > "$HOME/.bun/bin/bun"\nprintf '%s\\n' '#!/usr/bin/env bash' 'exit 0' > "$HOME/.bun/bin/bunx"\nchmod +x "$HOME/.bun/bin/bun" "$HOME/.bun/bin/bunx"\n`,
  );
  executable(path.join(fixtureBin, "curl"), "#!/usr/bin/env bash\ncat \"$CLOUD_TEST_INSTALLER\"\n");

  return {
    home,
    fixtureBin,
    env: {
      ...process.env,
      HOME: home,
      PATH: `${fixtureBin}:/usr/bin:/bin`,
      CLOUD_TEST_INSTALLER: installer,
      CLOUD_TEST_BIN: fixtureBin,
    },
  };
}

async function runInstall(env: Record<string, string | undefined>): Promise<{
  status: number;
  stdout: string;
  stderr: string;
}> {
  const child = Bun.spawn(["bash", installScript], {
    cwd: projectRoot,
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

test("cloud bootstrap replaces an unsupported existing Bun before reporting ready", async () => {
  const fixture = cloudFixture("1.3.9");

  const result = await runInstall(fixture.env);

  expect(result.status).toBe(0);
  const selectedRuntime = Bun.spawnSync([path.join(fixture.home, ".bun", "bin", "bun"), "--version"]);
  expect(selectedRuntime.exitCode).toBe(0);
  expect(selectedRuntime.stdout.toString().trim()).toBe("1.4.2");
});

test("cloud bootstrap keeps an existing supported Bun", async () => {
  const fixture = cloudFixture("1.4.1");

  const result = await runInstall(fixture.env);

  expect(result.status).toBe(0);
  const selectedRuntime = Bun.spawnSync([path.join(fixture.home, ".bun", "bin", "bun"), "--version"]);
  expect(selectedRuntime.stdout.toString().trim()).toBe("1.4.1");
});

test("cloud bootstrap rejects an installer that leaves Bun unsupported", async () => {
  const fixture = cloudFixture("1.3.9", "1.3.9");

  const result = await runInstall(fixture.env);

  expect(result.status).not.toBe(0);
  const selectedRuntime = Bun.spawnSync([path.join(fixture.home, ".bun", "bin", "bun"), "--version"]);
  expect(selectedRuntime.stdout.toString().trim()).toBe("1.3.9");
});


test("cloud bootstrap preserves a supported PATH Bun without a private installation", async () => {
  const fixture = cloudFixture("1.3.9");
  rmSync(path.join(fixture.home, ".bun"), { recursive: true });
  const pathBun = executable(
    path.join(fixture.fixtureBin, "bun"),
    "#!/usr/bin/env bash\nif [ \"$1\" = \"--version\" ]; then printf '1.5.0\\n'; fi\n",
  );

  const result = await runInstall(fixture.env);

  expect(result.status).toBe(0);
  const selectedRuntime = Bun.spawnSync([pathBun, "--version"]);
  expect(selectedRuntime.exitCode).toBe(0);
  expect(selectedRuntime.stdout.toString().trim()).toBe("1.5.0");
  expect(existsSync(path.join(fixture.home, ".bun"))).toBe(false);
});
