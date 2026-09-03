import { expect, test, type Locator, type Page } from "@playwright/test";

async function createBot(page: Page, name: string): Promise<string> {
  await page.getByRole("navigation", { name: "Bot navigation" }).getByRole("button", { name: "New bot" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("textbox", { name: "Job / Instructions" }).fill("Archive lifecycle E2E bot");
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

async function archiveFromSidebar(page: Page, botName: string): Promise<void> {
  await page.getByRole("navigation", { name: "Bot navigation" })
    .getByRole("button", { name: `Actions for ${botName}` })
    .click();
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

    await archiveFromSidebar(page, "Idle archive bot");

    await expect(page.getByRole("button", { name: "Idle archive bot", exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`(?:\\?|&)bot=${fallbackBotId}(?:&|$)`));
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), draftKey)).toBeNull();

    await page.getByRole("navigation", { name: "Bot navigation" }).getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings.getByRole("button", { name: "Restore Idle archive bot" })).toBeVisible();
    await settings.getByRole("button", { name: "Restore Idle archive bot" }).click();

    await expect(settings.getByRole("button", { name: "Restore Idle archive bot" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Idle archive bot", exact: true })).toBeVisible();
    const firstActiveBot = page.getByRole("navigation", { name: "Bot navigation" })
      .getByRole("button", { name: /^(?:Idle archive bot|Archive fallback bot)$/ })
      .first();
    await expect(firstActiveBot).toHaveAccessibleName("Idle archive bot");
  });

  test("keeps active work on cancel, then stops and archives only after confirmation", async ({ page }) => {
    await page.goto("/");
    const fallbackBotId = await createBot(page, "Working archive fallback");
    await sendAndWait(page, "say: fallback conversation");

    const workingBotId = await createBot(page, "Working archive bot");
    await composerInput(page).fill("hang");
    await composerInput(page).press("Enter");
    await expect(page.getByTestId("streaming-message")).toContainText("hanging", { timeout: 15_000 });

    await archiveFromSidebar(page, "Working archive bot");
    const confirmation = page.getByRole("alertdialog", { name: "Stop work and archive?" });
    await expect(confirmation).toBeVisible();
    await expect(confirmation).toContainText("current work will be stopped");

    await page.getByRole("button", { name: "Keep working" }).click();
    await expect(confirmation).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Working archive bot", exact: true })).toBeVisible();
    await expect(page.getByTestId("streaming-message")).toContainText("hanging");

    await archiveFromSidebar(page, "Working archive bot");
    await page.getByRole("button", { name: "Stop and archive" }).click();

    await expect(page.getByRole("button", { name: "Working archive bot", exact: true })).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`(?:\\?|&)bot=${fallbackBotId}(?:&|$)`));

    await page.getByRole("navigation", { name: "Bot navigation" }).getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Settings" }).getByRole("button", { name: "Restore Working archive bot" })).toBeVisible();
  });
});
