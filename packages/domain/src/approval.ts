/** Native approvals passed through from Agent adapters. No omarchy-bot policy layer. */
export type ApprovalSource = "agent" | "computer";
export type ApprovalStatus = "pending" | "allowed" | "denied" | "expired";

export interface Approval {
  id: string;
  /** Where the blocked action came from. */
  source: ApprovalSource;
  /** Correlated turn, when the request happens inside one. */
  turnId?: string;
  workerSessionId?: string;
  tool: string;
  /** Card details: target app, action, impact, screenshot ref... */
  details: unknown;
  status: ApprovalStatus;
  createdAt: string;
  decidedAt?: string;
}

export type Decision = { allow: boolean; note?: string };

/** Fail closed: anything undecided resolves to not-granted. */
export function isGranted(a: Pick<Approval, "status">): boolean {
  return a.status === "allowed";
}
