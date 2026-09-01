import type { ActorRef, ComputerAction } from "@omarchy-bot/domain";
import type { Hello } from "./shared.ts";

export type ComputerCommand =
  | { type: "probe"; requestId: string }
  | {
      type: "act";
      requestId: string;
      action: ComputerAction;
      /** Set for input actions. Worker refuses input without it (defense in depth). */
      lease?: { holder: ActorRef | "human"; runId?: string; token: string };
    }
  | { type: "shutdown"; requestId: string };

export type ComputerResult =
  | { requestId: string; ok: true; payload: ComputerActPayload }
  | { requestId: string; ok: false; error: string };

export interface ComputerActPayload {
  /** Textual observation result (accessibility tree excerpt etc). */
  text?: string;
  /** Screenshot as PNG/JPEG bytes — daemon persists to artifacts and returns a ref. */
  image?: { mediaType: "image/png" | "image/jpeg"; base64: string };
  windowList?: { id: string; title: string; appId?: string; focused: boolean }[];
}

export type ComputerWorkerOutbound =
  | Hello
  | { type: "heartbeat" }
  | ComputerResult
  | { type: "event"; event: { type: "native"; capability: string; payload: unknown; sensitivity: "public" | "diagnostic" | "secret" } };
