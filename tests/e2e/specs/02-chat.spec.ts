import { expect, test, type Locator, type Page } from "@playwright/test";

async function createBot(page: Page, name: string): Promise<string> {
  await page.getByRole("navigation", { name: "Bot navigation" }).getByRole("button", { name: "New bot" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("textbox", { name: "Job / Instructions" }).fill("E2E chat teammate");
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

async function send(page: Page, text: string): Promise<void> {
  const input = composerInput(page);
  await expect(input).toBeEnabled();
  await input.fill(text);
  await input.press("Enter");
}

async function waitForPersistedThread(page: Page): Promise<string> {
  await page.waitForURL((url) => {
    const threadId = url.searchParams.get("thread");
    return threadId !== null && threadId !== "blank";
  });
  const threadId = new URL(page.url()).searchParams.get("thread");
  if (threadId === null || threadId === "blank") throw new Error("thread URL state was not persisted");
  return threadId;
}

test.describe("chat through a bot", () => {
  test("abandons a blank draft without creating a thread", async ({ page, request }) => {
    await page.goto("/");
    const botId = await createBot(page, "Blank Conversation Bot");
    await expect(page).toHaveURL(/(?:\?|&)thread=blank(?:&|$)/);

    await composerInput(page).fill("never sent");
    await page.waitForTimeout(200);

    const response = await request.get(`/api/bots/${botId}/threads`);
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual([]);
  });

  test("lazily creates a thread, streams, completes, restores URL state, and reopens the recent thread", async ({ page }) => {
    await page.goto("/");
    const botId = await createBot(page, "Streaming Bot");

    await send(page, "say: hello streaming");
    const threadId = await waitForPersistedThread(page);
    await expect(page.getByTestId("streaming-message")).toContainText(/hel|hello streaming/);
    await expect(page.getByTestId("assistant-message").last()).toContainText("hello streaming", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Open conversation history" })).toHaveText("say: hello streaming");

    await page.reload();
    await expect(page).toHaveURL(new RegExp(`bot=${botId}.*thread=${threadId}`));
    await expect(page.getByTestId("assistant-message").last()).toContainText("hello streaming");

    await createBot(page, "Newer Blank Bot");
    await page.getByRole("button", { name: "Streaming Bot", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`bot=${botId}.*thread=${threadId}`));
    await expect(page.getByTestId("assistant-message").last()).toContainText("hello streaming");
  });

  test("keeps collapsed Activity separate from the persisted final answer", async ({ page }) => {
    await page.goto("/");
    await createBot(page, "Activity Bot");
    await send(page, "tool please");
    await waitForPersistedThread(page);

    const trigger = page.getByRole("button", { name: "Activity (2)" });
    await expect(trigger).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("assistant-message").last()).toContainText("tool finished", { timeout: 15_000 });
    await expect(trigger.locator("..").getByRole("article", { name: "Message from assistant" })).toHaveCount(0);

    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByText("fake.progress", { exact: true }).first()).toBeVisible();

    await page.reload();
    await expect(page.getByRole("button", { name: "Activity (2)" })).toBeVisible();
    await expect(page.getByTestId("assistant-message").last()).toContainText("tool finished");
  });

  test("renders a failed turn as an inline transcript note", async ({ page }) => {
    await page.goto("/");
    await createBot(page, "Failure Bot");
    await send(page, "fail");
    await waitForPersistedThread(page);
    await expect(page.getByText("error: fake failure")).toBeVisible({ timeout: 15_000 });
  });

  test("keeps the composer enabled for steering and has no global TopNav or Stop control", async ({ page }) => {
    await page.goto("/");
    await createBot(page, "Steering Bot");

    await expect(page.getByRole("navigation", { name: "Bot navigation" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Steering Bot" })).toBeVisible();
    await expect(page.getByRole("navigation", { includeHidden: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Stop$/i })).toHaveCount(0);

    await send(page, "steer-echo");
    await waitForPersistedThread(page);
    await expect(page.getByTestId("streaming-message")).toBeVisible();
    await expect(composerInput(page)).toBeEnabled();

    await send(page, "redirect e2e");
    await expect(page.getByTestId("assistant-message").last()).toContainText("steered: redirect e2e", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^Stop$/i })).toHaveCount(0);
  });
});
