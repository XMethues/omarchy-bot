export interface Hello {
  type: "hello";
  v: number;
  worker: string;
  pid: number;
}

export interface OpenSessionOptionsLike {
  cwd: string;
  /** Bot Job/Instructions; the adapter injects them into the system prompt. Empty = none. */
  instructions: string;
  model?: string;
}

export interface PermissionRequestDetailsLike {
  /** Human-readable summary for the approval card. */
  summary?: string;
  /** Arbitrary tool-specific detail (command, path, diff...). */
  [k: string]: unknown;
}
