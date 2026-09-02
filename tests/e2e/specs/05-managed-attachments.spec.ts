import { expect, test, type Locator, type Page } from "@playwright/test";

async function createBot(page: Page, name: string): Promise<string> {
  await page.getByTestId("sidebar-create-bot").click();
  await page.getByTestId("create-bot-name").fill(name);
  await page.getByTestId("create-bot-instructions").fill("Inspect local attachments");
  await page.getByRole("radio", { name: /^Pi/ }).check();
  await page.getByTestId("create-bot-submit").click();

  const row = page.locator("[data-testid^='sidebar-bot-']", { hasText: name });
  await expect(row).toBeVisible();
  const testId = await row.getAttribute("data-testid");
  if (testId === null) throw new Error(`missing sidebar test id for ${name}`);
  return testId.slice("sidebar-bot-".length);
}

function composer(page: Page): Locator {
  return page.getByTestId("composer");
}

function composerInput(page: Page): Locator {
  return composer(page).locator('[contenteditable="true"]');
}

async function dropFile(page: Page, file: { name: string; mediaType: string; bytes: number[] }): Promise<void> {
  await composer(page).evaluate((element, dropped) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(dropped.bytes)], dropped.name, { type: dropped.mediaType }));
    element.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    element.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, file);
}

async function openHistory(page: Page): Promise<void> {
  await page.getByTestId("thread-history-trigger").click();
  await expect(page.getByTestId("history-dialog")).toBeVisible();
}
async function sendAndWait(page: Page, text: string): Promise<void> {
  const priorReplies = await page.getByTestId("assistant-message").count();
  await composerInput(page).fill(text);
  await composerInput(page).press("Enter");
  await page.waitForURL((url) => {
    const threadId = url.searchParams.get("thread");
    return threadId !== null && threadId !== "blank";
  });
  await expect(page.getByTestId("assistant-message")).toHaveCount(priorReplies + 1, { timeout: 15_000 });
}


test.describe("managed attachments", () => {
  test("stages with picker, restores in the same window, and stays bound to its original draft", async ({ page }) => {
    await page.goto("/");
    await createBot(page, "Attachment Draft Bot");
    await sendAndWait(page, "say: ready");
    await page.getByTestId("attachment-input").setInputFiles({
      name: "notes.txt",
      mimeType: "application/octet-stream",
      buffer: Buffer.from("window-local notes"),
    });
    const row = page.getByTestId("staged-file-row").filter({ hasText: "notes.txt" });
    await expect(row).toContainText("text/plain");
    await expect(row).toContainText("18 B");

    await composerInput(page).fill("attachment-echo");
    await openHistory(page);
    await page.getByTestId("history-new-conversation").click();
    await expect(page.getByTestId("staged-file-row")).toHaveCount(0);
    await expect(composerInput(page)).toHaveText("");

    await page.goBack();
    await expect(row).toBeVisible();
    await expect(composerInput(page)).toHaveText("attachment-echo");
    await page.reload();
    await expect(row).toBeVisible();

    const secondPage = await page.context().newPage();
    try {
      await secondPage.goto(page.url());
      await expect(secondPage.getByTestId("staged-file-row")).toHaveCount(0);
      await expect(composerInput(secondPage)).toHaveText("");
    } finally {
      await secondPage.close();
    }
  });

  test("supports dropped image previews and preserves the whole draft after unsupported media fails", async ({ page }) => {
    await page.goto("/");
    await createBot(page, "Attachment Failure Bot");

    await dropFile(page, {
      name: "pixel.png",
      mediaType: "application/octet-stream",
      bytes: [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13],
    });
    await expect(page.getByTestId("staged-image-preview")).toHaveAttribute("alt", "pixel.png");

    await page.getByTestId("attachment-input").setInputFiles({
      name: "unsupported.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nnot consumable by pi"),
    });
    await composerInput(page).fill("attachment-echo");
    await composerInput(page).press("Enter");

    await expect(composer(page)).toContainText("pi cannot consume attachment media type application/pdf");
    await expect(composerInput(page)).toHaveText("attachment-echo");
    await expect(page.getByTestId("staged-image-preview")).toHaveCount(1);
    await expect(page.getByTestId("staged-file-row").filter({ hasText: "unsupported.pdf" })).toHaveCount(1);

    await page.getByRole("button", { name: "Remove unsupported.pdf" }).click();
    await expect(page.getByTestId("staged-file-row").filter({ hasText: "unsupported.pdf" })).toHaveCount(0);
    await composerInput(page).press("Enter");
    await page.waitForURL((url) => {
      const threadId = url.searchParams.get("thread");
      return threadId !== null && threadId !== "blank";
    });
    await expect(page.getByTestId("staged-attachment")).toHaveCount(0);
    await expect(composerInput(page)).toHaveText("");
    await expect(page.getByTestId("message-image-attachment")).toHaveAttribute("src", /\/api\/attachments\/att_/);
  });

  test("drops missing staged references on reload with a contextual notice", async ({ page }) => {
    await page.goto("/");
    const botId = await createBot(page, "Attachment Restore Bot");
    await page.getByTestId("attachment-input").setInputFiles({
      name: "temporary.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("temporary"),
    });
    const attachmentId = await page.getByTestId("staged-attachment").getAttribute("data-attachment-id");
    if (attachmentId === null) throw new Error("staged attachment id missing");
    const deleted = await page.request.delete(`/api/attachments/staged/${attachmentId}`);
    expect(deleted.status()).toBe(204);

    await page.reload();
    await expect(page.getByTestId("staged-attachment")).toHaveCount(0);
    await expect(composer(page)).toContainText("A staged attachment is no longer available and was removed from this draft.");
    await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), `draft:v1:${botId}:blank`)).toBeNull();
  });
});
