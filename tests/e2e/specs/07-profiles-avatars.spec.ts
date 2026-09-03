import { expect, test, type Locator, type Page } from "@playwright/test";

async function createBot(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Bot navigation" }).getByRole("button", { name: "New bot" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("textbox", { name: "Job / Instructions" }).fill("Original instructions");
  await page.getByRole("radio", { name: /^Pi/ }).check();
  await page.getByRole("button", { name: "Create bot" }).click();
  const row = page.getByRole("button", { name, exact: true });
  await expect(row).toBeVisible();
  const botId = new URL(page.url()).searchParams.get("bot");
  if (botId === null) throw new Error(`missing selected bot id for ${name}`);
  return botId;
}

async function openProfile(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Edit bot profile" }).click();
  await expect(page.getByRole("dialog", { name: "Bot profile" })).toBeVisible();
}

const onePixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
async function avatarSvg(avatar: Locator): Promise<string> {
  const dataUri = await avatar.locator("img").getAttribute("src");
  if (dataUri === null || !dataUri.startsWith("data:image/svg+xml")) {
    throw new Error("avatar did not render a local SVG data URI");
  }
  return decodeURIComponent(dataUri.slice(dataUri.indexOf(",") + 1));
}

test.describe("Bot profiles and avatars", () => {
  test("edits profile fields, creates a variation, and uploads a local image", async ({ page }) => {
    const botId = await createBot(page, "Profile Bot");
    await openProfile(page);

    const profile = page.getByRole("dialog", { name: "Bot profile" });
    await expect(profile.getByText("Backing Agent", { exact: true })).toBeVisible();
    await expect(profile.getByText("Pi", { exact: true })).toBeVisible();
    await expect(profile.getByText("Fixed for this bot.", { exact: true })).toBeVisible();
    await profile.getByRole("textbox", { name: "Name" }).fill("Renamed Profile Bot");
    await profile.getByRole("textbox", { name: "Job / Instructions" }).fill("Use the latest profile instructions");
    await profile.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("button", { name: "Renamed Profile Bot", exact: true })).toBeVisible();

    const profileAvatar = profile.getByRole("img", { name: "Renamed Profile Bot" }).locator("img");
    const beforeSrc = await profileAvatar.getAttribute("src");
    await profile.getByRole("button", { name: "New variation" }).click();
    await expect.poll(() => profileAvatar.getAttribute("src")).not.toBe(beforeSrc);

    await page.getByLabel("Choose an avatar image").setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: onePixelPng });
    await expect
      .poll(() => profile.getByRole("img", { name: "Renamed Profile Bot" }).locator("img").getAttribute("src"))
      .toBe(`/api/bots/${botId}/avatar`);
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
            recipe: {
              rendererVersion: "dicebear-core@10.7.0+styles@10.6.0",
              style: "thumbs",
              seed: "e2e-recipe",
              options: {},
            },
          },
        }),
      });
    });

    await openProfile(page);
    await page.getByRole("textbox", { name: "Describe avatar" }).fill("A friendly teammate with round glasses");
    await page.getByRole("button", { name: "Create from description" }).click();
    await expect(page.getByRole("dialog", { name: "Bot profile" }).getByTestId("avatar-thumbs")).toBeVisible();
  });


  test("shows selected and streaming activity without moving transcript content", async ({ page }) => {
    const botId = await createBot(page, "Activity Avatar Bot");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const selectedAvatar = page.getByTestId(`sidebar-bot-${botId}`).getByTestId("avatar-view");
    await expect(selectedAvatar).toHaveAttribute("data-avatar-activity", "selected");
    await expect(selectedAvatar.locator('[role="presentation"][aria-hidden="true"]')).toBeVisible();
    const selectedSvg = await avatarSvg(selectedAvatar);
    expect(selectedSvg).toContain("@keyframes");
    expect(selectedSvg).toContain("@media (prefers-reduced-motion: no-preference)");

    const composer = page.getByRole("textbox", { name: "Message input" });
    await composer.fill("steer-echo");
    await composer.press("Enter");
    const streamingMessage = page.getByTestId("streaming-message");
    await expect(streamingMessage).toBeVisible();
    const streamingAvatar = streamingMessage.getByTestId("avatar-view");
    await expect(streamingAvatar).toHaveAttribute("data-avatar-activity", "streaming");
    await expect(
      streamingAvatar.getByRole("img", { name: "Activity Avatar Bot, Streaming", exact: true }),
    ).toBeVisible();
    await expect(streamingMessage).toHaveCSS("transform", "none");

    await composer.fill("finish activity");
    await composer.press("Enter");
    await expect(page.getByTestId("assistant-message").last()).toContainText("steered: finish activity", { timeout: 15_000 });
  });

  test("reduced motion gates native SVG animation while retaining activity state", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await createBot(page, "Reduced Motion Bot");
    await openProfile(page);

    const avatar = page.getByRole("dialog", { name: "Bot profile" }).getByTestId("avatar-view");
    await expect(avatar).toHaveAttribute("data-avatar-activity", "selected");
    const svg = await avatarSvg(avatar);
    expect(svg).toContain("@keyframes");
    expect(svg).toContain("@media (prefers-reduced-motion: no-preference)");
  });
});
