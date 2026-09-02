import { expect, test, type Page } from "@playwright/test";

async function openCreateDialog(page: Page): Promise<void> {
  await page.getByTestId("sidebar-create-bot").click();
  await expect(page.getByRole("dialog", { name: "Create a bot" })).toBeVisible();
}

async function createBot(page: Page, name: string, instructions = ""): Promise<string> {
  await openCreateDialog(page);
  await page.getByTestId("create-bot-name").fill(name);
  await page.getByTestId("create-bot-instructions").fill(instructions);
  await page.getByRole("radio", { name: /^Pi/ }).check();
  await page.getByTestId("create-bot-submit").click();
  const row = page.locator("[data-testid^='sidebar-bot-']", { hasText: name });
  await expect(row).toBeVisible();
  const testId = await row.getAttribute("data-testid");
  if (testId === null) throw new Error(`missing sidebar test id for ${name}`);
  return testId.slice("sidebar-bot-".length);
}

test.describe("create bot flow", () => {
  test("lists agent readiness and selects a newly created bot on a blank conversation", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("[data-testid^='sidebar-bot-']")).toHaveCount(0);

    await openCreateDialog(page);
    await expect(page.getByTestId("create-bot-agent").getByRole("radio")).toHaveCount(9);

    const claude = page.getByRole("radio", { name: "Claude" });
    await expect(claude).toBeDisabled();
    await expect(page.getByText("Claude is not available: no adapter is installed in this Omarchy Bot build yet.")).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Pi/ })).toBeEnabled();

    await page.getByTestId("create-bot-submit").click();
    await expect(page.getByText("Name is required.")).toBeVisible();

    await page.getByTestId("create-bot-name").fill("E2E Bot");
    await page.getByTestId("create-bot-instructions").fill("Own release notes");
    await page.getByRole("radio", { name: /^Pi/ }).check();
    await page.getByTestId("create-bot-submit").click();

    await expect(page.locator("[data-testid^='sidebar-bot-']", { hasText: "E2E Bot" })).toBeVisible();
    await expect(page.locator("header", { hasText: "E2E Bot" })).toBeVisible();
    await expect(page).toHaveURL(/(?:\?|&)bot=bot_[0-9a-f]{32}(?:&|$)/);
    await expect(page).toHaveURL(/(?:\?|&)thread=blank(?:&|$)/);
    await expect(page.getByTestId("composer").locator('[contenteditable="true"]')).toHaveText("");
  });

  test("keeps two bots on the same agent as independent sidebar rows", async ({ page }) => {
    await page.goto("/");
    const firstId = await createBot(page, "Release Bot", "Prepare releases");
    const secondId = await createBot(page, "Support Bot", "Triage support");

    expect(firstId).not.toBe(secondId);
    await expect(page.getByTestId(`sidebar-bot-${firstId}`)).toContainText("Release Bot");
    await expect(page.getByTestId(`sidebar-bot-${secondId}`)).toContainText("Support Bot");
  });
});
