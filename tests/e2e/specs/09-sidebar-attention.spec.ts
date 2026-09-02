import { expect, test, type Locator, type Page } from "@playwright/test";

async function createBot(page: Page, name: string): Promise<string> {
  await page.getByTestId("sidebar-create-bot").click();
  await page.getByTestId("create-bot-name").fill(name);
  await page.getByTestId("create-bot-instructions").fill("Sidebar attention E2E bot");
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

async function sendAndWait(page: Page, text: string): Promise<void> {
  const priorReplies = await page.getByTestId("assistant-message").count();
  await composerInput(page).fill(text);
  await composerInput(page).press("Enter");
  await expect(page.getByTestId("assistant-message")).toHaveCount(priorReplies + 1, { timeout: 15_000 });
}

async function currentThreadId(page: Page): Promise<string> {
  await page.waitForURL((url) => {
    const threadId = url.searchParams.get("thread");
    return threadId !== null && threadId !== "blank";
  });
  const threadId = new URL(page.url()).searchParams.get("thread");
  if (threadId === null || threadId === "blank") throw new Error("expected a persisted Thread");
  return threadId;
}

async function postMessage(page: Page, threadId: string, text: string): Promise<void> {
  const response = await page.request.post(`/api/threads/${threadId}/messages`, { data: { text } });
  expect(response.status()).toBe(202);
}

async function scrollTranscriptToTop(page: Page): Promise<void> {
  await page.getByTestId("transcript-attention").evaluate((root) => {
    const container = root as HTMLElement;
    const candidates: HTMLElement[] = [container, ...container.querySelectorAll<HTMLElement>("*")];
    let ancestor = container.parentElement;
    while (ancestor !== null) {
      candidates.push(ancestor);
      ancestor = ancestor.parentElement;
    }
    const viewport = candidates.find((candidate) => candidate.scrollHeight > candidate.clientHeight + 8);
    if (viewport === undefined) throw new Error("transcript did not overflow");
    viewport.scrollTop = 0;
    viewport.dispatchEvent(new Event("scroll", { bubbles: false }));
  });
}

test.describe("Sidebar attention", () => {
  test("pins without changing recency and startup still opens the most recently active Bot", async ({ page }) => {
    await page.goto("/");
    const pinnedBotId = await createBot(page, `Pinned older ${Date.now()}`);
    await sendAndWait(page, "say: older useful preview");
    const pinnedThreadId = await currentThreadId(page);

    await page.getByTestId(`sidebar-bot-actions-${pinnedBotId}`).click();
    await page.getByRole("menuitem", { name: /^Pin/ }).click();
    await expect(page.getByTestId(`sidebar-pinned-${pinnedBotId}`)).toBeVisible();
    await expect(page.locator("[data-testid^='sidebar-bot-bot_']").first()).toHaveAttribute("data-testid", `sidebar-bot-${pinnedBotId}`);

    const recentBotId = await createBot(page, `Recent unpinned ${Date.now()}`);
    await sendAndWait(page, "say: newest useful preview");
    await expect(page.locator("[data-testid^='sidebar-bot-bot_']").first()).toHaveAttribute("data-testid", `sidebar-bot-${pinnedBotId}`);

    await page.goto("/");
    await expect(page).toHaveURL(new RegExp(`(?:\\?|&)bot=${recentBotId}(?:&|$)`));
    const pinnedThreads = await page.request.get(`/api/bots/${pinnedBotId}/threads`);
    const threads = await pinnedThreads.json() as Array<{ id: string }>;
    expect(threads[0]?.id).toBe(pinnedThreadId);
  });

  test("keeps unread while above the latest output and clears it after Jump to latest", async ({ page }) => {
    await page.goto("/");
    const botId = await createBot(page, `Unread boundary ${Date.now()}`);
    for (let index = 0; index < 5; index += 1) {
      await sendAndWait(page, `say: ${index} ${"long transcript output ".repeat(20)}`);
    }
    const threadId = await currentThreadId(page);
    await scrollTranscriptToTop(page);

    await postMessage(page, threadId, "say: background output at the precise read boundary");
    await expect(page.getByTestId(`sidebar-unread-${botId}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("jump-to-latest")).toBeVisible();

    await page.getByTestId("jump-to-latest").click();
    await expect(page.getByTestId(`sidebar-unread-${botId}`)).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId("jump-to-latest")).toHaveCount(0);
  });

  test("suppresses focused viewed-Bot notifications and notifies for another Bot without prompting", async ({ page }) => {
    await page.addInitScript(() => {
      const state = globalThis as typeof globalThis & {
        __notificationCalls: Array<{ title: string; body?: string }>;
        __notificationPermissionRequests: number;
      };
      state.__notificationCalls = [];
      state.__notificationPermissionRequests = 0;
      class NotificationStub {
        static permission: NotificationPermission = "granted";
        static async requestPermission(): Promise<NotificationPermission> {
          state.__notificationPermissionRequests += 1;
          return "granted";
        }
        constructor(title: string, options?: NotificationOptions) {
          state.__notificationCalls.push({ title, ...(options?.body !== undefined ? { body: options.body } : {}) });
        }
      }
      Object.defineProperty(globalThis, "Notification", { configurable: true, value: NotificationStub });
    });
    await page.goto("/");

    const affectedBotId = await createBot(page, `Notification target ${Date.now()}`);
    await sendAndWait(page, "say: focused completion is quiet");
    const affectedThreadId = await currentThreadId(page);
    await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __notificationCalls: unknown[] }).__notificationCalls.length)).toBe(0);

    await createBot(page, `Other selected ${Date.now()}`);
    await postMessage(page, affectedThreadId, "say: background completion notifies");
    await expect.poll(() => page.evaluate(() => (globalThis as typeof globalThis & { __notificationCalls: unknown[] }).__notificationCalls.length), { timeout: 15_000 }).toBe(1);
    const notification = await page.evaluate(() => (globalThis as typeof globalThis & { __notificationCalls: Array<{ title: string }> }).__notificationCalls[0]);
    expect(notification?.title).toContain("finished working");
    expect(notification?.title).toContain("Notification target");
    expect(await page.evaluate(() => (globalThis as typeof globalThis & { __notificationPermissionRequests: number }).__notificationPermissionRequests)).toBe(0);
    await expect(page.getByTestId(`sidebar-unread-${affectedBotId}`)).toBeVisible();
  });
});
