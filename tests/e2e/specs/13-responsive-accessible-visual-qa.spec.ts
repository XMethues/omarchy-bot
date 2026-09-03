import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page, type Route } from "@playwright/test";

const PRIMARY_BOT_ID = "bot_ticket13_primary";
const SECONDARY_BOT_ID = "bot_ticket13_unavailable";
const THREAD_ID = "thread_ticket13_release_review";
const FIXED_EARLY = "2026-01-15T09:00:00.000Z";
const FIXED_LATE = "2026-01-15T10:00:00.000Z";
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const desktopViewport = { width: 1440, height: 900 };
const reducedMotionViewport = { width: 1024, height: 768 };
const narrowViewport = { width: 390, height: 780 };

type BotStatus = "idle" | "working";
type ComputerState = "ready" | "bot-using" | "unavailable";

interface SeedOptions {
  empty?: boolean;
  primaryStatus?: BotStatus;
  computerState?: ComputerState;
  messagesGate?: Promise<void>;
}

const avatar = (seed: string) => ({
  kind: "generated",
  recipe: {
    rendererVersion: "dicebear-core@10.7.0+styles@10.6.0",
    style: "shapes",
    seed,
    options: {},
  },
});

function botFixtures(primaryStatus: BotStatus) {
  return [
    {
      id: PRIMARY_BOT_ID,
      name: "Release Partner",
      instructions: "Keep the release review concise and actionable.",
      agentId: "pi",
      avatar: avatar("ticket-13-release-partner"),
      pinned: true,
      archived: false,
      createdAt: FIXED_EARLY,
      updatedAt: FIXED_LATE,
      status: primaryStatus,
      unreadCount: 0,
      previewText: "The release checklist is ready.",
      previewAt: FIXED_LATE,
      lastActivityAt: FIXED_LATE,
    },
    {
      id: SECONDARY_BOT_ID,
      name: "Offline Researcher",
      instructions: "Collect primary-source research.",
      agentId: "claude",
      avatar: avatar("ticket-13-offline-researcher"),
      pinned: false,
      archived: false,
      createdAt: FIXED_EARLY,
      updatedAt: FIXED_EARLY,
      status: "unavailable",
      unreadCount: 0,
      previewText: "Waiting for its agent.",
      previewAt: FIXED_EARLY,
      lastActivityAt: FIXED_EARLY,
    },
  ];
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function seedWorkspaceApi(page: Page, options: SeedOptions = {}): Promise<void> {
  const bots = options.empty ? [] : botFixtures(options.primaryStatus ?? "idle");

  await page.route("**/api/agents", (route) =>
    fulfillJson(route, [
      {
        id: "pi",
        displayName: "Pi",
        version: "fixture",
        status: "ready",
        capabilities: {
          version: 1,
          steering: true,
          abort: true,
          sessionDeletion: false,
          nativeThreadActions: ["resume", "history", "close"],
          attachments: { text: true, image: false, maxTextBytes: 64 * 1024 },
          nativeEventFamilies: ["message", "tool", "turn", "error"],
        },
      },
      {
        id: "claude",
        displayName: "Claude",
        version: "fixture",
        status: "offline",
        guidance: "Reconnect Claude before sending a message.",
      },
    ]),
  );
  await page.route("**/api/bots*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/bots" || route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await fulfillJson(route, bots);
  });
  await page.route("**/api/bots/*/threads*", async (route) => {
    const url = new URL(route.request().url());
    const botId = url.pathname.split("/")[3];
    await fulfillJson(
      route,
      botId === PRIMARY_BOT_ID
        ? [
            {
              id: THREAD_ID,
              botId: PRIMARY_BOT_ID,
              title: "Release readiness review",
              createdAt: FIXED_EARLY,
              updatedAt: FIXED_LATE,
            },
          ]
        : [],
    );
  });
  await page.route(`**/api/threads/${THREAD_ID}/messages`, async (route) => {
    await options.messagesGate;
    await fulfillJson(route, [
      {
        id: "message_ticket13_user",
        threadId: THREAD_ID,
        seq: 1,
        author: { kind: "user" },
        kind: "text",
        text: "Review the release checklist and call out the final risk.",
        createdAt: FIXED_EARLY,
      },
      {
        id: "message_ticket13_bot",
        threadId: THREAD_ID,
        seq: 2,
        author: { kind: "bot" },
        kind: "text",
        text: "The checklist is complete. The final risk is the rollback rehearsal; schedule it before approval.",
        createdAt: FIXED_LATE,
      },
    ]);
  });
  await page.route("**/api/dictation", (route) => fulfillJson(route, { state: "idle" }));
  await page.route("**/api/computer/state**", (route) => {
    const state = options.computerState ?? "ready";
    const url = new URL(route.request().url());
    return fulfillJson(route, {
      state,
      botId: url.searchParams.get("botId"),
      surfaceId: url.searchParams.get("surfaceId"),
      takeover: "unavailable",
      activity:
        state === "unavailable"
          ? "Screen unavailable."
          : state === "bot-using"
            ? "Bot using screen."
            : "Screen ready.",
    });
  });
  await page.route("**/api/computer/snapshot**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: ONE_PIXEL_PNG }),
  );
}

