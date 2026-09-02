import type { ComputerViewDto } from "@omarchy-bot/protocol";
import type { ComputerBroker, ComputerBrokerState } from "../modules/computer/broker.ts";

const JSON_HEADERS = { "content-type": "application/json" };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

/** Maps arbitration internals to the selected Bot's plain-language computer state. */
export function computerView(state: ComputerBrokerState, selectedBotId?: string): ComputerViewDto {
  const preview = state.lastImageAt !== undefined ? { previewAt: state.lastImageAt } : {};
  if (state.emergencyStopped) {
    return { state: "emergency-stopped", activity: "Computer control is stopped.", ...preview };
  }
  if (state.lease?.holder === "human") {
    return { state: "user-control", activity: "You are using the computer.", ...preview };
  }

  if (selectedBotId !== undefined) {
    if (state.lease !== null && state.lease.holder.botId === selectedBotId) {
      return { state: "bot-using", botId: selectedBotId, activity: "This bot is using the computer.", ...preview };
    }
    if (state.queuedBotIds.includes(selectedBotId)) {
      return { state: "waiting", botId: selectedBotId, activity: "Waiting for computer.", ...preview };
    }
    if (state.needsHumanBotIds.includes(selectedBotId)) {
      return { state: "needs-you", botId: selectedBotId, activity: "This bot needs you at the computer.", ...preview };
    }
    return { state: "idle", activity: "The computer is ready.", ...preview };
  }

  if (state.lease !== null) {
    return { state: "bot-using", botId: state.lease.holder.botId, activity: "A bot is using the computer.", ...preview };
  }
  const waitingBotId = state.queuedBotIds[0];
  if (waitingBotId !== undefined) {
    return { state: "waiting", botId: waitingBotId, activity: "A bot is waiting for the computer.", ...preview };
  }
  const needsHumanBotId = state.needsHumanBotIds[0];
  if (needsHumanBotId !== undefined) {
    return { state: "needs-you", botId: needsHumanBotId, activity: "A bot needs you at the computer.", ...preview };
  }
  return { state: "idle", activity: "The computer is ready.", ...preview };
}

/** Self-contained computer HTTP surface; returns undefined for the parent router to continue. */
export async function handleComputerRequest(req: Request, computer: ComputerBroker): Promise<Response | undefined> {
  const url = new URL(req.url);
  const selectedBotId = url.searchParams.get("botId") ?? undefined;
  const currentView = (): ComputerViewDto => computerView(computer.state(), selectedBotId);

  if (url.pathname === "/api/computer/state" && req.method === "GET") return json(currentView());
  if (url.pathname === "/api/computer/take-control" && req.method === "POST") {
    computer.takeOver();
    return json(currentView());
  }
  if (url.pathname === "/api/computer/return-to-bot" && req.method === "POST") {
    try {
      await computer.imDone();
      return json(currentView());
    } catch {
      return json({ error: "The computer could not be observed. You still have control." }, 502);
    }
  }
  if (url.pathname === "/api/computer/emergency-stop" && req.method === "POST") {
    computer.emergencyStop();
    return json(currentView());
  }
  if (url.pathname === "/api/computer/resume" && req.method === "POST") {
    try {
      await computer.resumeAfterEmergencyStop();
      return json(currentView());
    } catch {
      return json({ error: "The computer could not be observed. Computer control remains stopped." }, 502);
    }
  }
  if (url.pathname === "/api/computer/snapshot" && req.method === "GET") {
    const snapshot = await computer.snapshot();
    if (snapshot === undefined) return json({ error: "Computer preview is unavailable." }, 503);
    return new Response(snapshot.bytes as unknown as BodyInit, {
      headers: { "content-type": snapshot.mediaType, "cache-control": "no-store" },
    });
  }
  return undefined;
}
