import type { ActorRef } from "./ids.ts";

export type ThreadKind = "direct" | "channel";

export interface Thread {
  id: string;
  kind: ThreadKind;
  title: string;
  participants: ActorRef[];
  cwd?: string;
  createdAt: string;
  updatedAt: string;
}

export type Author =
  | { kind: "user" }
  | { kind: "bot"; botId: string; roleId: string }
  | { kind: "system" };

export type MessageKind = "text" | "tool" | "approval" | "task" | "event";

export interface Message {
  id: string;
  threadId: string;
  seq: number;
  author: Author;
  kind: MessageKind;
  text?: string;
  /** For tool/approval/task cards; opaque to domain, shaped by protocol. */
  payload?: unknown;
  createdAt: string;
}
