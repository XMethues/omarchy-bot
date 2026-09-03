import { expect, test } from "bun:test";
import {
  ensureInputHelper,
} from "../../apps/daemon/native/pointer-helper/build.ts";

const SURFACE_ID = "surf_11111111111111111111111111111111";
const CONTEXT = `${SURFACE_ID} 3 1`;
const PROTOCOL_FIXTURE = [
  `motion 1 ${CONTEXT} 7 1 0 0`,
  `authority 2 ${CONTEXT} 7`,
  `motion 3 ${CONTEXT} 7 1 0 0`,
  `button 4 surf_22222222222222222222222222222222 3 1 7 2 10 10 272 1`,
  `button 5 ${SURFACE_ID} 2 1 7 2 10 10 272 1`,
  `button 6 ${SURFACE_ID} 3 2 7 2 10 10 272 1`,
  `button 7 ${CONTEXT} 6 2 10 10 272 1`,
  `motion 8 ${CONTEXT} 7 1 1 1`,
  `button 9 ${CONTEXT} 7 2 10 10 272 1`,
  `release 10 ${CONTEXT} 6`,
  `release 11 ${CONTEXT} 7`,
  `key 12 ${CONTEXT} 7 3 29 1`,
  `authority 13 ${CONTEXT} 7`,
  `authority 14 ${CONTEXT} 8`,
  `paste 15 ${CONTEXT} 8 10 b25lLXdheSDOuSBwYXN0ZQ==`,
  `release 16 ${CONTEXT} 0`,
  `authority 16 ${CONTEXT} 9`,
  `authority 17 ${CONTEXT} -1`,
  `authority 18 ${CONTEXT} 9`,
  "",
].join("\n");

const EXPECTED_RESPONSES = [
  "READY fixture",
  "ERR 1 invalid-envelope",
  "OK 2",
  "OK 3",
  "ERR 4 invalid-envelope",
  "ERR 5 invalid-envelope",
  "ERR 6 invalid-envelope",
  "ERR 7 invalid-envelope",
  "ERR 8 invalid-envelope",
  "OK 9",
  "ERR 10 invalid-release",
  "OK 11",
  "ERR 12 invalid-envelope",
  "ERR 13 invalid-authority",
  "OK 14",
  "OK 15",
  "OK 16",
  "ERR 16 stale-request",
  "ERR 17 invalid-authority",
  "OK 18",
  "",
].join("\n");

test("native input helper accepts only explicitly authorized current envelopes and survives rejection", async () => {
  const binary = await ensureInputHelper();
  const helper = Bun.spawn([binary, "--fixture", SURFACE_ID, "3", "1", "1920", "1080"], {
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
