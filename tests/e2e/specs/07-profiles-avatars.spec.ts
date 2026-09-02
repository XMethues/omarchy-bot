import { expect, test, type Page } from "@playwright/test";

async function createBot(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.getByTestId("sidebar-create-bot").click();
  await page.getByTestId("create-bot-name").fill(name);
  await page.getByTestId("create-bot-instructions").fill("Original instructions");
  await page.getByRole("radio", { name: /^Pi/ }).check();
  await page.getByTestId("create-bot-submit").click();
  const row = page.locator("[data-testid^='sidebar-bot-']", { hasText: name });
  await expect(row).toBeVisible();
  const testId = await row.getAttribute("data-testid");
  if (testId === null) throw new Error("created Bot row has no test id");
  return testId.slice("sidebar-bot-".length);
}

async function openProfile(page: Page): Promise<void> {
  await page.getByTestId("profile-open").click();
  await expect(page.getByRole("dialog", { name: "Bot profile" })).toBeVisible();
}

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Bot profiles and avatars", () => {
  test("edits profile fields, creates a variation, and uploads a local image", async ({ page }) => {
    const botId = await createBot(page, "Profile Bot");
    await openProfile(page);

    await expect(page.getByText("Agent: pi. To use another Agent, create a new bot.")).toBeVisible();
    await page.getByTestId("profile-name").fill("Renamed Profile Bot");
    await page.getByTestId("profile-instructions").fill("Use the latest profile instructions");
    await page.getByTestId("profile-save").click();
    await expect(page.getByTestId(`sidebar-bot-${botId}`)).toContainText("Renamed Profile Bot");

    const profileAvatar = page.getByRole("dialog").getByTestId("avatar-view");
    const beforeSrc = await profileAvatar.locator("img").getAttribute("src");
    await page.getByTestId("avatar-variation").click();
    await expect.poll(() => profileAvatar.locator("img").getAttribute("src")).not.toBe(beforeSrc);

    await page.getByTestId("avatar-upload-input").setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: onePixelPng });
    await expect(page.getByRole("dialog").getByTestId("avatar-upload")).toBeVisible();
    const uploadedSrc = await page.getByRole("dialog").getByTestId("avatar-upload").locator("img").getAttribute("src");
    expect(uploadedSrc).toBe(`/api/bots/${botId}/avatar`);
  });

  test("applies a validated prompt recipe through the profile UI", async ({ page, request }) => {
    const botId = await createBot(page, "Recipe UI Bot");
    const currentResponse = await request.get(`/api/bots/${botId}`);
    const current: unknown = await currentResponse.json();
    if (current === null || typeof current !== "object") throw new Error("Bot API returned an invalid profile");
    await page.route(`**/api/bots/${botId}/avatar/recipe`, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...current,
          avatar: {
            kind: "recipe",
            recipe: { rendererVersion: "9.4.3", style: "micah", seed: "e2e-recipe", options: { glassesProbability: 25 } },
          },
        }),
      });
    });

    await openProfile(page);
    await page.getByTestId("avatar-prompt").fill("A friendly teammate with round glasses");
    await page.getByTestId("avatar-recipe-submit").click();
    await expect(page.getByRole("dialog").getByTestId("avatar-micah")).toBeVisible();
  });

  test("shows selected and streaming activity without moving transcript content", async ({ page }) => {
    const botId = await createBot(page, "Activity Avatar Bot");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(page.getByTestId(`sidebar-bot-${botId}`).getByTestId("avatar-view")).toHaveAttribute("data-avatar-activity", "selected");

    const composer = page.getByTestId("composer").locator('[contenteditable="true"]');
    await composer.fill("steer-echo");
    await composer.press("Enter");
    const streamingMessage = page.getByTestId("streaming-message");
    await expect(streamingMessage).toBeVisible();
    const streamingAvatar = streamingMessage.getByTestId("avatar-view");
    await expect(streamingAvatar).toHaveAttribute("data-avatar-activity", "streaming");
    await expect(streamingMessage).toHaveCSS("transform", "none");

    await composer.fill("finish activity");
    await composer.press("Enter");
    await expect(page.getByTestId("assistant-message").last()).toContainText("steered: finish activity", { timeout: 15_000 });
  });

  test("reduced motion keeps a static semantic state indicator", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await createBot(page, "Reduced Motion Bot");
    await openProfile(page);

    const avatar = page.getByRole("dialog").getByTestId("avatar-view");
    await expect(avatar).toHaveAttribute("data-avatar-activity", "selected");
    await expect(avatar.locator(":scope > span")).toHaveCSS("animation-name", "none");
    await expect(page.getByRole("dialog")).toHaveScreenshot("profile-reduced-motion.png", {
      animations: "disabled",
      mask: [avatar],
    });
  });
});