async function gotoSeededWorkspace(page: Page, empty = false): Promise<void> {
  const initialResponses = [
    page.waitForResponse((response) => new URL(response.url()).pathname === "/api/agents"),
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/bots" && url.search === "";
    }),
  ];
  if (!empty) {
    initialResponses.push(
      page.waitForResponse((response) => new URL(response.url()).pathname === `/api/bots/${PRIMARY_BOT_ID}/threads`),
      page.waitForResponse((response) => new URL(response.url()).pathname === `/api/threads/${THREAD_ID}/messages`),
    );
  }

  await Promise.all([page.goto("/", { waitUntil: "domcontentloaded" }), ...initialResponses]);
  if (empty) {
    await expect(page.getByRole("heading", { name: "Create your first bot" })).toBeVisible();
  } else {
    await expect(page.getByRole("heading", { level: 1, name: "Release Partner" })).toBeVisible();
    await expect(page.getByTestId("assistant-message").last()).toContainText("rollback rehearsal");
  }
  await page.evaluate(async () => document.fonts.ready);
}

async function expectNoSeriousOrCriticalViolations(page: Page, state: string): Promise<void> {
  const result = await new AxeBuilder({ page }).analyze();
  const violations = result.violations.filter(
    (violation) => violation.impact === "serious" || violation.impact === "critical",
  );
  const detail = violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact}): ${violation.help}\n${violation.nodes
          .map((node) => `  ${JSON.stringify(node.target)} — ${node.failureSummary ?? "No failure summary"}`)
          .join("\n")}\n  ${violation.helpUrl}`,
    )
    .join("\n\n");

  expect(violations, `${state} has serious/critical axe violations${detail.length > 0 ? `:\n${detail}` : ""}`).toEqual([]);
}

async function expectInsideViewport(page: Page, locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box, "visible surface must have a bounding box").not.toBeNull();
  expect(viewport, "test must use a fixed viewport").not.toBeNull();
  if (box === null || viewport === null) return;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectWorkspaceContract(page: Page): Promise<void> {
  await expect(page.getByRole("navigation", { includeHidden: true })).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Attach files" })).toBeVisible();
  await expect(page.getByLabel("Choose files to attach")).toBeHidden();
  await expect(page.getByRole("button", { name: "Attach files" })).toHaveCount(1);

  const composerInput = page.getByRole("textbox", { name: "Message input" });
  await expect(composerInput).toBeEnabled();
  await composerInput.fill("A keyboard-ready draft");
  await expect(composerInput).toHaveText("A keyboard-ready draft");
  await composerInput.fill("");
  const selectedBotButton = page.getByRole("button", { name: "Release Partner", exact: true });
  await expect(selectedBotButton).toHaveCount((await page.getByRole("navigation", { name: "Bot navigation" }).isVisible()) ? 1 : 0);
}

async function prepareVisualCapture(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-delay: 0s !important;
        animation-duration: 0s !important;
        transition-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
      time { visibility: hidden !important; }
    `,
  });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
}

async function captureWorkspace(page: Page, name: string): Promise<void> {
  await prepareVisualCapture(page);
  await expect(page).toHaveScreenshot(name, {
    animations: "disabled",
    caret: "hide",
  });
}

