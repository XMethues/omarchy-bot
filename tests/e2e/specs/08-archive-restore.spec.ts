import { expect, test, type Locator, type Page } from "@playwright/test";

async function createBot(page: Page, name: string): Promise<string> {
  await page.getByTestId("sidebar-create-bot").click();
  await page.getByTestId("create-bot-name").fill(name);
  await page.getByTestId("create-bot-instructions").fill("Archive lifecycle E2E bot");
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

async function archiveFromSidebar(page: Page, botId: string): Promise<void> {
  await page.getByTestId(`sidebar-bot-actions-${botId}`).click();
  await page.getByRole("menuitem", { name: /Archive/ }).click();
}

async function sendAndWait(page: Page, text: string): Promise<void> {
  await composerInput(page).fill(text);
  await composerInput(page).press("Enter");
  await page.waitForURL((url) => {
    const threadId = url.searchParams.get("thread");
    return threadId !== null && threadId !== "blank";
  });
  await expect(page.getByTestId("assistant-message").last()).toBeVisible({ timeout: 15_000 });
}

test.describe("archive and restore bots", () => {
  test("archives an idle bot, clears its window drafts, falls back, and restores it from Settings", async ({ page }) => {
    await page.goto("/");
    const fallbackBotId = await createBot(page, "Archive fallback bot");
    await sendAndWait(page, "say: fallback remains active");

    const archivedBotId = await createBot(page, "Idle archive bot");
    await composerInput(page).fill("draft that must be cleared");
    const draftKey = `draft:v1:${archivedBotId}:blank`;
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), draftKey)).not.toBeNull();

    await archiveFromSidebar(page, archivedBotId);

    await expect(page.getByTestId(`sidebar-bot-${archivedBotId}`)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`(?:\\?|&)bot=${fallbackBotId}(?:&|$)`));
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), draftKey)).toBeNull();

    await page.getByTestId("sidebar-settings").click();
    await expect(page.getByTestId(`settings-archived-bot-${archivedBotId}`)).toBeVisible();
    await page.getByTestId(`settings-restore-${archivedBotId}`).click();

    await expect(page.getByTestId(`settings-archived-bot-${archivedBotId}`)).toHaveCount(0);
    await expect(page.getByTestId(`sidebar-bot-${archivedBotId}`)).toBeVisible();
    const firstActiveTestId = await page.locator("[data-testid^='sidebar-bot-bot_']").first().getAttribute("data-testid");
    expect(firstActiveTestId).toBe(`sidebar-bot-${archivedBotId}`);
  });

  test("keeps active work on cancel, then stops and archives only after confirmation", async ({ page }) => {
    await page.goto("/");
    const fallbackBotId = await createBot(page, "Working archive fallback");
    await sendAndWait(page, "say: fallback conversation");

    const workingBotId = await createBot(page, "Working archive bot");
    await composerInput(page).fill("hang");
    await composerInput(page).press("Enter");
    await expect(page.getByTestId("streaming-message")).toContainText("hanging", { timeout: 15_000 });

    await archiveFromSidebar(page, workingBotId);
    const confirmation = page.getByTestId("archive-working-confirmation");
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("current work will be stopped");

    await page.getByRole("button", { name: "Keep working" }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(page.getByTestId(`sidebar-bot-${workingBotId}`)).toBeVisible();
    await expect(page.getByTestId("streaming-message")).toContainText("hanging");

    await archiveFromSidebar(page, workingBotId);
    await page.getByRole("button", { name: "Stop and archive" }).click();

    await expect(page.getByTestId(`sidebar-bot-${workingBotId}`)).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`(?:\\?|&)bot=${fallbackBotId}(?:&|$)`));

    await page.getByTestId("sidebar-settings").click();
    await expect(page.getByTestId(`settings-archived-bot-${workingBotId}`)).toBeVisible();
  });
});
