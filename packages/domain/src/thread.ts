export interface Thread {
  id: string;
  botId: string;
  title: string;
  cwd?: string;
  createdAt: string;
  updatedAt: string;
}

/** The thread owns the Bot; messages carry no per-author Bot/Role identity. */
export type Author = { kind: "user" } | { kind: "bot" } | { kind: "system" };

export type MessageKind = "text" | "tool" | "approval" | "event";

export interface Message {
  id: string;
  threadId: string;
  seq: number;
  author: Author;
  kind: MessageKind;
  text?: string;
  /** For tool/approval cards; opaque to domain, shaped by protocol. */
  payload?: unknown;
  createdAt: string;
}
