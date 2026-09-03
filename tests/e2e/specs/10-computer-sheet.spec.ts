import { expect, test, type Page, type Route } from "@playwright/test";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWMQMgn7D8IAC5MDN627upEAAAAASUVORK5CYII=",
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

async function installProjectionPeer(page: Page): Promise<void> {
  await page.addInitScript(({ pngBase64 }) => {
    const png = Uint8Array.from(atob(pngBase64), (character) => character.charCodeAt(0)).buffer;
    const inputMessages: unknown[] = [];
    Object.defineProperty(window, "__screenInputMessages", { configurable: true, value: inputMessages });
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

      createDataChannel(label: string): RTCDataChannel {
        const channel = new FakeDataChannel(label, (sentLabel, raw) => {
          if (sentLabel === "screen.input.v1") {
            inputMessages.push(JSON.parse(raw));
            return;
          }
          if (sentLabel !== "screen.control.v1") return;
          const message = JSON.parse(raw) as { mode?: string };
          if (message.mode !== "preview" && message.mode !== "expanded") return;
          const frames = this.channels.get("screen.frames.v1");
          if (frames === undefined) return;
          this.sequence += 1;
          queueMicrotask(() => {
            if (message.mode === "expanded") {
              this.channels.get("screen.input.v1")?.dispatchEvent(new MessageEvent("message", {
                data: JSON.stringify({
                  version: 1,
                  type: "pointer-authority",
                  active: true,
                  surfaceId: this.surfaceId,
                  runtimeGeneration: 1,
                  geometryGeneration: 1,
                  controllerEpoch: 7,
                  logicalWidth: 1000,
                  logicalHeight: 500,
                  videoWidth: 2000,
                  videoHeight: 1000,
                  scale: 2,
                }),
              }));
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

    Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: FakePeerConnection });
  }, { pngBase64: PNG.toString("base64") });
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
  test("shows selected-bot state, takeover handoff, preview, and no arbitration jargon", async ({ page }) => {
    await installProjectionPeer(page);
    let state: ComputerState = "ready";
    let activeBotId: string | undefined;
    await page.route("**/api/computer/**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (await fulfillProjection(route)) return;
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
    await expect(sheet).toContainText("Screen Projection live");
    await expect(sheet).toContainText("Signaling is unauthenticated");
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
    await expect(sheet).toContainText("Screen ready");
    await expect(sheet.getByRole("button", { name: "Return to bot" })).toHaveCount(0);
    await page.getByRole("button", { name: "Close computer drawer" }).click();
    await expect(drawer).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("switching Bots clears old preview state and keeps emergency state Surface-scoped", async ({ page }) => {
    await installProjectionPeer(page);
    let closedProjectionCount = 0;
    let waitingBotId: string | undefined;
    const emergencyStopped = new Set<string>();
    await page.route("**/api/computer/**", async (route) => {
      if (new URL(route.request().url()).pathname === "/api/computer/projection" && route.request().method() === "DELETE") {
        closedProjectionCount += 1;
      }
      if (await fulfillProjection(route)) return;
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
    await expect.poll(() => closedProjectionCount).toBeGreaterThan(0);
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

  test("maps expanded pointer input through resized letterboxed content while compact preview stays inert", async ({ page }) => {
    await installProjectionPeer(page);
    await page.route("**/api/computer/**", async (route) => {
      if (await fulfillProjection(route)) return;
      const url = new URL(route.request().url());
      await fulfillJson(route, {
        botId: url.searchParams.get("botId"),
        surfaceId: url.searchParams.get("surfaceId"),
        state: "ready",
        activity: "Screen ready.",
      });
    });
    await page.setViewportSize({ width: 1280, height: 760 });
    await page.goto("/");
    await createBot(page, "Pointer Bot");
    await page.getByRole("button", { name: "Open computer", exact: true }).click();
    const preview = page.getByAltText("Latest computer preview for Pointer Bot");
    await expect(preview).toBeVisible();
    const previewBox = await preview.boundingBox();
    if (previewBox === null) throw new Error("preview has no rendered box");
    await page.mouse.move(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2);
    await page.mouse.click(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2);
    await page.mouse.wheel(0, 30);
    expect(await page.evaluate(() => (window as typeof window & { __screenInputMessages: unknown[] }).__screenInputMessages)).toEqual([]);

    await page.getByRole("button", { name: "Expand desktop preview" }).click();
    const expanded = page.getByAltText("Expanded computer preview for Pointer Bot");
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

  test("uses a bottom sheet on a narrow screen", async ({ page }) => {
    await installProjectionPeer(page);
    await page.route("**/api/computer/projection**", async (route) => {
      await fulfillProjection(route);
    });
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
    await expect(page.getByRole("button", { name: "Expand desktop preview" })).toHaveCount(0);
  });
});
