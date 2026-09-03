import { expect, test, type Page, type Route } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

type ComputerState = "idle" | "bot-using" | "waiting" | "needs-you" | "user-control" | "emergency-stopped" | "unavailable";

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
    let state: ComputerState = "idle";
    let activeBotId: string | undefined;
    await page.route("**/api/computer/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/computer/snapshot") {
        await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
        return;
      }
      if (url.pathname === "/api/computer/take-control") state = "user-control";
      if (url.pathname === "/api/computer/return-to-bot") state = "idle";
      const selectedBotId = url.searchParams.get("botId") ?? undefined;
      const selectedState: ComputerState =
        state === "bot-using" && selectedBotId !== undefined && selectedBotId !== activeBotId ? "idle" : state;
      await fulfillJson(route, {
        state: selectedState,
        ...(selectedState === "bot-using" && activeBotId !== undefined ? { botId: activeBotId } : {}),
        activity:
          selectedState === "bot-using"
            ? "This bot is using the computer."
            : selectedState === "user-control"
              ? "You are using the computer."
              : "The computer is ready.",
        previewAt: "2026-09-02T12:00:00.000Z",
      });
    });

    await page.goto("/");
    activeBotId = await createBot(page, "Computer Bot");
    state = "bot-using";
    await page.reload();

    const trigger = page.getByRole("button", { name: "Open computer", exact: true });
    await expect(trigger).toHaveAttribute("data-state", "bot-using");
    await trigger.click();
    const drawer = page.getByRole("complementary", { name: "Computer", exact: true });
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Computer" })).toHaveCount(0);

    const sheet = drawer;
    await expect(sheet).toBeVisible();
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

  test("waiting belongs only to the waiting bot and the emergency fail-safe stays global", async ({ page }) => {
    let waitingBotId: string | undefined;
    let emergencyStopped = false;
    await page.route("**/api/computer/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/computer/snapshot") {
        await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
        return;
      }
      if (url.pathname === "/api/computer/emergency-stop") emergencyStopped = true;
      if (url.pathname === "/api/computer/resume") emergencyStopped = false;
      const selectedBotId = url.searchParams.get("botId") ?? undefined;
      const selectedState: ComputerState =
        emergencyStopped
          ? "emergency-stopped"
          : selectedBotId === waitingBotId || (selectedBotId === undefined && waitingBotId !== undefined)
            ? "waiting"
            : "idle";
      await fulfillJson(route, {
        state: selectedState,
        ...(selectedState === "waiting" && waitingBotId !== undefined ? { botId: waitingBotId } : {}),
        activity: selectedState === "waiting" ? "Waiting for computer." : selectedState === "emergency-stopped" ? "Computer control is stopped." : "The computer is ready.",
      });
    });

    await page.goto("/");
    await expect(page.getByRole("complementary", { name: "Global computer safety" })).toHaveCount(0);
    waitingBotId = await createBot(page, "Waiting Bot");
    const otherBotId = await createBot(page, "Other Bot");

    await page.getByRole("button", { name: "Waiting Bot", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open computer", exact: true })).toHaveAttribute("data-state", "waiting");
    await page.getByRole("button", { name: "Open computer", exact: true }).click();
    const computer = page.getByRole("complementary", { name: "Computer", exact: true });
    await expect(computer.getByRole("heading", { name: "Waiting for computer" })).toBeVisible();
    await expect(computer.getByRole("button", { name: "Take control" })).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Other Bot", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open computer", exact: true })).toHaveAttribute("data-state", "idle");

    const emergency = page.getByRole("complementary", { name: "Global computer safety" });
    await expect(emergency.getByRole("button", { name: "Emergency stop computer" })).toBeVisible();
    await emergency.getByRole("button", { name: "Emergency stop computer" }).click();
    await page.getByRole("button", { name: "Waiting Bot", exact: true }).click();
    await expect(emergency.getByRole("button", { name: "Resume computer control" })).toBeVisible();
    await emergency.getByRole("button", { name: "Resume computer control" }).click();
    await expect(emergency.getByRole("button", { name: "Emergency stop computer" })).toBeVisible();
    expect(otherBotId).not.toBe(waitingBotId);
  });

  test("uses a bottom sheet on a narrow screen", async ({ page }) => {
    await page.route("**/api/computer/state**", (route) => fulfillJson(route, { state: "idle", activity: "The computer is ready." }));
    await page.route("**/api/computer/snapshot**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await page.goto("/");
    await createBot(page, "Mobile Computer Bot");
    await page.setViewportSize({ width: 390, height: 780 });
    await page.getByRole("button", { name: "Open computer", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Computer" })).toBeVisible();
  });
});
