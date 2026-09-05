import { expect, test, type Page, type Route } from "@playwright/test";
import type { WorkingTreeDetailDto, WorkingTreeSummaryDto } from "../../../packages/protocol/src/index.ts";

const GENERATED_AT = "2026-09-05T12:00:00.000Z";

async function createBot(page: Page, name: string): Promise<string> {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Bot navigation" }).getByRole("button", { name: "New bot" }).click();
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await page.getByRole("textbox", { name: "Job / Instructions" }).fill("Review working-tree state.");
  await page.getByRole("radio", { name: /^Pi/ }).check();
  await page.getByRole("button", { name: "Create bot" }).click();
  await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  const botId = new URL(page.url()).searchParams.get("bot");
  if (botId === null) throw new Error(`Missing selected Bot id for ${name}.`);
  return botId;
}

async function sendMessage(page: Page, text: string): Promise<string> {
  const input = page.getByRole("textbox", { name: "Message input" });
  await input.fill(text);
  await input.press("Enter");
  await page.waitForURL((url) => {
    const threadId = url.searchParams.get("thread");
    return threadId !== null && threadId !== "blank";
  });
  await expect(page.getByTestId("assistant-message").last()).toBeVisible();
  return new URL(page.url()).searchParams.get("thread")!;
}

function workspaceSummary(label: string): WorkingTreeSummaryDto {
  return {
    state: "ready",
    generatedAt: GENERATED_AT,
    changedFileCount: 1,
    additions: 1,
    deletions: 0,
    truncated: false,
    files: [{
      path: `src/${label}.ts`,
      status: "modified",
      counts: { kind: "known", additions: 1, deletions: 0 },
    }],
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

const ready: WorkingTreeSummaryDto = {
  state: "ready",
  generatedAt: GENERATED_AT,
  changedFileCount: 5,
  additions: 8,
  deletions: 3,
  truncated: true,
  files: [
    { path: "src/modified.ts", status: "modified", counts: { kind: "known", additions: 3, deletions: 2 } },
    { path: "src/new file.ts", status: "added", counts: { kind: "known", additions: 5, deletions: 0 } },
    { path: "notes\tfor release.txt", status: "untracked", counts: { kind: "unknown" } },
    { path: "assets/logo.bin", status: "modified", counts: { kind: "binary" } },
    {
      path: "src/current-name.ts",
      previousPath: "src/previous-name.ts",
      status: "renamed",
      counts: { kind: "known", additions: 0, deletions: 1 },
    },
  ],
};

function versionedSummary(version: number): WorkingTreeSummaryDto {
  return {
    state: "ready",
    generatedAt: GENERATED_AT,
    changedFileCount: version,
    additions: version,
    deletions: 0,
    truncated: false,
    files: [{
      path: "src/modified.ts",
      status: "modified",
      counts: { kind: "known", additions: version, deletions: 0 },
    }],
  };
}

function versionedDetail(version: number): WorkingTreeDetailDto {
  return {
    kind: "text",
    path: "src/modified.ts",
    status: "modified",
    patch: `diff --git a/src/modified.ts b/src/modified.ts\n+refresh version ${version}\n`,
    truncated: false,
  };
}

test.describe("working-tree Changes capability", () => {
  test("presents public loading, summary, empty, unavailable, retry, and truncated states without changing Browser layout", async ({ page }) => {
    let response: WorkingTreeSummaryDto = ready;
    let releaseInitial: (() => void) | undefined;
    const initialGate = new Promise<void>((resolve) => {
      releaseInitial = resolve;
    });
    let requests = 0;
    await page.route("**/api/bots/*/changes*", async (route) => {
      requests += 1;
      if (requests === 1) await initialGate;
      await fulfillJson(route, response);
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await createBot(page, "Changes Browser Bot");
    const conversation = page.getByLabel("Conversation workspace");
    const computerTrigger = page.getByRole("button", { name: "Open Computer Surface", exact: true });
    await computerTrigger.click();

    const capabilities = page.getByRole("complementary", { name: "Workspace capabilities" });
    await expect(capabilities).toBeVisible();
    await expect(capabilities.getByRole("tab", { name: "Browser" })).toHaveAttribute("aria-selected", "true");
    await expect(capabilities.getByRole("tabpanel", { name: "Browser" })).toBeVisible();
    await expect(capabilities.getByRole("heading", { name: "Changes Browser Bot’s screen" })).toBeVisible();
    await expect(conversation).toBeVisible();

    await capabilities.getByRole("tab", { name: "Changes" }).click();
    await expect(capabilities.getByRole("tabpanel", { name: "Changes" })).toBeVisible();
    await expect(capabilities.getByRole("status", { name: "Loading working tree changes" })).toBeVisible();
    releaseInitial?.();

    await expect(capabilities.getByRole("heading", { name: "Working tree changes" })).toBeVisible();
    await expect(capabilities.getByText("5 changed files", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("Known line changes: +8 −3", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("src/modified.ts", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("src/new file.ts", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("notes\tfor release.txt", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("assets/logo.bin", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("Renamed from src/previous-name.ts", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("Binary", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("Counts unavailable", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("New", { exact: true })).toHaveCount(2);
    await expect(capabilities.getByText("Results truncated", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("Showing 5 of 5 changed files.", { exact: true })).toBeVisible();

    response = {
      state: "unavailable",
      generatedAt: GENERATED_AT,
      message: "Git timed out while reading changes.",
      retryable: true,
    };
    await page.reload();
    await computerTrigger.click();
    await expect(capabilities.getByRole("tabpanel", { name: "Browser" })).toBeVisible();
    await capabilities.getByRole("tab", { name: "Changes" }).click();
    await expect(capabilities.getByText("Working tree changes unavailable", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("Git timed out while reading changes.", { exact: true })).toBeVisible();

    response = { state: "clean", generatedAt: GENERATED_AT };
    await capabilities.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(capabilities.getByRole("heading", { name: "Working tree is clean" })).toBeVisible();
    await expect(capabilities.getByText("There are no uncommitted changes in this workspace.", { exact: true })).toBeVisible();

    response = { state: "not_repository", generatedAt: GENERATED_AT };
    await page.reload();
    await computerTrigger.click();
    await capabilities.getByRole("tab", { name: "Changes" }).click();
    await expect(capabilities.getByRole("heading", { name: "Not a Git repository" })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 780 });
    await expect(capabilities).toBeVisible();
    await expect(conversation).toHaveCount(0);
    await capabilities.getByRole("tab", { name: "Browser" }).click();
    await expect(capabilities.getByRole("tabpanel", { name: "Browser" })).toBeVisible();
  });

  test("refreshes Changes only while visible and refreshes selected detail on demand", async ({ page }) => {
    await page.clock.install({ time: new Date(GENERATED_AT) });
    const stalePoll = Promise.withResolvers<void>();
    let version = 1;
    let summaryRequests = 0;
    let detailRequests = 0;
    await page.route(/\/api\/bots\/[^/]+\/changes(?:\/detail)?(?:\?|$)/, async (route) => {
      const url = new URL(route.request().url());
      const requestVersion = version;
      if (url.pathname.endsWith("/detail")) {
        detailRequests += 1;
        await fulfillJson(route, versionedDetail(requestVersion));
        return;
      }
      summaryRequests += 1;
      if (summaryRequests === 3) await stalePoll.promise;
      await fulfillJson(route, versionedSummary(requestVersion));
    });
    await createBot(page, "Refreshing Changes Bot");
    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    const capabilities = page.getByRole("complementary", { name: "Workspace capabilities" });
    await expect(capabilities.getByRole("tabpanel", { name: "Browser" })).toBeVisible();
    expect(summaryRequests).toBe(0);

    await capabilities.getByRole("tab", { name: "Changes" }).click();
    await expect.poll(() => summaryRequests).toBe(1);
    await expect(capabilities.getByText("1 changed file", { exact: true })).toBeVisible();
    await capabilities.getByText("src/modified.ts", { exact: true }).click();
    await expect(capabilities.getByLabel("File detail for src/modified.ts")).toContainText("refresh version 1");
    expect(detailRequests).toBe(1);

    await capabilities.getByRole("tab", { name: "Browser" }).click();
    await page.clock.fastForward(45_000);
    expect(summaryRequests).toBe(1);
    const activationRefresh = page.waitForResponse((response) =>
      /\/api\/bots\/[^/]+\/changes$/u.test(new URL(response.url()).pathname)
    );
    await capabilities.getByRole("tab", { name: "Changes" }).click();
    await activationRefresh;
    await expect.poll(() => summaryRequests).toBe(2);
    await expect(capabilities.getByLabel("File detail for src/modified.ts")).toBeVisible();

    await page.clock.runFor(30_000);
    await expect.poll(() => summaryRequests).toBe(3);

    version = 2;
    await capabilities.getByRole("button", { name: "Refresh changes", exact: true }).click();
    await expect.poll(() => summaryRequests).toBe(4);
    await expect.poll(() => detailRequests).toBeGreaterThanOrEqual(2);
    await expect(capabilities.getByText("2 changed files", { exact: true })).toBeVisible();
    await expect(capabilities.getByLabel("File detail for src/modified.ts")).toContainText("refresh version 2");
    stalePoll.resolve();
    await expect(capabilities.getByText("2 changed files", { exact: true })).toBeVisible();

    await capabilities.getByRole("button", { name: "Close capabilities" }).click();
    await page.clock.fastForward(45_000);
    expect(summaryRequests).toBe(4);
  });

  test("keeps the current file selected when an older refresh removes the previous selection", async ({ page }) => {
    await page.clock.install({ time: new Date(GENERATED_AT) });
    const refreshStarted = Promise.withResolvers<void>();
    const releaseRefresh = Promise.withResolvers<void>();
    let summaryRequests = 0;
    let detailVersion = 1;
    await page.route(/\/api\/bots\/[^/]+\/changes(?:\/detail)?(?:\?|$)/, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("/detail")) {
        const path = url.searchParams.get("path")!;
        await fulfillJson(route, {
          kind: "text",
          path,
          status: "modified",
          patch: `+${path} detail version ${detailVersion}\n`,
          truncated: false,
        } satisfies WorkingTreeDetailDto);
        return;
      }
      summaryRequests += 1;
      if (summaryRequests === 1) {
        await fulfillJson(route, {
          state: "ready",
          generatedAt: GENERATED_AT,
          truncated: false,
          changedFileCount: 2,
          additions: 2,
          files: [
            { path: "src/a.ts", status: "modified", counts: { kind: "known", additions: 1, deletions: 0 } },
            { path: "src/b.ts", status: "modified", counts: { kind: "known", additions: 1, deletions: 0 } },
          ],
        } satisfies WorkingTreeSummaryDto);
        return;
      }
      refreshStarted.resolve();
      await releaseRefresh.promise;
      await fulfillJson(route, workspaceSummary("b"));
    });

    await createBot(page, "Refresh Selection Bot");
    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    const capabilities = page.getByRole("complementary", { name: "Workspace capabilities" });
    await capabilities.getByRole("tab", { name: "Changes" }).click();
    await capabilities.getByText("src/a.ts", { exact: true }).click();
    await expect(capabilities.getByLabel("File detail for src/a.ts")).toContainText("src/a.ts detail version 1");

    await capabilities.getByRole("button", { name: "Refresh changes", exact: true }).click();
    await refreshStarted.promise;
    await capabilities.getByText("src/b.ts", { exact: true }).click();
    const selectedDetail = capabilities.getByLabel("File detail for src/b.ts");
    await expect(selectedDetail).toContainText("src/b.ts detail version 1");

    detailVersion = 2;
    releaseRefresh.resolve();
    await expect(capabilities.getByText("1 changed file", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("src/a.ts", { exact: true })).toHaveCount(0);
    await expect(selectedDetail).toContainText("src/b.ts detail version 2");
    await expect(capabilities.getByLabel("File detail for src/a.ts")).toHaveCount(0);
  });

  test("isolates late Changes responses across Threads and Bots while keeping one right region", async ({ page }) => {
    const botAId = await createBot(page, "Isolation Bot A");
    const threadOneId = await sendMessage(page, "say: Thread one workspace");
    await page.getByRole("button", { name: "Open conversation history" }).click();
    await page.getByRole("button", { name: "New conversation" }).click();
    const threadTwoId = await sendMessage(page, "say: Thread two workspace");
    const botBId = await createBot(page, "Isolation Bot B");
    const staleSummary = Promise.withResolvers<void>();
    const nextThreadSummary = Promise.withResolvers<void>();
    const staleDetail = Promise.withResolvers<void>();
    const nextBotSummary = Promise.withResolvers<void>();
    const summaryRequests = new Map<string, number>();

    await page.route(/\/api\/bots\/[^/]+\/changes(?:\/detail)?(?:\?|$)/, async (route) => {
      const url = new URL(route.request().url());
      const botId = url.pathname.split("/")[3]!;
      const threadId = url.searchParams.get("threadId") ?? "blank";
      if (url.pathname.endsWith("/detail")) {
        if (botId === botAId && threadId === threadOneId) await staleDetail.promise;
        await fulfillJson(route, {
          kind: "text",
          path: `src/${threadId}.ts`,
          status: "modified",
          patch: `+detail from ${threadId}\n`,
          truncated: false,
        } satisfies WorkingTreeDetailDto);
        return;
      }

      const key = `${botId}:${threadId}`;
      const requestCount = (summaryRequests.get(key) ?? 0) + 1;
      summaryRequests.set(key, requestCount);
      if (botId === botAId && threadId === threadTwoId && requestCount === 2) await staleSummary.promise;
      if (botId === botAId && threadId === threadOneId) await nextThreadSummary.promise;
      if (botId === botBId) await nextBotSummary.promise;
      await fulfillJson(route, workspaceSummary(threadId === "blank" ? "bot-b" : threadId));
    });

    await page.clock.install({ time: new Date(GENERATED_AT) });
    await page.getByRole("button", { name: "Isolation Bot A", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`bot=${botAId}.*thread=${threadTwoId}`));
    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    const capabilities = page.getByRole("complementary", { name: "Workspace capabilities" });
    const settings = page.getByRole("complementary", { name: "Bot settings" });
    await capabilities.getByRole("tab", { name: "Changes" }).click();
    await expect(capabilities.getByText(`src/${threadTwoId}.ts`, { exact: true })).toBeVisible();

    await page.clock.fastForward(15_000);
    await expect.poll(() => summaryRequests.get(`${botAId}:${threadTwoId}`)).toBe(2);
    await page.getByRole("button", { name: "Open conversation history" }).click();
    await page.getByRole("button", { name: /Thread one workspace/ }).click();
    await expect(page).toHaveURL(new RegExp(`thread=${threadOneId}`));
    await expect(capabilities.getByText(`src/${threadTwoId}.ts`, { exact: true })).toHaveCount(0);
    await expect(capabilities.getByRole("status", { name: "Loading working tree changes" })).toBeVisible();
    staleSummary.resolve();
    await expect(capabilities.getByText(`src/${threadTwoId}.ts`, { exact: true })).toHaveCount(0);
    nextThreadSummary.resolve();
    await expect(capabilities.getByText(`src/${threadOneId}.ts`, { exact: true })).toBeVisible();

    await capabilities.getByText(`src/${threadOneId}.ts`, { exact: true }).click();
    await expect(capabilities.getByRole("status", { name: `Loading detail for src/${threadOneId}.ts` })).toBeVisible();
    await page.getByRole("button", { name: "Isolation Bot B", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`bot=${botBId}`));
    await expect(capabilities.getByLabel(`File detail for src/${threadOneId}.ts`)).toHaveCount(0);
    await expect(capabilities.getByText(`src/${threadOneId}.ts`, { exact: true })).toHaveCount(0);
    staleDetail.resolve();
    await expect(capabilities.getByText(`detail from ${threadOneId}`, { exact: false })).toHaveCount(0);
    nextBotSummary.resolve();
    await expect(capabilities.getByText("src/bot-b.ts", { exact: true })).toBeVisible();

    const botBRequests = summaryRequests.get(`${botBId}:blank`) ?? 0;
    const botARequests = summaryRequests.get(`${botAId}:${threadOneId}`) ?? 0;
    await page.clock.fastForward(15_000);
    await expect.poll(() => summaryRequests.get(`${botBId}:blank`)).toBe(botBRequests + 1);
    expect(summaryRequests.get(`${botAId}:${threadOneId}`)).toBe(botARequests);
    await capabilities.getByRole("tab", { name: "Browser" }).click();
    await page.clock.fastForward(45_000);
    expect(summaryRequests.get(`${botBId}:blank`)).toBe(botBRequests + 1);

    await page.getByRole("button", { name: "Open settings for Isolation Bot B" }).click();
    await expect(capabilities).toHaveCount(0);
    await expect(settings).toBeVisible();
    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    await expect(settings).toHaveCount(0);
    await expect(capabilities).toBeVisible();
    await expect(capabilities.getByRole("tab", { name: "Browser" })).toHaveAttribute("aria-selected", "true");
  });

  test("opens and replaces bounded file detail without displaying stale content", async ({ page }) => {
    let addedRelease: (() => void) | undefined;
    const addedGate = new Promise<void>((resolve) => {
      addedRelease = resolve;
    });
    let unknownRequests = 0;
    await page.route(/\/api\/bots\/[^/]+\/changes(?:\/detail)?(?:\?|$)/, async (route) => {
      const url = new URL(route.request().url());
      if (!url.pathname.endsWith("/detail")) {
        await fulfillJson(route, ready);
        return;
      }
      const filePath = url.searchParams.get("path");
      let response: WorkingTreeDetailDto;
      if (filePath === "src/modified.ts") {
        response = {
          kind: "text",
          path: filePath,
          status: "modified",
          patch: "diff --git a/src/modified.ts b/src/modified.ts\n-old value\n+new value\n",
          truncated: true,
        };
      } else if (filePath === "src/new file.ts") {
        await addedGate;
        response = {
          kind: "text",
          path: filePath,
          status: "added",
          patch: "diff --git a/src/new file.ts b/src/new file.ts\n+replacement detail\n",
          truncated: false,
        };
      } else if (filePath === "src/current-name.ts") {
        response = {
          kind: "text",
          path: filePath,
          previousPath: "src/previous-name.ts",
          status: "renamed",
          patch: "rename from src/previous-name.ts\nrename to src/current-name.ts\n",
          truncated: false,
        };
      } else if (filePath === "assets/logo.bin") {
        response = { kind: "binary", path: filePath, status: "modified" };
      } else {
        unknownRequests += 1;
        if (unknownRequests === 1) {
          await fulfillJson(route, { error: "Changed file is no longer available." }, 404);
          return;
        }
        response = {
          kind: "unknown",
          path: "notes\tfor release.txt",
          status: "untracked",
          message: "No textual patch is available for this changed file.",
        };
      }
      await fulfillJson(route, response);
    });

    await createBot(page, "Detail Browser Bot");
    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    const capabilities = page.getByRole("complementary", { name: "Workspace capabilities" });
    await capabilities.getByRole("tab", { name: "Changes" }).click();
    await expect(capabilities.getByText("src/modified.ts", { exact: true })).toBeVisible();

    await capabilities.getByText("src/modified.ts", { exact: true }).click();
    await expect(capabilities.getByLabel("File detail for src/modified.ts")).toBeVisible();
    await expect(capabilities.getByLabel("File detail for src/modified.ts")).toContainText("+new value");
    await expect(capabilities.getByText("File detail truncated", { exact: true })).toBeVisible();

    await capabilities.getByText("src/new file.ts", { exact: true }).click();
    await expect(capabilities.getByLabel("File detail for src/new file.ts")).not.toContainText("+new value");
    await expect(capabilities.getByRole("status", { name: "Loading detail for src/new file.ts" })).toBeVisible();
    addedRelease?.();
    await expect(capabilities.getByLabel("File detail for src/new file.ts")).toContainText("+replacement detail");

    await capabilities.getByText("src/current-name.ts", { exact: true }).click();
    await expect(capabilities.getByText("Renamed from src/previous-name.ts", { exact: true })).toHaveCount(2);
    await expect(capabilities.getByLabel("File detail for src/current-name.ts")).toContainText("rename to src/current-name.ts");

    await capabilities.getByText("assets/logo.bin", { exact: true }).click();
    await expect(capabilities.getByText("Binary file", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("A textual patch is not available. Line counts remain unspecified.", { exact: true })).toBeVisible();

    await capabilities.getByText("notes\tfor release.txt", { exact: true }).click();
    await expect(capabilities.getByText("File detail unavailable", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("Changed file is no longer available.", { exact: true })).toBeVisible();
    await capabilities.getByRole("button", { name: "Retry detail", exact: true }).click();
    await expect(capabilities.getByText("Text detail unavailable", { exact: true })).toBeVisible();
    await expect(capabilities.getByText("No textual patch is available for this changed file.", { exact: true })).toBeVisible();
  });
});
