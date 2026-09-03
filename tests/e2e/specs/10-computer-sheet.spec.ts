import { expect, test, type Page, type Route } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWMQMgn7D8IAC5MDN627upEAAAAASUVORK5CYII=",
  "base64",
);

type ComputerState = "starting" | "ready" | "bot-using" | "needs-you" | "user-control" | "unavailable";

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

async function installProjectionPeer(
  page: Page,
  options: { inputAuthorityAvailable?: boolean } = {},
): Promise<void> {
  await page.addInitScript(({ pngBase64, inputAuthorityAvailable }) => {
    const png = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0)).buffer;
    const inputMessages: unknown[] = [];
    Object.defineProperty(window, "__screenInputMessages", { configurable: true, value: inputMessages });
    const controlMessages: unknown[] = [];
    Object.defineProperty(window, "__screenControlMessages", { configurable: true, value: controlMessages });
    class FakeDataChannel extends EventTarget {
      readonly label: string;
      readonly ordered = true;
      readonly protocol = "";
      readonly id = null;
      readonly negotiated = false;
      readonly maxPacketLifeTime = null;
      readonly maxRetransmits = null;
      binaryType: BinaryType = "arraybuffer";
      bufferedAmount = 0;
      bufferedAmountLowThreshold = 0;
      readyState: RTCDataChannelState = "open";
      onbufferedamountlow = null;
      onclose = null;
      onclosing = null;
      onerror = null;
      onmessage = null;
      onopen = null;

      constructor(label: string, private readonly sendToPeer: (label: string, data: string) => void) {
        super();
        this.label = label;
      }

      send(data: string | Blob | ArrayBuffer | ArrayBufferView): void {
        if (typeof data === "string") this.sendToPeer(this.label, data);
      }

      close(): void {
        if (this.readyState === "closed") return;
        this.readyState = "closed";
        this.dispatchEvent(new Event("close"));
      }
    }

    class FakePeerConnection extends EventTarget {
      localDescription: RTCSessionDescription | null = null;
      remoteDescription: RTCSessionDescription | null = null;
      currentLocalDescription = null;
      currentRemoteDescription = null;
      pendingLocalDescription = null;
      pendingRemoteDescription = null;
      signalingState: RTCSignalingState = "stable";
      iceGatheringState: RTCIceGatheringState = "complete";
      iceConnectionState: RTCIceConnectionState = "connected";
      connectionState: RTCPeerConnectionState = "connected";
      canTrickleIceCandidates = false;
      sctp = null;
      onconnectionstatechange = null;
      ondatachannel = null;
      onicecandidate = null;
      onicecandidateerror = null;
      oniceconnectionstatechange = null;
      onicegatheringstatechange = null;
      onnegotiationneeded = null;
      onsignalingstatechange = null;
      private readonly channels = new Map<string, FakeDataChannel>();
      private surfaceId = "";
      private sequence = 0;
      constructor() {
        super();
        peers.push(this);
      }

      dispatchInputAuthority(active: boolean, controllerEpoch = 7): void {
        testControl.inputAuthorityActive = active;
        this.channels.get("screen.input.v1")?.dispatchEvent(new MessageEvent("message", {
          data: JSON.stringify({
            version: 1,
            type: "input-authority",
            active,
            surfaceId: this.surfaceId,
            runtimeGeneration: 1,
            geometryGeneration: 1,
            controllerEpoch,
            logicalWidth: 1000,
            logicalHeight: 500,
            videoWidth: 2000,
            videoHeight: 1000,
            scale: 2,
          }),
        }));
      }

      createDataChannel(label: string): RTCDataChannel {
        const channel = new FakeDataChannel(label, (sentLabel, raw) => {
          if (sentLabel === "screen.input.v1") {
            const message = JSON.parse(raw) as { type?: string; controllerEpoch?: number };
            inputMessages.push(message);
            if (message.type === "release-control") {
              queueMicrotask(() => this.dispatchInputAuthority(false, message.controllerEpoch ?? 7));
            }
            return;
          }
          if (sentLabel !== "screen.control.v1") return;
          const message = JSON.parse(raw) as { mode?: string };
          controlMessages.push(message);
          if (message.mode !== "preview" && message.mode !== "expanded") return;
          const frames = this.channels.get("screen.frames.v1");
          if (frames === undefined) return;
          this.sequence += 1;
          queueMicrotask(() => {
            if (message.mode === "expanded" && testControl.inputAuthorityAvailable) {
              this.dispatchInputAuthority(true);
            }
            frames.dispatchEvent(new MessageEvent("message", {
              data: JSON.stringify({
                version: 1,
                type: "frame",
                surfaceId: this.surfaceId,
                runtimeGeneration: 1,
                geometryGeneration: 1,
                logicalWidth: 1000,
                logicalHeight: 500,
                videoWidth: 2000,
                videoHeight: 1000,
                scale: 2,
                sequence: this.sequence,
                mediaType: "image/png",
                mode: message.mode,
                byteLength: png.byteLength,
                chunkCount: 1,
              }),
            }));
            frames.dispatchEvent(new MessageEvent("message", { data: png.slice(0) }));
          });
        });
        this.channels.set(label, channel);
        return channel as unknown as RTCDataChannel;
      }

      async createOffer(): Promise<RTCSessionDescriptionInit> {
        return { type: "offer", sdp: "fake-browser-offer" };
      }

      async setLocalDescription(description?: RTCLocalSessionDescriptionInit): Promise<void> {
        this.localDescription = { type: description?.type ?? "offer", sdp: description?.sdp ?? "fake-browser-offer", toJSON() { return this; } };
      }

      async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
        this.surfaceId = description.sdp?.replace(/^fake-answer:/, "") ?? "";
        this.remoteDescription = { type: description.type, sdp: description.sdp ?? "", toJSON() { return this; } };
      }

      async addIceCandidate(): Promise<void> {}

      close(): void {
        this.connectionState = "closed";
        for (const channel of this.channels.values()) channel.close();
        this.dispatchEvent(new Event("connectionstatechange"));
      }
    }

    const peers: FakePeerConnection[] = [];
    const testControl = {
      inputAuthorityAvailable,
      inputAuthorityActive: false,
      revokeInput(): void {
        testControl.inputAuthorityAvailable = false;
        peers.at(-1)?.dispatchInputAuthority(false);
      },
    };
    Object.defineProperty(window, "__screenProjectionControl", { configurable: true, value: testControl });
    Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: FakePeerConnection });
  }, {
    pngBase64: PNG.toString("base64"),
    inputAuthorityAvailable: options.inputAuthorityAvailable ?? true,
  });
}

