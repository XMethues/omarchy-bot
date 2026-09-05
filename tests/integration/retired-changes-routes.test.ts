import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { apiStatus, makeBot, startDaemon, type Harness } from "./helpers/harness.ts";

let h: Harness;

beforeAll(async () => {
  h = await startDaemon();
}, 30_000);

afterAll(async () => {
  await h?.stop();
});

describe("retired Changes HTTP API", () => {
  test("retired Changes endpoints follow ordinary missing-interface behavior", async () => {
    const botId = await makeBot(h, "Retired Changes Bot");
    for (const requestPath of [
      `/api/bots/${botId}/changes`,
      `/api/bots/${botId}/changes?threadId=thread_unused`,
      `/api/bots/${botId}/changes/detail?path=src/modified.ts`,
    ]) {
      const response = await apiStatus(h, "GET", requestPath);
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: "not found" });
      expect(response.body).not.toEqual(expect.objectContaining({ state: "clean" }));
      expect(response.body).not.toEqual(expect.objectContaining({ state: "ready" }));
    }
  });
});
