import type { ComputerViewDto } from "@omarchy-bot/protocol";
import type { ComputerBroker, ComputerBrokerState } from "../modules/computer/broker.ts";

const JSON_HEADERS = { "content-type": "application/json" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

/** Maps one owning Bot's arbitration internals to its plain-language state. */
export function computerView(state: ComputerBrokerState): ComputerViewDto {
  const identity = { botId: state.botId, surfaceId: state.surfaceId };
  const preview = state.lastImageAt === undefined ? {} : { previewAt: state.lastImageAt };
  if (state.emergencyStopped) {
    return { ...identity, state: "emergency-stopped", activity: "Computer control is stopped.", ...preview };
  }
  if (state.lease?.holder === "human") {
    return { ...identity, state: "user-control", activity: "You are using the computer.", ...preview };
  }
  if (state.lease !== null) {
    return { ...identity, state: "bot-using", activity: "This bot is using the computer.", ...preview };
  }
  if (state.queuedTurnIds.length > 0) {
    return { ...identity, state: "waiting", activity: "Waiting for computer.", ...preview };
  }
  if (state.needsHuman) {
    return { ...identity, state: "needs-you", activity: "This bot needs you at the computer.", ...preview };
  }
  return { ...identity, state: "idle", activity: "The computer is ready.", ...preview };
}

/** Every public Computer operation fails closed unless Bot and Surface ownership match. */
export async function handleComputerRequest(req: Request, computer: ComputerBroker): Promise<Response | undefined> {
  const url = new URL(req.url);
  const knownPath = [
    "/api/computer/state",
    "/api/computer/take-control",
    "/api/computer/return-to-bot",
    "/api/computer/emergency-stop",
    "/api/computer/resume",
    "/api/computer/snapshot",
  ].includes(url.pathname);
  if (!knownPath) return undefined;

  const botId = url.searchParams.get("botId");
  const surfaceId = url.searchParams.get("surfaceId");
  if (botId === null || surfaceId === null) return json({ error: "botId and surfaceId are required" }, 400);
  const owner = computer.resolveOwner(botId, surfaceId);
  if (owner === undefined) return json({ error: "Computer Surface was not found for this Bot" }, 404);
  const currentView = (): ComputerViewDto => computerView(computer.state(owner));

  if (url.pathname === "/api/computer/state" && req.method === "GET") return json(currentView());
  if (url.pathname === "/api/computer/take-control" && req.method === "POST") {
    computer.takeOver(owner);
    return json(currentView());
  }
  if (url.pathname === "/api/computer/return-to-bot" && req.method === "POST") {
    try {
      await computer.imDone(owner);
      return json(currentView());
    } catch {
      return json({ error: "The computer could not be observed. You still have control." }, 502);
    }
  }
  if (url.pathname === "/api/computer/emergency-stop" && req.method === "POST") {
    computer.emergencyStop(owner);
    return json(currentView());
  }
  if (url.pathname === "/api/computer/resume" && req.method === "POST") {
    try {
      await computer.resumeAfterEmergencyStop(owner);
      return json(currentView());
    } catch {
      return json({ error: "The computer could not be observed. Computer control remains stopped." }, 502);
    }
  }
  if (url.pathname === "/api/computer/snapshot" && req.method === "GET") {
    const snapshot = await computer.snapshot(owner);
    if (snapshot === undefined) return json({ error: "Computer preview is unavailable." }, 503);
    return new Response(snapshot.bytes as unknown as BodyInit, {
      headers: { "content-type": snapshot.mediaType, "cache-control": "no-store" },
    });
  }
  return undefined;
}
