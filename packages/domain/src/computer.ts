import type { SurfaceId } from "./ids.ts";

/** Surface-scoped desktop-input grant. Read-only observation is never lease-gated. */
export interface ComputerLease {
  surfaceId: SurfaceId;
  holder: { botId: string } | "human";
  turnId?: string;
  acquiredAt: string;
  expiresAt: string;
}

export type ComputerActionName =
  | "observe"
  | "screenshot"
  | "list_windows"
  | "focus_window"
  | "click"
  | "type"
  | "key"
  | "scroll"
  | "open_app"
  | "open_url"
  | "notify";

export interface ComputerAction {
  name: ComputerActionName;
  args: Record<string, unknown>;
}

/** Input actions need the lease; observation never does. */
export const INPUT_ACTIONS: readonly ComputerActionName[] = [
  "focus_window",
  "click",
  "type",
  "key",
  "scroll",
  "open_app",
  "open_url",
];

export function isInputAction(name: ComputerActionName): boolean {
  return INPUT_ACTIONS.includes(name);
}

export function leaseExpired(lease: ComputerLease, now: Date = new Date()): boolean {
  return new Date(lease.expiresAt).getTime() <= now.getTime();
}