async function fulfillProjection(route: Route): Promise<boolean> {
  const url = new URL(route.request().url());
  if (url.pathname !== "/api/computer/projection") return false;
  if (route.request().method() === "DELETE") {
    await route.fulfill({ status: 204, body: "" });
    return true;
  }
  const surfaceId = url.searchParams.get("surfaceId") ?? "";
  await route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify({
      type: "answer",
      sdp: `fake-answer:${surfaceId}`,
      sessionId: `session-${surfaceId}`,
      surfaceId,
      runtimeGeneration: 1,
      geometryGeneration: 1,
      logicalWidth: 1000,
      logicalHeight: 500,
      videoWidth: 2000,
      videoHeight: 1000,
      scale: 2,
      state: "connecting",
      transport: "webrtc-data-channel-frames-v1",
      channels: { frames: "screen.frames.v1", control: "screen.control.v1", input: "screen.input.v1" },
      security: { authentication: "none", httpsRequired: false },
      candidates: [],
    }),
  });
  return true;
}
test.describe("contextual computer sheet", () => {
  test("offers tool-scoped Takeover while close and reconnect leave the same tool pending", async ({ page }) => {
    await installProjectionPeer(page);
    let state: ComputerState = "ready";
    let takeover: "unavailable" | "available" | "active" = "available";
    let returnCalls = 0;
    let takeoverCalls = 0;
    let activeBotId: string | undefined;
    await page.route("**/api/computer/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (await fulfillProjection(route)) return;
      if (url.pathname === "/api/computer/snapshot") {
        await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
        return;
      }
      if (url.pathname === "/api/computer/take-control") {
        takeoverCalls += 1;
        state = "user-control";
        takeover = "active";
      }
      if (url.pathname === "/api/computer/return-to-bot") {
        returnCalls += 1;
        state = "ready";
        takeover = "unavailable";
      }
      const selectedBotId = url.searchParams.get("botId") ?? undefined;
      const surfaceId = url.searchParams.get("surfaceId") ?? undefined;
      const selectedState: ComputerState =
        state === "bot-using" && selectedBotId !== activeBotId ? "ready" : state;
      await fulfillJson(route, {
        state: selectedState,
        botId: selectedBotId,
        takeover,
        surfaceId,
        activity:
          selectedState === "bot-using"
            ? "Bot using screen."
            : selectedState === "user-control"
              ? "You have control."
              : "Screen ready.",
        previewAt: "2026-09-02T12:00:00.000Z",
      });
    });

    await page.goto("/");
    activeBotId = await createBot(page, "Computer Bot");
    state = "bot-using";
    await page.reload();

    const trigger = page.getByRole("button", { name: "Open Computer Surface", exact: true });
    await expect(trigger).toHaveAttribute("data-state", "bot-using");
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(trigger.locator("svg.lucide-monitor")).toBeVisible();
    await trigger.click();
    const drawer = page.getByRole("complementary", { name: "Computer Surface", exact: true });
    const closeTrigger = page.getByTestId("header-computer");
    await expect(closeTrigger).toHaveAttribute("aria-expanded", "true");
    await expect(drawer).toBeVisible();
    await closeTrigger.click();
    await expect(drawer).toBeHidden();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await trigger.click();
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Computer Surface" })).toHaveCount(0);

    const sheet = drawer;
    await expect(sheet.getByAltText("Computer Preview for Computer Bot")).toBeVisible();
    await expect(sheet).toContainText("Screen Projection live");
    await expect(sheet).toContainText("Signaling is unauthenticated");
    await expect(sheet).toContainText("Bot using screen.");
    await expect(sheet).not.toContainText(/lease|TTL|token|queue depth/i);
    await expect(sheet.getByRole("button", { name: "Take control" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Continue takeover" })).toHaveCount(0);
    await sheet.getByRole("button", { name: "Open Web Control" }).click();
    const expandedControl = page.getByTestId("expanded-web-control");
    await expect(expandedControl).toBeVisible();
    expect(takeoverCalls).toBe(1);
    await expect.poll(() => page.evaluate(
      () => (window as typeof window & {
        __screenProjectionControl: { inputAuthorityActive: boolean };
      }).__screenProjectionControl.inputAuthorityActive,
    )).toBe(true);
    await expandedControl.focus();
    await page.keyboard.press("a");
    await expect.poll(() => page.evaluate(
      () => (window as typeof window & {
        __screenInputMessages: Array<{ type?: string }>;
      }).__screenInputMessages.filter(({ type }) => type === "key").length,
    )).toBe(2);
    await expect(page.getByTestId("expanded-web-control")).toBeVisible();
    await expect(page.getByRole("button", { name: "I'm done" })).toBeVisible();
    await page.getByTestId("expanded-web-control").getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByTestId("expanded-web-control")).toBeHidden();
    expect(returnCalls).toBe(0);
    await expect(sheet.getByRole("button", { name: "Continue takeover" })).toBeVisible();
    await page.reload();
    expect(returnCalls).toBe(0);
    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    await expect(sheet.getByRole("button", { name: "Continue takeover" })).toBeVisible();

    await sheet.getByRole("button", { name: "Continue takeover" }).click();
    await expect(page.getByRole("button", { name: "I'm done" })).toBeVisible();
    await page.getByRole("button", { name: "I'm done" }).click();
    await expect(sheet).toContainText("Screen ready");
    expect(returnCalls).toBe(1);
    await expect(sheet.getByRole("button", { name: "Continue takeover" })).toHaveCount(0);
    await page.getByTestId("header-computer").click();
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("switching Bots clears the previous Bot Screen projection and preserves scoped requests", async ({ page }) => {
    await installProjectionPeer(page);
    let closedProjectionCount = 0;
    await page.route("**/api/computer/**", async (route) => {
      const url = new URL(route.request().url());
      expect(url.searchParams.get("botId")).not.toBeNull();
      expect(url.searchParams.get("surfaceId")).not.toBeNull();
      if (url.pathname === "/api/computer/projection" && route.request().method() === "DELETE") {
        closedProjectionCount += 1;
      }
      if (await fulfillProjection(route)) return;
      if (url.pathname === "/api/computer/snapshot") {
        await route.fulfill({ status: 200, contentType: "image/png", body: PNG });
        return;
      }
      await fulfillJson(route, {
        state: "bot-using",
        takeover: "unavailable",
        botId: url.searchParams.get("botId"),
        surfaceId: url.searchParams.get("surfaceId"),
        activity: "Bot using screen.",
      });
    });

    await page.goto("/");
    await createBot(page, "First Screen Bot");
    await createBot(page, "Other Bot");

    await page.getByRole("button", { name: "First Screen Bot", exact: true }).click();
    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    const computer = page.getByRole("complementary", { name: "Computer Surface", exact: true });
    await expect(computer.getByAltText("Computer Preview for First Screen Bot")).toBeVisible();

    await page.getByRole("button", { name: "Other Bot", exact: true }).click();
    await expect.poll(() => closedProjectionCount).toBeGreaterThan(0);
    await expect(computer.getByAltText("Computer Preview for First Screen Bot")).toHaveCount(0);
    await expect(computer.getByAltText("Computer Preview for Other Bot")).toBeVisible();
  });

  test("maps expanded pointer input through resized letterboxed content while compact preview stays inert", async ({ page }) => {
    await installProjectionPeer(page);
    await page.route("**/api/computer/**", async (route) => {
      if (await fulfillProjection(route)) return;
      const url = new URL(route.request().url());
      await fulfillJson(route, {
        botId: url.searchParams.get("botId"),
        surfaceId: url.searchParams.get("surfaceId"),
        state: "ready",
        takeover: "unavailable",
        activity: "Screen ready.",
      });
    });
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.goto("/");
    await createBot(page, "Pointer Bot");
    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    const preview = page.getByAltText("Computer Preview for Pointer Bot");
    await expect(preview).toBeVisible();
    const previewBox = await preview.boundingBox();
    if (previewBox === null) throw new Error("preview has no rendered box");
    await page.mouse.move(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2);
    await page.mouse.click(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2);
    await page.mouse.wheel(0, 30);
    expect(await page.evaluate(() => (window as typeof window & { __screenInputMessages: unknown[] }).__screenInputMessages)).toEqual([]);

    await page.getByRole("button", { name: "Open Web Control" }).click();
    const expanded = page.getByAltText("Web Control for Pointer Bot");
    await expect(expanded).toBeVisible();
    await expect.poll(() => page.evaluate(
      () => (window as typeof window & { __screenInputMessages: unknown[] }).__screenInputMessages.length,
    )).toBe(0);

    await page.setViewportSize({ width: 900, height: 760 });
    await expanded.evaluate((image) => {
      image.style.width = "600px";
      image.style.height = "500px";
      image.style.objectFit = "contain";
    });
    const imageBox = await expanded.boundingBox();
    if (imageBox === null) throw new Error("expanded projection has no rendered box");
    const fittedWidth = Math.min(imageBox.width, imageBox.height * 2);
    const fittedHeight = fittedWidth / 2;
    const left = imageBox.x + (imageBox.width - fittedWidth) / 2;
    const top = imageBox.y + (imageBox.height - fittedHeight) / 2;
    await expanded.dispatchEvent("pointermove", {
      pointerId: 40,
      pointerType: "mouse",
      clientX: imageBox.x + imageBox.width / 2,
      clientY: imageBox.y + 1,
      bubbles: true,
    });
    expect(await page.evaluate(
      () => (window as typeof window & { __screenInputMessages: unknown[] }).__screenInputMessages,
    )).toEqual([]);
    await expanded.dispatchEvent("pointermove", {
      pointerId: 41,
      pointerType: "mouse",
      clientX: left + 1,
      clientY: top + 1,
      bubbles: true,
    });
    await expanded.dispatchEvent("pointermove", {
      pointerId: 42,
      pointerType: "mouse",
      clientX: left + fittedWidth - 1,
      clientY: top + fittedHeight - 1,
      bubbles: true,
    });
    await expanded.dispatchEvent("wheel", {
      clientX: left + fittedWidth - 1,
      clientY: top + fittedHeight - 1,
      deltaX: -24,
      deltaY: 120,
      bubbles: true,
      cancelable: true,
    });
    await page.mouse.move(left + fittedWidth * 0.4, top + fittedHeight * 0.4);
    await page.mouse.down();
    await page.mouse.move(left + fittedWidth * 0.6, top + fittedHeight * 0.7, { steps: 30 });
    await page.mouse.up();

    const messages = await page.evaluate(
      () => (window as typeof window & { __screenInputMessages: Array<Record<string, unknown>> }).__screenInputMessages,
    );
    expect(messages.length).toBeGreaterThan(5);
    expect(messages.map((message) => message.sequence)).toEqual(messages.map((_, index) => index + 1));
    expect(messages.every((message) =>
      message.surfaceId !== undefined
      && message.runtimeGeneration === 1
      && message.geometryGeneration === 1
      && message.controllerEpoch === 7
    )).toBe(true);
    expect(messages.some((message) =>
      message.type === "pointer-motion"
      && Number(message.x) <= 2
      && Number(message.y) <= 2
    )).toBe(true);
    expect(messages.some((message) =>
      message.type === "pointer-motion"
      && Number(message.x) >= 995
      && Number(message.y) >= 495
    )).toBe(true);
    expect(messages.filter((message) => message.type === "pointer-button").map((message) => message.state)).toEqual([
      "pressed",
      "released",
    ]);
    expect(messages.some((message) =>
      message.type === "pointer-scroll"
      && message.deltaX === -24
      && message.deltaY === 120
    )).toBe(true);
  });

  test("re-arms an already-expanded takeover and drops pointer transitions outside its authority", async ({ page }) => {
    await installProjectionPeer(page, { inputAuthorityAvailable: false });
    let state: ComputerState = "bot-using";
    let takeover: "available" | "active" = "available";
    await page.route("**/api/computer/**", async (route) => {
      if (await fulfillProjection(route)) return;
      const url = new URL(route.request().url());
      if (url.pathname === "/api/computer/take-control") {
        state = "user-control";
        takeover = "active";
      }
      await fulfillJson(route, {
        botId: url.searchParams.get("botId"),
        surfaceId: url.searchParams.get("surfaceId"),
        state,
        takeover,
        activity: state === "user-control" ? "You have control." : "Bot using screen.",
      });
    });
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.goto("/");
    await createBot(page, "Authority Boundary Bot");
    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    const sheet = page.getByRole("complementary", { name: "Computer Surface", exact: true });
    await sheet.getByRole("button", { name: "Open Web Control" }).click();
    const expanded = page.getByAltText("Web Control for Authority Boundary Bot");
    await expect(expanded).toBeVisible();
    const imageBox = await expanded.boundingBox();
    if (imageBox === null) throw new Error("expanded projection has no rendered box");
    let x = imageBox.x + imageBox.width / 2;
    let y = imageBox.y + imageBox.height / 2;

    await expanded.dispatchEvent("pointerdown", {
      pointerId: 99,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
    expect(await page.evaluate(
      () => (window as typeof window & { __screenInputMessages: unknown[] }).__screenInputMessages,
    )).toEqual([]);
    await expect(expanded).toBeVisible();
    await page.getByTestId("expanded-web-control").getByRole("button", { name: "Close", exact: true }).click();
    await expect(expanded).toBeHidden();
    await expect(sheet.getByRole("button", { name: "Continue takeover" })).toBeVisible();

    const controlCount = await page.evaluate(
      () => (window as typeof window & { __screenControlMessages: unknown[] }).__screenControlMessages.length,
    );
    await page.evaluate(() => {
      const control = (window as typeof window & {
        __screenProjectionControl: { inputAuthorityAvailable: boolean };
      }).__screenProjectionControl;
      control.inputAuthorityAvailable = true;
    });
    await sheet.getByRole("button", { name: "Continue takeover" }).click();
    await expect.poll(() => page.evaluate(
      (before) => (window as typeof window & {
        __screenControlMessages: Array<{ mode?: string }>;
      }).__screenControlMessages.slice(before).filter(({ mode }) => mode === "expanded").length,
      controlCount,
    )).toBeGreaterThan(0);
    expect(await page.evaluate(
      (before) => (window as typeof window & {
        __screenControlMessages: Array<{ mode?: string }>;
      }).__screenControlMessages.slice(before).map(({ mode }) => mode),
      controlCount,
    )).not.toContain("preview");
    await expanded.dispatchEvent("pointerup", {
      pointerId: 99,
      pointerType: "mouse",
      button: 0,
      buttons: 0,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
    expect(await page.evaluate(
      () => (window as typeof window & { __screenInputMessages: unknown[] }).__screenInputMessages,
    )).toEqual([]);
    const controlledBox = await expanded.boundingBox();
    if (controlledBox === null) throw new Error("expanded control has no rendered box");
    x = controlledBox.x + controlledBox.width / 2;
    y = controlledBox.y + controlledBox.height / 2;
    await page.mouse.move(x, y);

    await page.mouse.down();
    await expanded.dispatchEvent("pointerdown", {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
    await page.mouse.move(x + 8, y + 8);
    await page.mouse.up();
    await expanded.dispatchEvent("pointerup", {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      buttons: 0,
      clientX: x,
      clientY: y,
      bubbles: true,
      cancelable: true,
    });
    expect(await page.evaluate(
      () => (window as typeof window & {
        __screenInputMessages: Array<{ type?: string; state?: string }>;
      }).__screenInputMessages
        .filter(({ type }) => type === "pointer-button")
        .map(({ type, state }) => ({ type, state })),
    )).toEqual([
      { type: "pointer-button", state: "pressed" },
      { type: "pointer-button", state: "released" },
    ]);

    if (!await expanded.isVisible()) {
      await sheet.getByRole("button", { name: "Continue takeover" }).click();
      await expect(expanded).toBeVisible();
    }
    const heldBox = await expanded.boundingBox();
    if (heldBox === null) throw new Error("expanded control has no held-input box");
    await page.mouse.move(heldBox.x + heldBox.width / 2, heldBox.y + heldBox.height / 2);
    await page.mouse.down();
    await expect.poll(() => page.evaluate(
      () => (window as typeof window & {
        __screenInputMessages: Array<{ type?: string }>;
      }).__screenInputMessages.filter(({ type }) => type === "pointer-button").length,
    )).toBe(3);
    await page.evaluate(() => {
      (window as typeof window & {
        __screenProjectionControl: { revokeInput(): void };
      }).__screenProjectionControl.revokeInput();
    });
    await page.mouse.up();
    expect(await page.evaluate(
      () => (window as typeof window & {
        __screenInputMessages: Array<{ type?: string; state?: string }>;
      }).__screenInputMessages.filter(({ type }) => type === "pointer-button").map(({ state }) => state),
    )).toEqual(["pressed", "released", "pressed"]);
  });

  test("sends shortcuts and plain-text paste only from expanded desktop control and releases on blur", async ({ page }) => {
    await installProjectionPeer(page);
    await page.route("**/api/computer/**", async (route) => {
      if (await fulfillProjection(route)) return;
      const url = new URL(route.request().url());
      await fulfillJson(route, {
        botId: url.searchParams.get("botId"),
        surfaceId: url.searchParams.get("surfaceId"),
        state: "ready",
        takeover: "unavailable",
        activity: "Screen ready.",
      });
    });
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.goto("/");
    await createBot(page, "Keyboard Bot");
    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    await page.keyboard.press("Control+L");
    expect(await page.evaluate(
      () => (window as typeof window & { __screenInputMessages: unknown[] }).__screenInputMessages,
    )).toEqual([]);

    await page.getByRole("button", { name: "Open Web Control" }).click();
    const control = page.getByTestId("expanded-web-control");
    await expect(control).toBeVisible();
    await control.focus();
    await page.keyboard.down("Control");
    await page.keyboard.press("l");
    await page.keyboard.up("Control");
    await control.evaluate((element) => {
      const clipboard = new DataTransfer();
      clipboard.setData("text/plain", "pasted λ text");
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }));
    });
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.evaluate(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
      await Promise.resolve();
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      window.dispatchEvent(new PageTransitionEvent("pagehide"));
    });

    const messages = await page.evaluate(
      () => (window as typeof window & { __screenInputMessages: Array<Record<string, unknown>> }).__screenInputMessages,
    );
    expect(messages.map(({ type }) => type)).toEqual([
      "key",
      "key",
      "key",
      "key",
      "paste",
      "release-control",
      "release-control",
      "release-control",
    ]);
    expect(messages.slice(0, 4).map(({ code, state }) => ({ code, state }))).toEqual([
      { code: "ControlLeft", state: "pressed" },
      { code: "KeyL", state: "pressed" },
      { code: "KeyL", state: "released" },
      { code: "ControlLeft", state: "released" },
    ]);
    expect(messages[1]?.modifiers).toEqual({ control: true, alt: false, shift: false, meta: false });
    expect(messages[4]).toMatchObject({ type: "paste", text: "pasted λ text" });
    expect(messages.slice(5).map(({ reason }) => reason)).toEqual([
      "blur",
      "visibility-loss",
      "navigation",
    ]);
    expect(messages.slice(0, 6).map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(messages.slice(6).map(({ sequence }) => sequence)).toEqual([1, 1]);
  });


  test("keeps the narrow-screen preview usable without exposing Takeover", async ({ page }) => {
    let takeover: "available" | "active" = "available";
    let takeoverCalls = 0;
    await installProjectionPeer(page);
    await page.route("**/api/computer/projection**", async (route) => {
      await fulfillProjection(route);
    });
    await page.route("**/api/computer/state**", (route) => {
      const url = new URL(route.request().url());
      return fulfillJson(route, {
        botId: url.searchParams.get("botId"),
        surfaceId: url.searchParams.get("surfaceId"),
        state: takeover === "active" ? "user-control" : "ready",
        takeover,
        activity: takeover === "active" ? "You have control." : "Screen ready.",
      });
    });
    await page.route("**/api/computer/take-control**", async (route) => {
      takeoverCalls += 1;
      await fulfillJson(route, {
        botId: new URL(route.request().url()).searchParams.get("botId"),
        surfaceId: new URL(route.request().url()).searchParams.get("surfaceId"),
        state: "user-control",
        takeover: "active",
        activity: "You have control.",
      });
    });
    await page.route("**/api/computer/snapshot**", (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await page.goto("/");
    await createBot(page, "Mobile Computer Bot");
    await page.setViewportSize({ width: 390, height: 780 });
    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    const mobilePanel = page.getByRole("complementary", { name: "Computer Surface", exact: true });
    await expect(mobilePanel).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Computer Surface" })).toHaveCount(0);
    await expect.poll(() => mobilePanel.evaluate((element) => element.getBoundingClientRect().right)).toBe(390);
    await expect(mobilePanel.getByAltText("Computer Preview for Mobile Computer Bot")).toBeVisible();
    await expect(mobilePanel.getByRole("button", { name: "Open Web Control" })).toHaveCount(0);
    await expect(mobilePanel.getByRole("button", { name: "Take control" })).toHaveCount(0);
    await expect(mobilePanel.getByRole("button", { name: "Continue takeover" })).toHaveCount(0);
    await page.keyboard.press("Control+L");
    await mobilePanel.evaluate((element) => {
      const clipboard = new DataTransfer();
      clipboard.setData("text/plain", "mobile paste");
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }));
    });
    expect(await page.evaluate(
      () => (window as typeof window & { __screenInputMessages: unknown[] }).__screenInputMessages,
    )).toEqual([]);
    takeover = "active";
    await page.reload();
    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    const activeMobilePanel = page.getByRole("complementary", { name: "Computer Surface", exact: true });
    await expect(activeMobilePanel.getByAltText("Computer Preview for Mobile Computer Bot")).toBeVisible();
    await expect(activeMobilePanel.getByRole("button", { name: "Take control" })).toHaveCount(0);
    await expect(activeMobilePanel.getByRole("button", { name: "Continue takeover" })).toHaveCount(0);
    expect(takeoverCalls).toBe(0);
  });

  test("retries an interrupted Bot Screen through projection activation", async ({ page }) => {
    await installProjectionPeer(page);
    const firstProjection = Promise.withResolvers<void>();
    let projectionAttempts = 0;
    let state: ComputerState = "unavailable";
    await page.route("**/api/computer/**", async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/computer/projection") {
        projectionAttempts += 1;
        if (projectionAttempts === 1) {
          await firstProjection.promise;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Bot Screen start was interrupted" }),
          });
          return;
        }
        await fulfillProjection(route);
        return;
      }
      await fulfillJson(route, {
        botId: url.searchParams.get("botId"),
        surfaceId: url.searchParams.get("surfaceId"),
        state,
        takeover: "unavailable",
        activity: state === "ready" ? "Screen ready." : "Screen unavailable.",
      });
    });

    await page.goto("/");
    await createBot(page, "Retry Screen Bot");
    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    const panel = page.getByRole("complementary", { name: "Computer Surface", exact: true });
    const retry = panel.getByRole("button", { name: "Retry Bot Screen" });
    await expect(panel.getByRole("heading", { name: "Screen unavailable", exact: true })).toBeVisible();

    await retry.click();
    await expect(panel.getByRole("heading", { name: "Screen starting", exact: true })).toBeVisible();
    expect(projectionAttempts).toBe(1);
    firstProjection.resolve();
    await expect(panel.getByRole("heading", { name: "Screen unavailable", exact: true })).toBeVisible();
    await expect(retry).toBeVisible();

    state = "ready";
    await retry.click();
    await expect.poll(() => projectionAttempts).toBe(2);
    await page.reload();
    await page.getByRole("button", { name: "Open Computer Surface", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "Screen ready", exact: true })).toBeVisible();
    await expect(panel.getByAltText("Computer Preview for Retry Screen Bot")).toBeVisible();
  });

  test("renders capacity-full state returned with an expected unavailable response", async ({ page }) => {
    await page.route("**/api/computer/state**", async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          botId: url.searchParams.get("botId"),
          surfaceId: url.searchParams.get("surfaceId"),
          state: "unavailable",
          takeover: "unavailable",
          activity: "Bot Screen capacity is full (4/4).",
          unavailableReason: "capacity",
          capacity: { active: 4, limit: 4 },
        }),
      });
    });
    await page.goto("/");
    await createBot(page, "Capacity Computer Bot");

    const trigger = page.getByRole("button", { name: "Open Computer Surface", exact: true });
    await expect(trigger).toHaveAttribute("data-state", "unavailable");
    await trigger.click();
    const panel = page.getByRole("complementary", { name: "Computer Surface", exact: true });
    await expect(panel).toContainText("Bot Screen capacity is full (4/4).");
    await expect(panel).not.toContainText("Bot Screen status could not be loaded.");
    await expect(panel.getByRole("button", { name: "Retry Bot Screen" })).toHaveCount(0);
  });
});
