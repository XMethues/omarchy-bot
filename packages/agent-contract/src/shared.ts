export interface Hello {
  type: "hello";
  v: number;
  worker: string;
  pid: number;
}

export interface OpenSessionOptionsLike {
  cwd: string;
  model?: string;
  permissionPolicy: "ask" | "trusted";
}

export interface PermissionRequestDetailsLike {
  /** Human-readable summary for the approval card. */
  summary?: string;
  /** Arbitrary tool-specific detail (command, path, diff...). */
  [k: string]: unknown;
}
