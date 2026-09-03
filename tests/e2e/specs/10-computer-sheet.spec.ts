import { expect, test, type Page, type Route } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

type ComputerState = "starting" | "ready" | "bot-using" | "waiting" | "needs-you" | "user-control" | "emergency-stopped" | "unavailable";

async function createBot(page: Page, name: string): Promise<string> {
  await page.getByRole("navigation", { name: "Bot navigation" }).getByRole("button", { name: "New bot" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("textbox", { name: "Job / Instructions" }).fill("Computer E2E teammate");
  await page.getByRole("radio", { name: /^Pi/ }).check();
  await page.getByRole("button", { name: "Create bot" }).click();
  const row = page.getByRole("button", { name, exact: true });
  await expect(row).toBeVisible();
  const botId = new URL(page.url()).searchParams.get("bot");
  if (botId === null) throw new Error(`missing selected bot id for ${name}`);
  return botId;
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

test.describe("contextual computer sheet", () => {
  test("shows selected-bot state, takeover handoff, preview, and no arbitration jargon", async ({ page }) => {
    let state: ComputerState = "ready";
    let activeBotId: string | undefined;
    await page.route("**/api/computer/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/computer/snapshot") {
        await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
        return;
      }
      if (url.pathname === "/api/computer/take-control") state = "user-control";
      if (url.pathname === "/api/computer/return-to-bot") state = "ready";
      const selectedBotId = url.searchParams.get("botId") ?? undefined;
      const surfaceId = url.searchParams.get("surfaceId") ?? undefined;
      const selectedState: ComputerState =
        state === "bot-using" && selectedBotId !== activeBotId ? "ready" : state;
      await fulfillJson(route, {
        state: selectedState,
        botId: selectedBotId,
        surfaceId,
        activity:
          selectedState === "bot-using"
            ? "This bot is using the computer."
            : selectedState === "user-control"
              ? "You are using the computer."
              : "Screen ready.",
        previewAt: "2026-09-02T12:00:00.000Z",
      });
    });

    await page.goto("/");
    activeBotId = await createBot(page, "Computer Bot");
    state = "bot-using";
    await page.reload();

    const trigger = page.getByRole("button", { name: "Open computer", exact: true });
    await expect(trigger).toHaveAttribute("data-state", "bot-using");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger.locator("svg.lucide-monitor")).toBeVisible();
    await trigger.click();
    const drawer = page.getByRole("complementary", { name: "Computer", exact: true });
    const closeTrigger = page.getByRole("button", { name: "Close computer", exact: true });
    await expect(closeTrigger).toHaveAttribute("aria-expanded", "true");
    await expect(drawer).toBeVisible();
    await closeTrigger.click();
    await expect(drawer).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Computer" })).toHaveCount(0);

    const sheet = drawer;
    await expect(sheet.getByAltText("Latest computer preview for Computer Bot")).toBeVisible();
    await expect(sheet).toContainText("This bot is using the computer.");
    await expect(sheet).not.toContainText(/lease|TTL|token|queue depth/i);
    await sheet.getByRole("button", { name: "Expand desktop preview" }).click();
    await expect(page.getByAltText("Expanded computer preview for Computer Bot")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByAltText("Expanded computer preview for Computer Bot")).toBeHidden();
    await expect(drawer).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Take control" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Return to bot" })).toHaveCount(0);

    await sheet.getByRole("button", { name: "Take control" }).click();
    await expect(sheet.getByRole("button", { name: "Return to bot" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Take control" })).toHaveCount(0);

    await sheet.getByRole("button", { name: "Return to bot" }).click();
    await expect(sheet).toContainText("Computer ready");
    await expect(sheet.getByRole("button", { name: "Return to bot" })).toHaveCount(0);
    await page.getByRole("button", { name: "Close computer drawer" }).click();
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("switching Bots clears old preview state and keeps emergency state Surface-scoped", async ({ page }) => {
    let waitingBotId: string | undefined;
    const emergencyStopped = new Set<string>();
    await page.route("**/api/computer/**", async (route) => {
      const url = new URL(route.request().url());
      const selectedBotId = url.searchParams.get("botId") ?? undefined;
      const surfaceId = url.searchParams.get("surfaceId") ?? undefined;
      if (url.pathname === "/api/computer/snapshot") {
        await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
        return;
      }
      if (url.pathname === "/api/computer/emergency-stop" && surfaceId !== undefined) emergencyStopped.add(surfaceId);
      if (url.pathname === "/api/computer/resume" && surfaceId !== undefined) emergencyStopped.delete(surfaceId);
      const selectedState: ComputerState =
        surfaceId !== undefined && emergencyStopped.has(surfaceId)
          ? "emergency-stopped"
          : selectedBotId === waitingBotId
            ? "waiting"
            : "bot-using";
      await fulfillJson(route, {
        state: selectedState,
        botId: selectedBotId,
        surfaceId,
        activity:
          selectedState === "waiting"
            ? "Waiting for computer."
            : selectedState === "emergency-stopped"
              ? "Computer control is stopped."
              : "This bot is using the computer.",
        ...(selectedState === "waiting" ? { previewAt: "2026-09-02T12:00:00.000Z" } : {}),
      });
    });

    await page.goto("/");
    await expect(page.getByRole("complementary", { name: "Bot Screen safety" })).toHaveCount(0);
    waitingBotId = await createBot(page, "Waiting Bot");
    const otherBotId = await createBot(page, "Other Bot");

    await page.getByRole("button", { name: "Waiting Bot", exact: true }).click();
    await page.getByRole("button", { name: "Open computer", exact: true }).click();
    const computer = page.getByRole("complementary", { name: "Computer", exact: true });
    await expect(computer.getByAltText("Latest computer preview for Waiting Bot")).toBeVisible();

    await page.getByRole("button", { name: "Other Bot", exact: true }).click();
    await expect(computer.getByAltText("Latest computer preview for Waiting Bot")).toHaveCount(0);
    await expect(computer.getByAltText("Latest computer preview for Other Bot")).toBeVisible();
    const emergency = page.getByRole("complementary", { name: "Bot Screen safety" });
    await emergency.getByRole("button", { name: "Emergency stop computer" }).click();
    await expect(emergency.getByRole("button", { name: "Resume computer control" })).toBeVisible();

    await page.getByRole("button", { name: "Waiting Bot", exact: true }).click();
    await expect(page.getByRole("button", { name: "Close computer", exact: true })).toHaveAttribute("data-state", "waiting");
    await expect(emergency.getByRole("button", { name: "Emergency stop computer" })).toBeVisible();
    expect(otherBotId).not.toBe(waitingBotId);
  });

  test("uses a bottom sheet on a narrow screen", async ({ page }) => {
    await page.route("**/api/computer/state**", (route) => {
      const url = new URL(route.request().url());
      return fulfillJson(route, {
        botId: url.searchParams.get("botId"),
        surfaceId: url.searchParams.get("surfaceId"),
        state: "ready",
        activity: "Screen ready.",
      });
    });
    await page.route("**/api/computer/snapshot**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await page.goto("/");
    await createBot(page, "Mobile Computer Bot");
    await page.setViewportSize({ width: 390, height: 780 });
    await page.getByRole("button", { name: "Open computer", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Computer" })).toBeVisible();
  });
});
