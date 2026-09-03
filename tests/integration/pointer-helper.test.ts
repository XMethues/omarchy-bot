import { expect, test } from "bun:test";
import {
  ensurePointerHelper,
} from "../../apps/daemon/native/pointer-helper/build.ts";

const PROTOCOL_FIXTURE = [
  "motion 1 0 0 1920 1080",
  "button 2 272 1",
  "motion 3 1919 1079 1920 1080",
  "button 4 272 0",
  "scroll 5 -24 120",
  "release 6",
  "",
].join("\n");

const EXPECTED_RESPONSES = [
  "READY fixture",
  "OK 1 motion",
  "OK 2 button",
  "OK 3 motion",
  "OK 4 button",
  "OK 5 scroll",
  "OK 6 release",
  "",
].join("\n");

test("native pointer helper accepts the deterministic ordered runtime protocol fixture", async () => {
  const binary = await ensurePointerHelper();
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
