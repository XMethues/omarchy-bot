import { expect, test, type Locator, type Page } from "@playwright/test";

async function createBot(page: Page, name: string): Promise<string> {
  await page.getByTestId("sidebar-create-bot").click();
  await page.getByTestId("create-bot-name").fill(name);
  await page.getByTestId("create-bot-instructions").fill("Own thread history tests");
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

async function send(page: Page, text: string): Promise<string> {
  const input = composerInput(page);
  await input.fill(text);
  await input.press("Enter");
  await page.waitForURL((url) => {
    const threadId = url.searchParams.get("thread");
    return threadId !== null && threadId !== "blank";
  });
  await expect(page.getByTestId("assistant-message").last()).toBeVisible();
  return new URL(page.url()).searchParams.get("thread")!;
}

async function openHistory(page: Page): Promise<void> {
  await page.getByTestId("thread-history-trigger").click();
  await expect(page.getByTestId("history-dialog")).toBeVisible();
}

test.describe("thread history and window drafts", () => {
  test("searches history, opens a blank conversation lazily, and restores isolated drafts", async ({ page }) => {
    await page.goto("/");
    const botId = await createBot(page, "History E2E Bot");
    const firstThreadId = await send(page, "say: First history answer");

    await openHistory(page);
    await page.getByTestId("history-search").fill("does not exist");
    await expect(page.getByText("No matching conversations")).toBeVisible();
    await page.getByTestId("history-search").fill("First history");
    await expect(page.getByTestId(`history-thread-${firstThreadId}`)).toBeVisible();
    await page.getByTestId("history-new-conversation").click();
    await expect(page).toHaveURL(new RegExp(`(?:\\?|&)bot=${botId}(?:&|$)`));
    await expect(page).toHaveURL(/(?:\?|&)thread=blank(?:&|$)/);

    await composerInput(page).fill("blank conversation draft");
    await openHistory(page);
    await page.getByTestId(`history-thread-${firstThreadId}`).click();
    await expect(page).toHaveURL(new RegExp(`(?:\\?|&)thread=${firstThreadId}(?:&|$)`));
    await expect(composerInput(page)).toHaveText("");

    await composerInput(page).fill("first thread draft");
    await openHistory(page);
    await page.getByTestId("history-new-conversation").click();
    await expect(composerInput(page)).toHaveText("blank conversation draft");

    await openHistory(page);
    await page.getByTestId(`history-thread-${firstThreadId}`).click();
    await expect(composerInput(page)).toHaveText("first thread draft");
  });

  test("restores after refresh without sharing a draft with a second page", async ({ page }) => {
    await page.goto("/");
    await createBot(page, "Window Draft E2E Bot");
    await send(page, "say: Window draft thread");
    await composerInput(page).fill("only in the first window");
    const selectedUrl = page.url();

    await page.reload();
    await expect(composerInput(page)).toHaveText("only in the first window");

    const secondPage = await page.context().newPage();
    try {
      await secondPage.goto(selectedUrl);
      await expect(composerInput(secondPage)).toHaveText("");
      await composerInput(secondPage).fill("second window draft");
      await expect(composerInput(page)).toHaveText("only in the first window");
    } finally {
      await secondPage.close();
    }
  });

  test("cleans stale window drafts when their owning bot is archived", async ({ page }) => {
    await page.goto("/");
    const botId = await createBot(page, "Archived Draft E2E Bot");
    await composerInput(page).fill("must not resurface");
    const key = `draft:v1:${botId}:blank`;
    await expect.poll(() => page.evaluate((storageKey) => sessionStorage.getItem(storageKey), key)).not.toBeNull();

    const response = await page.request.post(`/api/bots/${botId}/archive`, { data: {} });
    expect(response.ok()).toBeTruthy();
    await page.reload();

    await expect.poll(() => page.evaluate((storageKey) => sessionStorage.getItem(storageKey), key)).toBeNull();
  });
});
