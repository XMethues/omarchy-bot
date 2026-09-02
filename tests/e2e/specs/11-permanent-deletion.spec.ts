import { expect, test, type Locator, type Page } from "@playwright/test";

async function createBot(page: Page, name: string): Promise<string> {
  await page.getByTestId("sidebar-create-bot").click();
  await page.getByTestId("create-bot-name").fill(name);
  await page.getByTestId("create-bot-instructions").fill("Permanent deletion E2E bot");
  await page.getByRole("radio", { name: /^Pi/ }).check();
  await page.getByTestId("create-bot-submit").click();
  const row = page.locator("[data-testid^='sidebar-bot-']", { hasText: name });
  await expect(row).toBeVisible();
  const testId = await row.getAttribute("data-testid");
  if (testId === null) throw new Error(`missing sidebar test id for ${name}`);
  return testId.slice("sidebar-bot-".length);
}

function composerInput(page: Page): Locator {
  return page.getByTestId("composer").locator('[contenteditable="true"]');
}

async function archive(page: Page, botId: string): Promise<void> {
  await page.getByTestId(`sidebar-bot-actions-${botId}`).click();
  await page.getByRole("menuitem", { name: /Archive/ }).click();
}

test.describe("permanent archived Bot deletion", () => {
  test("names the Bot and owned data, cancels without effects, then removes it and stale window drafts", async ({ page }) => {
    await page.goto("/");
    await createBot(page, "Deletion fallback");
    const botName = "Delete this archived Bot";
    const botId = await createBot(page, botName);
    await composerInput(page).fill("known draft before archive");
    await archive(page, botId);
    await expect(page.getByTestId(`sidebar-bot-${botId}`)).toHaveCount(0);
    await expect.poll(() => new URL(page.url()).searchParams.get("bot")).not.toBe(botId);

    const staleDraftKey = `draft:v1:${botId}:blank`;
    await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), {
      key: staleDraftKey,
      value: JSON.stringify({ text: "stale draft", cursor: 11, stagedIds: [] }),
    });
    await page.getByTestId("sidebar-settings").click();
    const archivedRow = page.getByTestId(`settings-archived-bot-${botId}`);
    await expect(archivedRow).toBeVisible();

    await page.getByTestId(`settings-delete-${botId}`).click();
    const confirmation = page.getByTestId("permanent-delete-confirmation");
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText(botName);
    await expect(confirmation).toContainText("Threads");
    await expect(confirmation).toContainText("local managed data");

    await page.getByRole("button", { name: "Keep archived Bot" }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(archivedRow).toBeVisible();
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), staleDraftKey)).not.toBeNull();

    await page.getByTestId(`settings-delete-${botId}`).click();
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(archivedRow).toHaveCount(0);
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), staleDraftKey)).toBeNull();
    const deleted = await page.request.get(`/api/bots/${botId}`);
    expect(deleted.status()).toBe(404);

    await page.reload();
    await page.getByTestId("sidebar-settings").click();
    await expect(page.getByTestId(`settings-archived-bot-${botId}`)).toHaveCount(0);
  });
});
