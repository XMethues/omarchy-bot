import { expect, test, type Locator, type Page } from "@playwright/test";

async function createBot(page: Page, name: string): Promise<string> {
  await page.getByRole("navigation", { name: "Bot navigation" }).getByRole("button", { name: "New bot" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("textbox", { name: "Job / Instructions" }).fill("Permanent deletion E2E bot");
  await page.getByRole("radio", { name: /^Pi/ }).check();
  await page.getByRole("button", { name: "Create bot" }).click();
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  const botId = new URL(page.url()).searchParams.get("bot");
  if (botId === null) throw new Error(`missing selected bot id for ${name}`);
  return botId;
}

function composerInput(page: Page): Locator {
  return page.getByRole("textbox", { name: "Message input" });
}

async function archive(page: Page, botName: string): Promise<void> {
  await page.getByRole("navigation", { name: "Bot navigation" })
    .getByRole("button", { name: `Actions for ${botName}` })
    .click();
  await page.getByRole("menuitem", { name: /Archive/ }).click();
}

test.describe("permanent archived Bot deletion", () => {
  test("names the Bot and owned data, cancels without effects, then removes it and stale window drafts", async ({ page }) => {
    await page.goto("/");
    await createBot(page, "Deletion fallback");
    const botName = "Delete this archived Bot";
    const botId = await createBot(page, botName);
    await composerInput(page).fill("known draft before archive");
    await archive(page, botName);
    await expect(page.getByRole("button", { name: botName, exact: true })).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("bot")).not.toBe(botId);

    const staleDraftKey = `draft:v1:${botId}:blank`;
    await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), {
      key: staleDraftKey,
      value: JSON.stringify({ text: "stale draft", cursor: 11, stagedIds: [] }),
    });
    await page.getByRole("navigation", { name: "Bot navigation" }).getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    const deleteButton = settings.getByRole("button", { name: `Permanently delete ${botName}` });
    await expect(deleteButton).toBeVisible();

    await deleteButton.click();
    const confirmation = page.getByRole("alertdialog", { name: `Permanently delete ${botName}?` });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(botName);
    await expect(confirmation).toContainText("Threads");
    await expect(confirmation).toContainText("local managed data");

    await page.getByRole("button", { name: "Keep archived Bot" }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(deleteButton).toBeVisible();
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), staleDraftKey)).not.toBeNull();

    await deleteButton.click();
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(deleteButton).toHaveCount(0);
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), staleDraftKey)).toBeNull();
    const deleted = await page.request.get(`/api/bots/${botId}`);
    expect(deleted.status()).toBe(404);

    await page.reload();
    await page.getByRole("navigation", { name: "Bot navigation" }).getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: `Permanently delete ${botName}` })).toHaveCount(0);
  });
});
