import type { ActorRef } from "./ids.ts";

export type TaskStatus =
  | "queued"
  | "working"
  | "waiting_for_input"
  | "waiting_for_approval"
  | "waiting_for_computer"
  | "blocked"
  | "completed"
  | "cancelled"
  | "failed";

export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = ["completed", "cancelled", "failed"];
export function isTerminalTask(s: TaskStatus): boolean {
  return TERMINAL_TASK_STATUSES.includes(s);
}

const TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["working", "cancelled"],
  working: ["waiting_for_input", "waiting_for_approval", "waiting_for_computer", "blocked", "completed", "cancelled", "failed"],
  waiting_for_input: ["working", "cancelled"],
  waiting_for_approval: ["working", "cancelled"],
  waiting_for_computer: ["working", "cancelled"],
  blocked: ["working", "cancelled", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransitionTask(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTask(from, to)) {
    throw new Error(`illegal task transition ${from} -> ${to}`);
  }
}

/** A Run has exactly one terminal transition; the second is always a bug. */
export function assertRunTerminalOnce(current: TaskStatus | undefined, next: TaskStatus): void {
  if (current !== undefined && isTerminalTask(current)) {
    throw new Error(`run already terminal (${current}); refusing ${next}`);
  }
}

export interface Task {
  id: string;
  threadId: string;
  owner: ActorRef;
  assignedBy: "user" | ActorRef | "routine";
  title: string;
  status: TaskStatus;
  parentTaskId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Run {
  id: string;
  taskId: string;
  actor: ActorRef;
  nativeSessionId: string;
  state: TaskStatus;
  startedAt: string;
  finishedAt?: string;
}
