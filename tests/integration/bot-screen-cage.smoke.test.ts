import { expect, test } from "bun:test";
import { chmodSync, existsSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BotScreenInputAction } from "../../apps/daemon/src/modules/computer/botScreenManager.ts";
import type { SurfaceId } from "../../packages/domain/src/ids.ts";
import { api, makeBot, startDaemon, type Harness } from "./helpers/harness.ts";

const platformTest = process.env.OMARCHY_BOT_REAL_CAGE_SMOKE === "1" ? test : test.skip;

function digest(bytes: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

platformTest("one selectable Cage Screen stays ready across a real transient application dialog", async () => {
  if (Bun.which("cage") === null || Bun.which("wlr-randr") === null || Bun.which("grim") === null) {
    throw new Error("real Cage smoke requires cage, wlr-randr, and grim");
  }
  if (Bun.which("zenity") === null) throw new Error("real Cage smoke requires zenity as its transient-dialog fixture");
  const previousRuntime = process.env.OMARCHY_BOT_SCREEN_RUNTIME;
  const previousProfile = process.env.OMARCHY_BOT_SCREEN_PROFILE;
  const selectedProfile = process.env.OMARCHY_BOT_CAGE_SMOKE_PROFILE ?? "720p";
  process.env.OMARCHY_BOT_SCREEN_RUNTIME = "cage";
  process.env.OMARCHY_BOT_SCREEN_PROFILE = selectedProfile;
  let harness: Harness;
  try {
    harness = await startDaemon(undefined, { useProductionBotScreen: true, botScreenCapacity: 1 });
  } finally {
    if (previousRuntime === undefined) delete process.env.OMARCHY_BOT_SCREEN_RUNTIME;
    else process.env.OMARCHY_BOT_SCREEN_RUNTIME = previousRuntime;
    if (previousProfile === undefined) delete process.env.OMARCHY_BOT_SCREEN_PROFILE;
    else process.env.OMARCHY_BOT_SCREEN_PROFILE = previousProfile;
  }
  try {
    const botId = await makeBot(harness, "Real Cage Screen");
    const bot = await api<{ surfaceId: SurfaceId }>(harness, "GET", `/api/bots/${botId}`);
    const owner = { botId, surfaceId: bot.surfaceId };
    const opening = await fetch(
      `${harness.baseUrl}/api/computer/snapshot?botId=${encodeURIComponent(botId)}&surfaceId=${encodeURIComponent(bot.surfaceId)}`,
    );
    expect(opening.status).toBe(200);
    const neutral: Uint8Array<ArrayBufferLike> = new Uint8Array(await opening.arrayBuffer());
    const source = await harness.svc.screens.projectionSource(owner);
    expect(source).toBeDefined();
    expect({ width: source!.videoWidth, height: source!.videoHeight }).toEqual(
      selectedProfile === "1080p"
        ? { width: 1920, height: 1080 }
        : { width: 1280, height: 720 },
    );
    const runtimeDir = path.join(harness.svc.cfg.botScreenRuntimeDir, bot.surfaceId, "1");
    const profileDir = path.join(harness.svc.cfg.botScreenProfileDir, bot.surfaceId);
    expect(statSync(runtimeDir).mode & 0o777).toBe(0o700);
    for (const directory of ["config", "state", "cache"]) {
      expect(statSync(path.join(profileDir, directory)).mode & 0o777).toBe(0o700);
    }

    const dialog = path.join(harness.home, "cage-transient-dialog");
    writeFileSync(dialog, [
      "#!/bin/sh",
      "exec zenity --question --title='Cage transient dialog' --text='Visible and controllable' --ok-label='Close'",
      "",
    ].join("\n"));
    chmodSync(dialog, 0o700);
    await harness.svc.screens.act(owner, { name: "open_app", args: { app: dialog } });
    let dialogCapture: Uint8Array<ArrayBufferLike> = neutral;
    const visibleDeadline = Date.now() + 5_000;
    while (digest(dialogCapture) === digest(neutral) && Date.now() < visibleDeadline) {
      // Platform smoke waits on a real Wayland commit; no deterministic clock can drive an external compositor.
      await Bun.sleep(20);
      dialogCapture = (await source!.capture()).bytes;
    }
    expect(digest(dialogCapture)).not.toBe(digest(neutral));

    await source!.setInputAuthority(1);
    let sequence = 0;
    const input = (action: BotScreenInputAction): Promise<void> => source!.input({
      surfaceId: source!.surfaceId,
      runtimeGeneration: source!.runtimeGeneration,
      geometryGeneration: source!.geometryGeneration,
      controllerEpoch: 1,
      sequence: ++sequence,
      ...action,
    });
    await input({ type: "motion", x: source!.logicalWidth / 2, y: source!.logicalHeight / 2 });
    await input({
      type: "button",
      x: source!.logicalWidth / 2,
      y: source!.logicalHeight / 2,
      button: "left",
      state: "pressed",
    });
    await input({
      type: "button",
      x: source!.logicalWidth / 2,
      y: source!.logicalHeight / 2,
      button: "left",
      state: "released",
    });
    await input({
      type: "scroll",
      x: source!.logicalWidth / 2,
      y: source!.logicalHeight / 2,
      deltaX: 0,
      deltaY: -120,
    });
    await input({ type: "paste", text: "one-way Cage paste" });
    await input({ type: "key", keyCode: 28, state: "pressed" });
    await input({ type: "key", keyCode: 28, state: "released" });
    await source!.releaseInput(1);

    let restored: Uint8Array<ArrayBufferLike> = dialogCapture;
    const closedDeadline = Date.now() + 5_000;
    while (digest(restored) !== digest(neutral) && Date.now() < closedDeadline) {
      // Application exit is observed through pixels while the persistent Desktop and worker stay alive.
      await Bun.sleep(20);
      restored = (await source!.capture()).bytes;
    }
    expect(digest(restored)).toBe(digest(neutral));
    expect(harness.svc.screens.status(owner).state).toBe("ready");
    await expect(harness.svc.screens.act(owner, { name: "screenshot", args: {} })).resolves.toHaveProperty("image");

    const deleted = await api<{ status: string }>(harness, "DELETE", `/api/bots/${botId}`, {});
    expect(deleted.status).toBe("deleted");
    expect(existsSync(path.join(harness.svc.cfg.botScreenRuntimeDir, bot.surfaceId))).toBeFalse();
    expect(existsSync(profileDir)).toBeFalse();
  } finally {
    await harness.stop();
  }
}, 45_000);
