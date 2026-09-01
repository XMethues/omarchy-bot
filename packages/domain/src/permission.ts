export type PermissionSource = "agent" | "computer";
export type PermissionStatus = "pending" | "allowed" | "denied" | "expired";

export interface PermissionRequest {
  id: string;
  /** Where the blocked action came from. */
  source: PermissionSource;
  /** Correlated Run, when the request happens inside one. */
  runId?: string;
  tool: string;
  /** Card details: target app, action, impact, screenshot ref... */
  details: unknown;
  status: PermissionStatus;
  createdAt: string;
  decidedAt?: string;
}

export type Decision = { allow: boolean; note?: string };

/** Fail closed: anything undecided resolves to not-granted. */
export function isGranted(p: Pick<PermissionRequest, "status">): boolean {
  return p.status === "allowed";
}
