import { expect, test } from "bun:test";
import {
  ensureInputHelper,
} from "../../apps/daemon/native/pointer-helper/build.ts";

const PROTOCOL_FIXTURE = [
  "motion 1 0 0 1920 1080",
  "button 2 272 1",
  "motion 3 1919 1079 1920 1080",
  "button 4 272 0",
  "scroll 5 -24 120",
  "key 6 29 1",
  "key 7 38 1",
  "key 8 38 0",
  "key 9 29 0",
  "paste 10 b25lLXdheSDOuSBwYXN0ZQ==",
  "release 11",
  "",
].join("\n");

const EXPECTED_RESPONSES = [
  "READY fixture",
  "OK 1 motion",
  "OK 2 button",
  "OK 3 motion",
  "OK 4 button",
  "OK 5 scroll",
  "OK 6 key",
  "OK 7 key",
  "OK 8 key",
  "OK 9 key",
  "OK 10 paste",
  "OK 11 release",
  "",
].join("\n");

test("native Wayland input helper accepts the deterministic ordered pointer, keyboard, and paste fixture", async () => {
  const binary = await ensureInputHelper();
  const helper = Bun.spawn([binary, "--fixture"], {
    stdin: new Blob([PROTOCOL_FIXTURE]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    helper.exited,
    new Response(helper.stdout).text(),
    new Response(helper.stderr).text(),
  ]);
  expect({ status, stdout, stderr }).toEqual({
    status: 0,
    stdout: EXPECTED_RESPONSES,
    stderr: "",
  });
});
