import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../../apps/daemon/src/bootstrap/config.ts";

const original = {
  capacity: process.env.OMARCHY_BOT_SCREEN_CAPACITY,
  profile: process.env.OMARCHY_BOT_SCREEN_PROFILE,
  frameRate: process.env.OMARCHY_BOT_SCREEN_FRAME_RATE,
  webRtcPort: process.env.OMARCHY_BOT_SCREEN_WEBRTC_PORT,
  host: process.env.OMARCHY_BOT_HOST,
  home: process.env.OMARCHY_BOT_HOME,
  state: process.env.OMARCHY_BOT_STATE,
};
let temporaryRoot: string | undefined;


afterEach(() => {
  for (const [name, value] of [
    ["OMARCHY_BOT_SCREEN_CAPACITY", original.capacity],
    ["OMARCHY_BOT_SCREEN_PROFILE", original.profile],
    ["OMARCHY_BOT_SCREEN_FRAME_RATE", original.frameRate],
    ["OMARCHY_BOT_SCREEN_WEBRTC_PORT", original.webRtcPort],
    ["OMARCHY_BOT_HOST", original.host],
    ["OMARCHY_BOT_HOME", original.home],
    ["OMARCHY_BOT_STATE", original.state],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  if (temporaryRoot !== undefined) rmSync(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

test("selects the measured 720p Bot Screen fallback from configuration", () => {
  process.env.OMARCHY_BOT_SCREEN_CAPACITY = "2";
  process.env.OMARCHY_BOT_SCREEN_PROFILE = "720p";
  process.env.OMARCHY_BOT_SCREEN_FRAME_RATE = "15";
  process.env.OMARCHY_BOT_SCREEN_WEBRTC_PORT = "7433";
  temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-screen-config-"));
  process.env.OMARCHY_BOT_HOME = path.join(temporaryRoot, "data");
  process.env.OMARCHY_BOT_STATE = path.join(temporaryRoot, "state");

  expect(loadConfig()).toMatchObject({
    botScreenCapacity: 2,
    botScreenProfile: "720p",
    botScreenLogicalWidth: 1280,
    botScreenLogicalHeight: 720,
    botScreenFrameRate: 15,
    botScreenWebRtcPort: 7433,
  });
});

test("keeps HTTP loopback-only unless LAN binding is explicitly configured", () => {
  temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-screen-config-"));
  process.env.OMARCHY_BOT_HOME = path.join(temporaryRoot, "data");
  process.env.OMARCHY_BOT_STATE = path.join(temporaryRoot, "state");
  delete process.env.OMARCHY_BOT_HOST;

  expect(loadConfig().host).toBe("127.0.0.1");

  process.env.OMARCHY_BOT_HOST = "0.0.0.0";
  expect(loadConfig().host).toBe("0.0.0.0");
});

test("uses the measured conservative Bot Screen default", () => {
  delete process.env.OMARCHY_BOT_SCREEN_CAPACITY;
  delete process.env.OMARCHY_BOT_SCREEN_PROFILE;
  delete process.env.OMARCHY_BOT_SCREEN_FRAME_RATE;
  delete process.env.OMARCHY_BOT_SCREEN_WEBRTC_PORT;
  temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "omarchy-bot-screen-config-"));
  process.env.OMARCHY_BOT_HOME = path.join(temporaryRoot, "data");
  process.env.OMARCHY_BOT_STATE = path.join(temporaryRoot, "state");

  expect(loadConfig()).toMatchObject({
    botScreenCapacity: 4,
    botScreenProfile: "1080p",
    botScreenLogicalWidth: 1920,
    botScreenLogicalHeight: 1080,
    botScreenFrameRate: 16,
    botScreenWebRtcPort: 7323,
  });
});
