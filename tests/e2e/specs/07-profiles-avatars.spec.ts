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

async function openBotSettings(page: Page, botName: string): Promise<void> {
  await page.getByRole("button", { name: `Open settings for ${botName}` }).click();
  const botSettings = page.getByRole("complementary", { name: "Bot settings" });
  await expect(botSettings.getByTestId("bot-settings-panel")).toBeVisible();
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
    await openBotSettings(page, "Profile Bot");

    const botSettings = page.getByRole("complementary", { name: "Bot settings" });
    await expect(botSettings.getByText("Backing Agent", { exact: true })).toBeVisible();
    await expect(botSettings.getByText("Pi", { exact: true })).toBeVisible();
    await expect(botSettings.getByText("Fixed for this bot.", { exact: true })).toBeVisible();
    await botSettings.getByRole("textbox", { name: "Name" }).fill("Renamed Profile Bot");
    await botSettings.getByRole("textbox", { name: "Job / Instructions" }).fill("Use the latest profile instructions");
    await botSettings.getByRole("button", { name: "Save profile" }).click();
    await expect(page.getByRole("button", { name: "Renamed Profile Bot", exact: true })).toBeVisible();

    const profileAvatar = botSettings.getByRole("img", { name: "Renamed Profile Bot" }).locator("img");
    const beforeSrc = await profileAvatar.getAttribute("src");
    await botSettings.getByRole("button", { name: "New variation" }).click();
    await expect.poll(() => profileAvatar.getAttribute("src")).not.toBe(beforeSrc);

    await page.getByLabel("Choose an avatar image").setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: onePixelPng });
    await expect
      .poll(() => botSettings.getByRole("img", { name: "Renamed Profile Bot" }).locator("img").getAttribute("src"))
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

    await openBotSettings(page, "Recipe UI Bot");
    await page.getByRole("textbox", { name: "Describe avatar" }).fill("A friendly teammate with round glasses");
    await page.getByRole("button", { name: "Create from description" }).click();
    await expect(page.getByRole("complementary", { name: "Bot settings" }).getByTestId("avatar-thumbs")).toBeVisible();
  });


  test("keeps Sidebar activity independent while one generated working avatar follows the selected Thread", async ({ page }) => {
    const botId = await createBot(page, "Activity Avatar Bot");
    await page.emulateMedia({ reducedMotion: "no-preference" });

    const sidebarRow = page.getByTestId(`sidebar-bot-${botId}`);
    const sidebarAvatar = sidebarRow.getByTestId("avatar-view");
    await expect(sidebarAvatar).toHaveAttribute("data-avatar-presentation", "ambient");
    expect(await avatarSvg(sidebarAvatar)).toContain("@keyframes");
    const ambientSrc = await sidebarAvatar.locator("img").getAttribute("src");
    await expect(sidebarRow.getByTestId("sidebar-activity-point")).toHaveCount(0);

    const headerAvatar = page.getByTestId("bot-settings-open").getByTestId("avatar-view");
    await expect(headerAvatar).toHaveAttribute("data-avatar-presentation", "static");
    expect(await avatarSvg(headerAvatar)).not.toContain("@keyframes");

    const composer = page.getByRole("textbox", { name: "Message input" });
    await composer.fill("steer-echo");
    await composer.press("Enter");
    await expect(sidebarRow.getByTestId("sidebar-activity-point")).toBeVisible();
    await expect(sidebarAvatar.locator("img")).toHaveAttribute("src", ambientSrc!);

    const workingAvatar = page.getByTestId("working-avatar");
    const workingAvatarImage = workingAvatar.getByRole("img", { name: "Activity Avatar Bot is working" });
    await expect(workingAvatarImage).toBeVisible();
    await expect(workingAvatar.getByTestId("avatar-pixelbot")).toHaveAttribute("data-avatar-presentation", "working");
    await expect(workingAvatar.getByTestId("avatar-pixelbot")).toHaveCSS("animation-name", "none");
    expect(await avatarSvg(workingAvatar)).toContain("@keyframes");
    await expect(page.getByTestId("working-announcement")).toHaveText("Activity Avatar Bot is working");
    await expect(workingAvatar.getByRole("img", { name: "Active" })).toHaveCount(0);
    await workingAvatarImage.hover();
    await expect(page.getByRole("tooltip", { name: "Activity Avatar Bot is working" })).toBeVisible();
    await page.mouse.move(0, 0);
    await workingAvatarImage.focus();
    await expect(page.getByRole("tooltip", { name: "Activity Avatar Bot is working" })).toBeVisible();

    await expect(page.getByTestId("tool-calls")).toHaveCount(0);

    await page.getByRole("button", { name: "Open conversation history" }).click();
    await page.getByRole("button", { name: "New conversation" }).click();
    await expect(page.getByTestId("working-avatar")).toHaveCount(0);
    await expect(sidebarRow.getByTestId("sidebar-activity-point")).toBeVisible();

    await page.getByRole("button", { name: "Open conversation history" }).click();
    await page.getByRole("button", { name: /steer-echo/ }).click();
    await expect(page.getByTestId("working-avatar")).toBeVisible();
    await composer.fill("finish activity");
    await composer.press("Enter");
    await expect(page.getByTestId("assistant-message").last()).toContainText("steered: finish activity", { timeout: 15_000 });
    await expect(page.getByTestId("working-avatar")).toHaveCount(0);
    await expect(page.getByTestId("working-announcement")).toHaveText("Activity Avatar Bot is no longer working");
    await expect(page.getByTestId("assistant-message").last().getByTestId("avatar-view")).toHaveCount(0);
    await expect(sidebarRow.getByTestId("sidebar-activity-point")).toHaveCount(0);
  });

  test("uses whole-avatar pulse for uploads and preserves the working cue under reduced motion", async ({ page }) => {
    const botId = await createBot(page, "Uploaded Activity Bot");
    await openBotSettings(page, "Uploaded Activity Bot");
    await page.getByLabel("Choose an avatar image").setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: onePixelPng,
    });
    await page.getByRole("button", { name: "Close bot settings" }).click();

    const composer = page.getByRole("textbox", { name: "Message input" });
    await composer.fill("steer-echo");
    await composer.press("Enter");
    const workingAvatar = page.getByTestId("working-avatar");
    const uploadedAvatar = workingAvatar.getByTestId("avatar-upload");
    await expect(uploadedAvatar.locator("img")).toHaveAttribute("src", `/api/bots/${botId}/avatar`);
    await expect(uploadedAvatar).not.toHaveCSS("animation-name", "none");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(uploadedAvatar).toHaveCSS("animation-name", "none");
    await expect(uploadedAvatar).toHaveAccessibleName("Uploaded Activity Bot is working");
    await expect(workingAvatar).toBeVisible();

    await composer.fill("finish upload activity");
    await composer.press("Enter");
    await expect(page.getByTestId("working-avatar")).toHaveCount(0);
  });

  test("keeps both waiting states active and removes the working avatar for every terminal state", async ({ page, request }) => {
    const botId = await createBot(page, "Turn State Avatar Bot");
    const composer = page.getByRole("textbox", { name: "Message input" });
    await composer.fill("say: completed history");
    await composer.press("Enter");
    await expect(page.getByTestId("assistant-message").last()).toContainText("completed history", { timeout: 15_000 });

    const response = await request.get(`/api/bots/${botId}/threads`);
    const [persistedThread] = await response.json() as Array<Record<string, unknown>>;
    if (persistedThread === undefined || typeof persistedThread.id !== "string") throw new Error("missing persisted Thread");
    let status: "waiting_for_input" | "waiting_for_computer" | "completed" | "cancelled" | "failed" = "waiting_for_input";
    await page.route(`/api/bots/${botId}/threads`, async (route) => {
      const turn = {
        id: "turn_avatar_state",
        threadId: persistedThread.id,
        botId,
        status,
        steerCount: 0,
        startedAt: "2026-01-15T09:00:00.000Z",
        ...(["completed", "cancelled", "failed"].includes(status)
          ? { finishedAt: "2026-01-15T09:01:00.000Z" }
          : {}),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{
          ...persistedThread,
          latestTurn: turn,
          ...(["waiting_for_input", "waiting_for_computer"].includes(status) ? { activeTurn: turn } : {}),
        }]),
      });
    });

    for (const waiting of ["waiting_for_input", "waiting_for_computer"] as const) {
      status = waiting;
      await page.reload();
      await expect(page.getByTestId("working-avatar")).toBeVisible();
      await expect(page.getByTestId("assistant-message").last()).toContainText("completed history");
      await expect(page.getByTestId("assistant-message").last().getByTestId("avatar-view")).toHaveCount(0);
    }

    for (const terminal of ["completed", "cancelled", "failed"] as const) {
      status = terminal;
      await page.reload();
      await expect(page.getByTestId("working-avatar")).toHaveCount(0);
      await expect(page.getByTestId("assistant-message").last()).toContainText("completed history");
      await expect(page.getByTestId("assistant-message").last().getByTestId("avatar-view")).toHaveCount(0);
    }
  });
});
