import type { BotId, TurnId } from "./ids.ts";

/**
 * Turn lifecycle. One user message drives exactly one turn; steering adds
 * instructions to the active turn instead of starting another.
 */
export type TurnStatus =
  | "working"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "waiting_for_computer"
  | "completed"
  | "cancelled"
  | "failed";

export const TERMINAL_TURN_STATUSES: readonly TurnStatus[] = ["completed", "cancelled", "failed"];
export function isTerminalTurn(s: TurnStatus): boolean {
  return TERMINAL_TURN_STATUSES.includes(s);
}

const TRANSITIONS: Record<TurnStatus, readonly TurnStatus[]> = {
  working: ["waiting_for_input", "waiting_for_approval", "waiting_for_computer", "completed", "cancelled", "failed"],
  waiting_for_input: ["working", "cancelled", "failed"],
  waiting_for_approval: ["working", "cancelled", "failed"],
  waiting_for_computer: ["working", "cancelled", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
};

export function canTransitionTurn(from: TurnStatus, to: TurnStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransitionTurn(from: TurnStatus, to: TurnStatus): void {
  if (!canTransitionTurn(from, to)) {
    throw new Error(`illegal turn transition ${from} -> ${to}`);
  }
}

/** A turn reaches a terminal state exactly once; the second is always a bug. */
export function assertTurnTerminalOnce(current: TurnStatus | undefined, next: TurnStatus): void {
  if (current !== undefined && isTerminalTurn(current)) {
    throw new Error(`turn already terminal (${current}); refusing ${next}`);
  }
}

export interface Turn {
  id: TurnId;
  threadId: string;
  botId: BotId;
  status: TurnStatus;
  workerSessionId?: string;
  nativeSessionId: string;
  steerCount: number;
  startedAt: string;
  finishedAt?: string;
  outcomeReason?: string;
}
