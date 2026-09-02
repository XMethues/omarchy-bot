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

