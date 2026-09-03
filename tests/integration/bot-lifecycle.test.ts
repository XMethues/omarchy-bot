import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { BotViewDto } from "../../packages/protocol/src/index.ts";
import { api, apiStatus, makeBot, startDaemon, type Harness } from "./helpers/harness.ts";

describe("Bot lifecycle", () => {
  let h: Harness;

  beforeEach(async () => {
    h = await startDaemon();
  });

  afterEach(async () => {
    await h.stop();
  });

  test("has one visible population with no archived projection", async () => {
    const firstId = await makeBot(h, "First Bot");
    const secondId = await makeBot(h, "Second Bot");

    const bots = await api<BotViewDto[]>(h, "GET", "/api/bots");
    const queryVariant = await api<BotViewDto[]>(h, "GET", "/api/bots?includeArchived=1");

    expect(bots.map((bot) => bot.id).sort()).toEqual([firstId, secondId].sort());
    expect(queryVariant).toEqual(bots);
    for (const bot of bots) expect(bot).not.toHaveProperty("archived");
  });

  test("removes archive and restore commands while permanent deletion remains", async () => {
    const botId = await makeBot(h, "Delete directly");

    expect(await apiStatus(h, "POST", `/api/bots/${botId}/archive`, {})).toEqual({
      status: 404,
      body: { error: "not found" },
    });
    expect(await apiStatus(h, "POST", `/api/bots/${botId}/restore`, {})).toEqual({
      status: 404,
      body: { error: "not found" },
    });

    const deletion = await apiStatus(h, "DELETE", `/api/bots/${botId}`, {});
    expect(deletion.status).toBe(200);
    expect(deletion.body).toMatchObject({ status: "deleted", botId });
    expect((await api<BotViewDto[]>(h, "GET", "/api/bots")).some((bot) => bot.id === botId)).toBeFalse();
  });
});