test.describe("ticket 13 responsive, accessible, and visual QA", () => {
  test("has no serious or critical axe violations in the empty workspace", async ({ page }) => {
    await page.setViewportSize(desktopViewport);
    await seedWorkspaceApi(page, { empty: true });
    await gotoSeededWorkspace(page, true);

    await expect(page.getByRole("navigation", { includeHidden: true })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expectNoSeriousOrCriticalViolations(page, "Empty workspace");
  });

  test("has no serious or critical axe violations in a populated workspace", async ({ page }) => {
    await page.setViewportSize(desktopViewport);
    await seedWorkspaceApi(page);
    await gotoSeededWorkspace(page);

    await expectWorkspaceContract(page);
    await expectNoSeriousOrCriticalViolations(page, "Populated workspace");
  });
  test("renders stateful DiceBear avatars without animating idle bots", async ({ page }) => {
    await page.setViewportSize(desktopViewport);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
    await seedWorkspaceApi(page);
    await gotoSeededWorkspace(page);

    const selectedRow = page.getByTestId(`sidebar-bot-${PRIMARY_BOT_ID}`);
    const selectedButton = selectedRow.getByRole("button", { name: "Release Partner", exact: true });
    const selectedPreview = selectedButton.getByText("The release checklist is ready.", { exact: true });
    await expect(selectedPreview).toBeVisible();

    const selectedAvatar = selectedRow.getByTestId("avatar-view");
    const selectedRowBox = await selectedRow.boundingBox();
    const selectedAvatarBox = await selectedAvatar.boundingBox();
    const selectedName = selectedButton.getByText("Release Partner", { exact: true });
    const selectedNameBox = await selectedName.boundingBox();
    const selectedPreviewBox = await selectedPreview.boundingBox();
    if (!selectedRowBox || !selectedAvatarBox || !selectedNameBox || !selectedPreviewBox) {
      throw new Error("Sidebar Bot summary geometry is unavailable");
    }
    expect(selectedRowBox.height).toBe(56);
    expect(selectedAvatarBox.width).toBe(42);
    expect(Number(await selectedName.evaluate((element) => getComputedStyle(element).fontWeight))).toBeGreaterThanOrEqual(600);
    expect(selectedPreviewBox.y).toBeGreaterThan(selectedNameBox.y);

    const selectedImage = selectedAvatar.getByTestId("avatar-shapes").locator("img");
    const selectedSrc = await selectedImage.getAttribute("src");
    expect(selectedSrc).toMatch(/^data:image\/svg\+xml/);
    const selectedSvg = decodeURIComponent(selectedSrc!.slice(selectedSrc!.indexOf(",") + 1));
    expect(selectedSvg).toContain("@keyframes");
    expect(selectedSvg).toContain("prefers-reduced-motion");

    const idleAvatar = page.getByTestId(`sidebar-bot-${SECONDARY_BOT_ID}`).getByTestId("avatar-view");
    const idleSrc = await idleAvatar.getByTestId("avatar-shapes").locator("img").getAttribute("src");
    const idleSvg = decodeURIComponent(idleSrc!.slice(idleSrc!.indexOf(",") + 1));
    expect(idleSvg).not.toContain("@keyframes");
    await expect(page.getByTestId(`sidebar-bot-${SECONDARY_BOT_ID}`)
      .getByRole("img", { name: "Unavailable" })).toHaveCount(0);
  });


  test("keeps core workspace surfaces unclipped at desktop and narrow breakpoints", async ({ page }) => {
    await page.setViewportSize(desktopViewport);
    await seedWorkspaceApi(page);
    await gotoSeededWorkspace(page);

    await expectInsideViewport(page, page.getByRole("navigation", { name: "Bot navigation" }));
    await expectInsideViewport(page, page.getByTestId("conversation-header"));
    await expectInsideViewport(page, page.getByRole("log"));
    await expectInsideViewport(page, page.getByTestId("composer"));

    await page.setViewportSize(narrowViewport);
    await expect(page.getByRole("navigation", { name: "Bot navigation" })).toBeHidden();
    await expectInsideViewport(page, page.getByTestId("conversation-header"));
    await expectInsideViewport(page, page.getByRole("log"));
    await expectInsideViewport(page, page.getByTestId("composer"));
    await expectWorkspaceContract(page);

    await page.getByRole("button", { name: "Open conversation history" }).click();
    const history = page.getByRole("dialog", { name: "Conversation history" });
    await expectInsideViewport(page, history);
    await page.keyboard.press("Escape");
    await expect(history).toBeHidden();

    await page.getByRole("button", { name: "Open profile for Release Partner" }).click();
    const profile = page.getByRole("dialog", { name: "Bot profile" });
    await expectInsideViewport(page, profile);
    await page.keyboard.press("Escape");
    await expect(profile).toBeHidden();

    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    const computer = page.getByRole("dialog", { name: "Computer Surface" });
    await expectInsideViewport(page, computer);
    await page.keyboard.press("Escape");
    await expect(computer).toBeHidden();

    await page.getByRole("button", { name: "Open bot navigation" }).click();
    await page.getByRole("navigation", { name: "Bot navigation" }).getByRole("button", { name: "New bot" }).click();
    const createBot = page.getByRole("dialog", { name: "Create a bot" });
    await expectInsideViewport(page, createBot);
    await expect.poll(() => createBot.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(createBot).toBeHidden();

    await page.getByRole("button", { name: "Open bot navigation" }).click();
    await page.getByRole("navigation", { name: "Bot navigation" }).getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expectInsideViewport(page, settings);
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
  });

  test("shows contextual loading and unavailable states", async ({ page }) => {
    const messages = Promise.withResolvers<void>();
    await page.setViewportSize(desktopViewport);
    await seedWorkspaceApi(page, { computerState: "unavailable", messagesGate: messages.promise });

    const initialResponses = [
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/agents"),
      page.waitForResponse((response) => new URL(response.url()).pathname === "/api/bots"),
      page.waitForResponse((response) => new URL(response.url()).pathname === `/api/bots/${PRIMARY_BOT_ID}/threads`),
    ];
    await Promise.all([page.goto("/", { waitUntil: "domcontentloaded" }), ...initialResponses]);
    await expect(page.getByText("Loading conversation", { exact: true })).toBeVisible();

    messages.resolve();
    await expect(page.getByTestId("assistant-message").last()).toContainText("rollback rehearsal");

    await page.getByRole("button", { name: "Offline Researcher", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Offline Researcher" })).toBeVisible();
    await expect(page.getByText("Agent unavailable", { exact: true })).toBeVisible();
    const conversationWorkspace = page.getByLabel("Conversation workspace");
    const unavailableNotice = conversationWorkspace.getByRole("alert").filter({ hasText: "Agent unavailable" });
    await expect(unavailableNotice).toContainText("Reconnect Claude before sending a message.");
    await expect(conversationWorkspace.getByRole("alert")).toHaveCount(1);
    await expect(page.getByTestId("composer")).not.toContainText("This bot can’t send messages until its agent is ready.");
    await expect(page.getByRole("textbox", { name: "Message input" })).toHaveAttribute("contenteditable", "false");

    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    const computer = page.getByRole("complementary", { name: "Computer Surface", exact: true });
    await expect(computer.getByRole("heading", { name: "Screen unavailable", exact: true })).toBeVisible();
    await expect(computer.getByAltText("Computer Preview for Offline Researcher")).toHaveCount(0);
  });

  test("opens and closes narrow bot navigation by keyboard and closes it after bot selection", async ({ page }) => {
    await page.setViewportSize(narrowViewport);
    await seedWorkspaceApi(page);
    await gotoSeededWorkspace(page);

    const trigger = page.getByRole("button", { name: "Open bot navigation" });
    await trigger.focus();
    await trigger.press("Enter");
    const navigation = page.getByRole("navigation", { name: "Bot navigation" });
    await expect(navigation).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");

    await page.keyboard.press("Escape");
    await expect(navigation).toBeHidden();
    await expect(trigger).toBeFocused();

    await trigger.press("Enter");
    const secondaryBot = navigation.getByRole("button", { name: "Offline Researcher", exact: true });
    await secondaryBot.focus();
    await secondaryBot.press("Enter");
    await expect(navigation).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`bot=${SECONDARY_BOT_ID}`));
    await expect(page.getByRole("heading", { level: 1, name: "Offline Researcher" })).toBeVisible();
  });

  test("returns focus after profile and computer Sheet dismissal", async ({ page }) => {
    await page.setViewportSize(desktopViewport);
    await seedWorkspaceApi(page);
    await gotoSeededWorkspace(page);

    const profileTrigger = page.getByRole("button", { name: "Open profile for Release Partner" });
    await expect(page.getByRole("button", { name: "Edit bot profile" })).toHaveCount(0);
    await expect(profileTrigger.getByTestId("avatar-view")).toBeVisible();
    await expect(profileTrigger.getByRole("heading", { level: 1, name: "Release Partner" })).toBeVisible();
    await profileTrigger.focus();
    await profileTrigger.press("Enter");
    const profileSheet = page.getByRole("dialog", { name: "Bot profile" });
    await expect(profileSheet.getByTestId("profile-sheet")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(profileSheet).toBeHidden();
    await expect(profileTrigger).toBeFocused();

    await page.setViewportSize(narrowViewport);
    const computerTrigger = page.getByRole("button", { name: "Open Computer Surface", exact: true });
    await computerTrigger.focus();
    await computerTrigger.press("Enter");
    await expect(page.getByRole("dialog", { name: "Computer Surface" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Computer Surface" })).toBeHidden();
    await expect(computerTrigger).toBeFocused();

    const mobileNavigationTrigger = page.getByRole("button", { name: "Open bot navigation" });
    await mobileNavigationTrigger.press("Enter");
    const settingsTrigger = page
      .getByRole("navigation", { name: "Bot navigation" }).getByRole("button", { name: "Settings", exact: true });
    await settingsTrigger.press("Enter");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(mobileNavigationTrigger).toBeFocused();
  });

  test("shows immutable Agent identity, system-following appearance state, and setup guidance", async ({ page }) => {
    await page.setViewportSize(desktopViewport);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.addInitScript(() => localStorage.setItem("settings:v1:appearance", "light"));
    await seedWorkspaceApi(page);
    await gotoSeededWorkspace(page);

    await page.getByRole("button", { name: "Open profile for Release Partner" }).click();
    const profile = page.getByRole("dialog", { name: "Bot profile" });
    await expect(profile.getByText("Backing Agent", { exact: true })).toBeVisible();
    await expect(profile.getByText("Pi", { exact: true })).toBeVisible();
    await expect(profile.getByText("Fixed for this bot.", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.getByRole("navigation", { name: "Bot navigation" }).getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings.getByText("Follows your current Omarchy and system appearance.", { exact: true })).toBeVisible();
    await expect(settings.getByRole("radio")).toHaveCount(0);
    await expect.poll(() => page.locator("html").getAttribute("data-theme")).toBeNull();
    await expect(settings.getByText("Reconnect Claude before sending a message.", { exact: true })).toBeVisible();
  });

  test("matches the fixed light desktop workspace", async ({ page }) => {
    await page.setViewportSize(desktopViewport);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
    await seedWorkspaceApi(page);
    await gotoSeededWorkspace(page);
    await captureWorkspace(page, "ticket-13-workspace-desktop-light.png");
  });

  test("matches the fixed dark desktop workspace", async ({ page }) => {
    await page.setViewportSize(desktopViewport);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
    await seedWorkspaceApi(page);
    await gotoSeededWorkspace(page);
    await captureWorkspace(page, "ticket-13-workspace-desktop-dark.png");
  });
  test("matches the desktop Computer Surface", async ({ page }) => {
    await page.setViewportSize(desktopViewport);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "no-preference" });
    await seedWorkspaceApi(page, { computerState: "bot-using" });
    await gotoSeededWorkspace(page);

    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "Computer Surface", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Computer Surface" })).toHaveCount(0);
    await captureWorkspace(page, "ticket-13-computer-drawer-dark.png");
  });


  test("matches the fixed narrow workspace", async ({ page }) => {
    await page.setViewportSize(narrowViewport);
    await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
    await seedWorkspaceApi(page);
    await gotoSeededWorkspace(page);
    await captureWorkspace(page, "ticket-13-workspace-narrow-light.png");
  });

  test("matches the fixed reduced-motion workspace", async ({ page }) => {
    await page.setViewportSize(reducedMotionViewport);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await seedWorkspaceApi(page, { primaryStatus: "working" });
    await gotoSeededWorkspace(page);

    const workingAvatar = page.getByTestId(`sidebar-bot-${PRIMARY_BOT_ID}`).getByTestId("avatar-view");
    await expect(workingAvatar).toHaveCSS("animation-name", "none");
    await captureWorkspace(page, "ticket-13-workspace-reduced-motion-dark.png");
  });
});
