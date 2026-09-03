import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
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

function fakeProbeFile(): string {
  const state = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, "../.daemon.json"), "utf8"),
  ) as { runDir: string };
  return path.join(state.runDir, "data", "conformance", "pi-fake-pi-1.json");
}

function setFakeProbe(control: Record<string, unknown>): void {
  writeFileSync(fakeProbeFile(), JSON.stringify({ ok: true, ...control }));
}

async function expectCardAboveComposer(page: Page): Promise<void> {
  const card = page.getByTestId("composer-error-card");
  const composer = page.getByTestId("composer");
  await expect(card).toBeVisible();
  const [cardBox, composerBox] = await Promise.all([card.boundingBox(), composer.boundingBox()]);
  expect(cardBox).not.toBeNull();
  expect(composerBox).not.toBeNull();
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(composerBox!.y);
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
    const streamingMessage = page.getByTestId("streaming-message");
    const workingAvatar = page.getByTestId("working-avatar");
    await expect(workingAvatar).toBeVisible();
    const [streamingBox, workingBox] = await Promise.all([streamingMessage.boundingBox(), workingAvatar.boundingBox()]);
    expect(streamingBox).not.toBeNull();
    expect(workingBox).not.toBeNull();
    expect(workingBox!.y).toBeGreaterThanOrEqual(streamingBox!.y + streamingBox!.height);
    await expect(page.getByTestId("assistant-message").last()).toContainText("hello streaming", { timeout: 15_000 });
    await expect(page.getByTestId("working-avatar")).toHaveCount(0);
    await expect(page.getByTestId("assistant-message").last().getByTestId("avatar-view")).toHaveCount(0);
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

  test("shows failed Turns once above the Composer and supports retry and close", async ({ page, request }) => {
    await page.goto("/");
    await createBot(page, "Failure Bot");
    await send(page, "fail-once");
    const threadId = await waitForPersistedThread(page);

    await expectCardAboveComposer(page);
    const card = page.getByTestId("composer-error-card");
    await expect(card).toContainText("fake failure");
    await expect(page.getByText("error: fake failure")).toHaveCount(0);
    const messages = await request.get(`/api/threads/${threadId}/messages`);
    expect((await messages.json()) as Array<{ author: { kind: string }; text?: string }>).not.toContainEqual(
      expect.objectContaining({ author: { kind: "system" }, text: expect.stringContaining("fake failure") }),
    );

    await card.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByTestId("assistant-message").last()).toContainText("recovered", { timeout: 15_000 });
    await expect(card).toHaveCount(0);

    await send(page, "fail");
    await expectCardAboveComposer(page);
    await page.getByTestId("composer-error-card").getByRole("button", { name: "Close" }).click();
    await expect(page.getByTestId("composer-error-card")).toHaveCount(0);

    await page.getByRole("button", { name: "Open conversation history" }).click();
    await page.getByRole("button", { name: "New conversation" }).click();
    await send(page, "timeout-failure");
    const timeoutThreadId = await waitForPersistedThread(page);
    await expectCardAboveComposer(page);
    const timeoutCard = page.getByTestId("composer-error-card");
    await expect(timeoutCard).toContainText("timed out after 30s");
    await expect(timeoutCard.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(timeoutCard.getByRole("button", { name: "Close" })).toBeVisible();
    const timeoutMessages = await request.get(`/api/threads/${timeoutThreadId}/messages`);
    expect((await timeoutMessages.json()) as Array<{ author: { kind: string }; text?: string }>).not.toContainEqual(
      expect.objectContaining({ author: { kind: "system" }, text: expect.stringContaining("timed out after") }),
    );
    setFakeProbe({ fakeProbe: "offline" });
    try {
      expect((await request.post("/api/agents/pi/recheck")).ok()).toBe(true);
      await expect(timeoutCard).toContainText("fake probe offline");
      await timeoutCard.getByRole("button", { name: "Close" }).click();
      await expect(timeoutCard).toContainText("Turn failed");
      await expect(timeoutCard).toContainText("timed out after 30s");
      await timeoutCard.getByRole("button", { name: "Close" }).click();
      await expect(timeoutCard).toHaveCount(0);
    } finally {
      setFakeProbe({});
      await request.post("/api/agents/pi/recheck");
    }

    await page.getByRole("button", { name: "Open conversation history" }).click();
    await page.getByRole("button", { name: /fail-once/ }).click();
    await expect(page).toHaveURL(new RegExp(`thread=${threadId}`));
    await expect(page.getByTestId("composer-error-card")).toHaveCount(0);

    await page.getByRole("button", { name: "Open conversation history" }).click();
    await page.getByRole("button", { name: /timeout-failure/ }).click();
    await expect(page).toHaveURL(new RegExp(`thread=${timeoutThreadId}`));
    await expect(page.getByTestId("composer-error-card")).toHaveCount(0);
  });

  test("disables sending and shows readiness reason and recovery above the Composer", async ({ page, request }) => {
    await page.goto("/");
    await createBot(page, "Readiness Bot");
    setFakeProbe({ fakeProbe: "offline" });
    try {
      expect((await request.post("/api/agents/pi/recheck")).ok()).toBe(true);
      await expectCardAboveComposer(page);
      const card = page.getByTestId("composer-error-card");
      await expect(card).toContainText("fake probe offline");
      await expect(card).toContainText("Restart the daemon or check the worker logs.");
      await expect(composerInput(page)).toHaveAttribute("aria-disabled", "true");
      await expect(composerInput(page)).toHaveAttribute("contenteditable", "false");

      await card.getByRole("button", { name: "Close" }).click();
      await expect(card).toHaveCount(0);
      await expect(composerInput(page)).toHaveAttribute("aria-disabled", "true");

      setFakeProbe({});
      expect((await request.post("/api/agents/pi/recheck")).ok()).toBe(true);
      await expect(composerInput(page)).not.toHaveAttribute("aria-disabled");

      setFakeProbe({ fakeProbe: "offline" });
      expect((await request.post("/api/agents/pi/recheck")).ok()).toBe(true);
      await expectCardAboveComposer(page);
      await expect(card).toContainText("fake probe offline");

      setFakeProbe({});
      await card.getByRole("button", { name: "Retry" }).click();
      await expect(composerInput(page)).not.toHaveAttribute("aria-disabled");
      await expect(composerInput(page)).toHaveAttribute("contenteditable", "true");
      await expect(card).toHaveCount(0);
    } finally {
      setFakeProbe({});
      await request.post("/api/agents/pi/recheck");
    }
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
    await expect(page.getByTestId("working-avatar")).toBeVisible();
    await expect(composerInput(page)).toBeEnabled();

    await send(page, "redirect e2e");
    await expect(page.getByTestId("assistant-message").last()).toContainText("steered: redirect e2e", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: /^Stop$/i })).toHaveCount(0);
  });
});
