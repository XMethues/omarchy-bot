import { expect, test, type Page, type Route } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

type ComputerState = "idle" | "bot-using" | "waiting" | "needs-you" | "user-control" | "emergency-stopped" | "unavailable";

async function createBot(page: Page, name: string): Promise<string> {
  await page.getByTestId("sidebar-create-bot").click();
  await page.getByTestId("create-bot-name").fill(name);
  await page.getByTestId("create-bot-instructions").fill("Computer E2E teammate");
  await page.getByRole("radio", { name: /^Pi/ }).check();
  await page.getByTestId("create-bot-submit").click();
  const row = page.locator("[data-testid^='sidebar-bot-']", { hasText: name });
  await expect(row).toBeVisible();
  const testId = await row.getAttribute("data-testid");
  if (testId === null) throw new Error(`missing sidebar test id for ${name}`);
  return testId.slice("sidebar-bot-".length);
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
        state === "bot-using" && selectedBotId !== activeBotId ? "idle" : state;
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

    const trigger = page.getByTestId("header-computer");
    await expect(trigger).toHaveAttribute("data-state", "bot-using");
    await expect(trigger).toHaveAccessibleName(/this bot is using it/i);
    await trigger.click();

    const sheet = page.getByTestId("computer-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId("computer-preview")).toHaveAttribute("alt", "Latest computer preview for Computer Bot");
    await expect(sheet).toContainText("This bot is using the computer.");
    await expect(sheet).not.toContainText(/lease|TTL|token|queue depth/i);
    await expect(sheet.getByTestId("computer-take-control")).toBeVisible();
    await expect(sheet.getByTestId("computer-return-to-bot")).toHaveCount(0);

    await sheet.getByTestId("computer-take-control").click();
    await expect(sheet.getByTestId("computer-return-to-bot")).toBeVisible();
    await expect(sheet.getByTestId("computer-take-control")).toHaveCount(0);

    await sheet.getByTestId("computer-return-to-bot").click();
    await expect(sheet).toContainText("Computer ready");
    await expect(sheet.getByTestId("computer-return-to-bot")).toHaveCount(0);
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
      const selectedState: ComputerState = emergencyStopped ? "emergency-stopped" : selectedBotId === waitingBotId ? "waiting" : "idle";
      await fulfillJson(route, {
        state: selectedState,
        ...(selectedState === "waiting" && selectedBotId !== undefined ? { botId: selectedBotId } : {}),
        activity: selectedState === "waiting" ? "Waiting for computer." : selectedState === "emergency-stopped" ? "Computer control is stopped." : "The computer is ready.",
      });
    });

    await page.goto("/");
    waitingBotId = await createBot(page, "Waiting Bot");
    const otherBotId = await createBot(page, "Other Bot");

    await page.getByTestId(`sidebar-bot-${waitingBotId}`).click();
    await expect(page.getByTestId("header-computer")).toHaveAttribute("data-state", "waiting");
    await page.getByTestId("header-computer").click();
    await expect(page.getByTestId("computer-sheet")).toContainText("Waiting for computer");
    await expect(page.getByTestId("computer-take-control")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByTestId(`sidebar-bot-${otherBotId}`).click();
    await expect(page.getByTestId("header-computer")).toHaveAttribute("data-state", "idle");

    const emergency = page.getByTestId("emergency-computer-control");
    await expect(emergency).toBeVisible();
    await expect(emergency.getByRole("button", { name: "Emergency stop computer" })).toBeVisible();
    await emergency.getByRole("button", { name: "Emergency stop computer" }).click();
    await expect(emergency.getByRole("button", { name: "Resume computer control" })).toBeVisible();
    await emergency.getByRole("button", { name: "Resume computer control" }).click();
    await expect(emergency.getByRole("button", { name: "Emergency stop computer" })).toBeVisible();
  });

  test("uses a bottom sheet on a narrow screen", async ({ page }) => {
    await page.route("**/api/computer/state**", (route) => fulfillJson(route, { state: "idle", activity: "The computer is ready." }));
    await page.route("**/api/computer/snapshot**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await page.goto("/");
    await createBot(page, "Mobile Computer Bot");
    await page.setViewportSize({ width: 390, height: 780 });
    await page.getByTestId("header-computer").click();
    await expect(page.getByRole("dialog", { name: "Computer" })).toBeVisible();
    await expect(page.getByTestId("computer-sheet")).toBeVisible();
  });
});
