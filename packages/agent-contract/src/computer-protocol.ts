import type { ComputerAction } from "@omarchy-bot/domain";
import type { Hello } from "./shared.ts";

export type ComputerCommand =
  | { type: "probe"; requestId: string }
  | {
      type: "act";
      requestId: string;
      action: ComputerAction;
      /** Set for input actions. Worker refuses input without it (defense in depth). */
      lease?: { holder: { botId: string } | "human"; turnId?: string; token: string };
    }
  | { type: "shutdown"; requestId: string };

export interface ComputerProbePayload {
  agentId: string;
  installed: boolean;
  agentVersion: string;
  sdkOk: boolean;
  reason?: string;
}

export type ComputerResult =
  | { requestId: string; ok: true; payload: ComputerActPayload | ComputerProbePayload }
  | { requestId: string; ok: false; error: string };

export interface ComputerActPayload {
  done?: boolean;
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
