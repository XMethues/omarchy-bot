import { expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  BotScreenInputAction,
  BotScreenProjectionSource,
} from "../../apps/daemon/src/modules/computer/botScreenManager.ts";
import type { SurfaceId } from "../../packages/domain/src/ids.ts";
import { api, makeBot, startDaemon, type Harness } from "./helpers/harness.ts";

const platformTest = process.env.OMARCHY_BOT_REAL_CAGE_SMOKE === "1" ? test : test.skip;
const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

type Owner = { botId: string; surfaceId: SurfaceId };

function digest(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

async function run(argv: string[]): Promise<string> {
  const child = Bun.spawn(argv, {
    env: process.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (status !== 0) throw new Error(`${argv.join(" ")} failed: ${stderr.trim()}`);
  return stdout;
}


async function differingPixels(
  first: Uint8Array,
  second: Uint8Array,
  directory: string,
  name: string,
): Promise<number> {
  const firstPath = path.join(directory, `${name}-before.png`);
  const secondPath = path.join(directory, `${name}-after.png`);
  writeFileSync(firstPath, first);
  writeFileSync(secondPath, second);
  const child = Bun.spawn(["compare", "-metric", "AE", firstPath, secondPath, "null:"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [status, metric] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (status !== 0 && status !== 1) throw new Error(`ImageMagick comparison failed with status ${status}`);
  return Number(metric.trim().split(/\s+/, 1)[0]);
}

async function waitForPixels(
  source: BotScreenProjectionSource,
  previous: Uint8Array,
  description: string,
): Promise<Uint8Array> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const current = (await source.capture()).bytes;
    if (digest(current) !== digest(previous)) return current;
    if (Date.now() >= deadline) throw new Error(`${description} did not become visible`);
    // A real external Wayland client commit cannot be driven by Bun's deterministic clock.
    await Bun.sleep(20);
  }
}

async function waitForMatchingPixels(
  source: BotScreenProjectionSource,
  expected: Uint8Array,
  description: string,
): Promise<Uint8Array> {
  const expectedDigest = digest(expected);
  const deadline = Date.now() + 5_000;
  for (;;) {
    const current = (await source.capture()).bytes;
    if (digest(current) === expectedDigest) return current;
    if (Date.now() >= deadline) throw new Error(`${description} did not become visible`);
    // A real external Wayland client commit cannot be driven by Bun's deterministic clock.
    await Bun.sleep(20);
  }
}

function inputFor(source: BotScreenProjectionSource, epoch: number): (action: BotScreenInputAction) => Promise<void> {
  let sequence = 0;
  return (action) => source.input({
    surfaceId: source.surfaceId,
    runtimeGeneration: source.runtimeGeneration,
    geometryGeneration: source.geometryGeneration,
    controllerEpoch: epoch,
    sequence: ++sequence,
    ...action,
  });
}

platformTest("two real Cage Screens isolate pixels, focus, cursor, keyboard, profiles, and complete lifecycle cleanup", async () => {
  for (const [binary, configured] of [
    ["grim", process.env.OMARCHY_BOT_GRIM_BIN],
    ["zenity", undefined],
    ["compare", undefined],
  ] as const) {
    const candidate = configured ?? binary;
    const available = candidate.includes("/") ? existsSync(candidate) : Bun.which(candidate) !== null;
    if (!available) throw new Error(`real Cage smoke requires ${binary}`);
  }
  const previousProfile = process.env.OMARCHY_BOT_SCREEN_PROFILE;
  const selectedProfile = process.env.OMARCHY_BOT_CAGE_SMOKE_PROFILE ?? "720p";
  process.env.OMARCHY_BOT_SCREEN_PROFILE = selectedProfile;
  let harness: Harness;
  try {
    harness = await startDaemon(undefined, { useProductionBotScreen: true, botScreenCapacity: 2 });
  } finally {
    if (previousProfile === undefined) delete process.env.OMARCHY_BOT_SCREEN_PROFILE;
    else process.env.OMARCHY_BOT_SCREEN_PROFILE = previousProfile;
  }
  expect(harness.svc.cfg.botScreenRuntimeDir).toBe(path.join(harness.home, "r"));

  const runtimeDirs: string[] = [];
  const profileDirs: string[] = [];
  const surfaceIds = new Set<SurfaceId>();
  try {
    const botIds = await Promise.all([
      makeBot(harness, "First real Cage Screen"),
      makeBot(harness, "Second real Cage Screen"),
    ]);
    const bots = await Promise.all(botIds.map((botId) =>
      api<{ surfaceId: SurfaceId }>(harness, "GET", `/api/bots/${botId}`)
    ));
    const owners: Owner[] = botIds.map((botId, index) => ({ botId, surfaceId: bots[index]!.surfaceId }));
    owners.forEach((owner) => surfaceIds.add(owner.surfaceId));
    runtimeDirs.push(...owners.map((owner) => path.join(harness.svc.cfg.botScreenRuntimeDir, owner.surfaceId)));
    profileDirs.push(...owners.map((owner) => path.join(harness.svc.cfg.botScreenProfileDir, owner.surfaceId)));

    const opening = await Promise.all(owners.map((owner) => fetch(
      `${harness.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`,
    )));
    expect(opening.map((response) => response.status)).toEqual([200, 200]);
    const neutral = await Promise.all(opening.map(async (response) => new Uint8Array(await response.arrayBuffer())));
    expect(neutral.map((image) => image.slice(0, 8))).toEqual([PNG_SIGNATURE, PNG_SIGNATURE]);
    const sources = await Promise.all(owners.map((owner) => harness.svc.screens.projectionSource(owner)));
    expect(sources.every((source) => source !== undefined)).toBeTrue();
    const first = sources[0]!;
    const second = sources[1]!;
    for (const source of [first, second]) {
      expect({ width: source.videoWidth, height: source.videoHeight }).toEqual(
        selectedProfile === "1080p" ? { width: 1920, height: 1080 } : { width: 1280, height: 720 },
      );
    }

    for (let index = 0; index < owners.length; index += 1) {
      expect(statSync(path.join(runtimeDirs[index]!, "1")).mode & 0o777).toBe(0o700);
      for (const directory of ["config", "state", "cache"]) {
        expect(statSync(path.join(profileDirs[index]!, directory)).mode & 0o777).toBe(0o700);
      }
      const application = path.join(harness.home, `cage-isolation-${index}`);
      writeFileSync(application, [
        "#!/bin/sh",
        `printf '%s|%s|%s' "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME" > "$XDG_CONFIG_HOME/isolation-profile"`,
        index === 0
          ? "exec zenity --entry --title='FIRST CAGE SCREEN' --text='First isolated input'"
          : "exec zenity --question --title='SECOND CAGE SCREEN' --text='Second remains isolated' --ok-label='Close'",
        "",
      ].join("\n"));
      chmodSync(application, 0o700);
      await harness.svc.screens.act(
        owners[index]!,
        { name: "open_app", args: { app: application } },
        { ...owners[index]!, turnId: `cage-smoke-${index}` },
      );
    }

    const dialogs = await Promise.all([
      waitForPixels(first, neutral[0]!, "first Cage application"),
      waitForPixels(second, neutral[1]!, "second Cage application"),
    ]);
    expect(digest(dialogs[0]!)).not.toBe(digest(dialogs[1]!));
    expect(dialogs.every((image) => image.byteLength > PNG_SIGNATURE.byteLength)).toBeTrue();
    const profiles = profileDirs.map((profileDir) => readFileSync(path.join(profileDir, "config", "isolation-profile"), "utf8"));
    expect(profiles[0]).toContain(profileDirs[0]!);
    expect(profiles[1]).toContain(profileDirs[1]!);
    expect(profiles[0]).not.toBe(profiles[1]);

    await Promise.all([first.setInputAuthority(1), second.setInputAuthority(1)]);
    const firstInput = inputFor(first, 1);
    const secondInput = inputFor(second, 1);
    await firstInput({ type: "motion", x: 100, y: 120 });
    await firstInput({ type: "button", x: 100, y: 120, button: "left", state: "pressed" });
    await firstInput({ type: "motion", x: 500, y: 180 });
    await firstInput({ type: "button", x: 500, y: 180, button: "left", state: "released" });
    await firstInput({ type: "scroll", x: 500, y: 180, deltaX: 0, deltaY: -720 });
    await firstInput({ type: "key", keyCode: 29, state: "pressed" });
    await firstInput({ type: "key", keyCode: 30, state: "pressed" });
    await firstInput({ type: "key", keyCode: 30, state: "released" });
    await firstInput({ type: "key", keyCode: 29, state: "released" });
    await firstInput({ type: "paste", text: "FIRST-PASTE-λ" });
    const firstWithText = await waitForPixels(first, dialogs[0]!, "first Cage pointer, shortcut, and paste input");
    expect(await differingPixels(dialogs[1]!, (await second.capture()).bytes, harness.home, "second-isolation"))
      .toBeLessThan(10_000);

    await firstInput({ type: "key", keyCode: 42, state: "pressed" });
    await secondInput({ type: "key", keyCode: 28, state: "pressed" });
    await secondInput({ type: "key", keyCode: 28, state: "released" });
    const secondClosed = await waitForMatchingPixels(second, neutral[1]!, "second Cage keyboard input");
    expect(digest(secondClosed)).toBe(digest(neutral[1]!));
    expect(await differingPixels(firstWithText, (await first.capture()).bytes, harness.home, "first-isolation"))
      .toBeLessThan(10_000);
    await second.releaseInput(1);
    await first.releaseInput(1);
    await first.setInputAuthority(2);
    const resumedFirstInput = inputFor(first, 2);
    await resumedFirstInput({ type: "key", keyCode: 28, state: "pressed" });
    await resumedFirstInput({ type: "key", keyCode: 28, state: "released" });
    const firstClosed = await waitForMatchingPixels(first, neutral[0]!, "first Cage application exit");
    expect(digest(firstClosed)).toBe(digest(neutral[0]!));
    await first.releaseInput(2);
    expect(owners.map((owner) => harness.svc.screens.status(owner).state)).toEqual(["ready", "ready"]);

    for (let index = 0; index < owners.length; index += 1) {
      const deleted = await api<{ status: string }>(harness, "DELETE", `/api/bots/${owners[index]!.botId}`, {});
      expect(deleted.status).toBe("deleted");
      expect(existsSync(runtimeDirs[index]!)).toBeFalse();
      expect(existsSync(profileDirs[index]!)).toBeFalse();
    }
    await expect(first.capture()).rejects.toThrow("unknown Computer Surface");
    await expect(second.capture()).rejects.toThrow("unknown Computer Surface");

    const cycleBotId = await makeBot(harness, "Repeated Cage lifecycle");
    const cycleBot = await api<{ surfaceId: SurfaceId }>(harness, "GET", `/api/bots/${cycleBotId}`);
    expect(surfaceIds.has(cycleBot.surfaceId)).toBeFalse();
    surfaceIds.add(cycleBot.surfaceId);
    const cycleOwner = { botId: cycleBotId, surfaceId: cycleBot.surfaceId };
    const cycleResponse = await fetch(
      `${harness.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(cycleBotId)}&surfaceId=${encodeURIComponent(cycleBot.surfaceId)}`,
    );
    expect(cycleResponse.status).toBe(200);
    const cycleRuntimeDir = path.join(harness.svc.cfg.botScreenRuntimeDir, cycleBot.surfaceId);
    const cycleProfileDir = path.join(harness.svc.cfg.botScreenProfileDir, cycleBot.surfaceId);
    runtimeDirs.push(cycleRuntimeDir);
    profileDirs.push(cycleProfileDir);
    const cycleSource = await harness.svc.screens.projectionSource(cycleOwner);
    expect(cycleSource).toMatchObject({ surfaceId: cycleBot.surfaceId, runtimeGeneration: 1, geometryGeneration: 1 });
    expect((await api<{ status: string }>(harness, "DELETE", `/api/bots/${cycleBotId}`, {})).status).toBe("deleted");
    expect(existsSync(cycleRuntimeDir)).toBeFalse();
    expect(existsSync(cycleProfileDir)).toBeFalse();
    await expect(cycleSource!.capture()).rejects.toThrow("unknown Computer Surface");
  } finally {
    await harness.stop();
  }

  expect(runtimeDirs).toHaveLength(3);
  expect(profileDirs).toHaveLength(3);
  expect(runtimeDirs.every((directory) => !existsSync(directory))).toBeTrue();
  expect(profileDirs.every((directory) => !existsSync(directory))).toBeTrue();
  const processes = await run(["ps", "-eo", "args"]);
  for (const runtimeDir of runtimeDirs) expect(processes).not.toContain(path.basename(runtimeDir));
  if (
    Bun.which("systemctl") !== null
    && process.env.XDG_RUNTIME_DIR !== undefined
    && existsSync(path.join(process.env.XDG_RUNTIME_DIR, "systemd", "private"))
  ) {
    const units = await run(["systemctl", "--user", "list-units", "--all", "--plain", "--no-legend", "omarchy-bot-screen-*"]);
    for (const surfaceId of surfaceIds) {
      expect(units).not.toContain(surfaceId.slice("surf_".length));
    }
  }
}, 90_000);
