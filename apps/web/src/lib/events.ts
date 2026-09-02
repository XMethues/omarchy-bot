import type { EventEnvelope } from "@omarchy-bot/protocol";
import { api } from "./api.ts";
import { clearDelta, pushDelta } from "./live.ts";

export type QueryTag =
  | "bots"
  | "threads"
  | "messages"
  | "approvals"
  | "tasks"
  | "computer";

export type Invalidate = (tag: QueryTag, threadId?: string) => void;

let cursor: number | undefined;
let socket: WebSocket | undefined;
let started = false;

function payloadOf(envelope: EventEnvelope): Record<string, unknown> {
  return (envelope.payload ?? {}) as Record<string, unknown>;
}

function threadIdOf(envelope: EventEnvelope): string | undefined {
  const p = payloadOf(envelope);
  return typeof p.threadId === "string" ? p.threadId : envelope.aggregateType === "thread" ? envelope.aggregateId : undefined;
}

function route(envelope: EventEnvelope, invalidate: Invalidate): void {
  const p = payloadOf(envelope);
  switch (envelope.type) {
    case "bot.status":
    case "bot.enabled":
    case "bot.error":
    case "bot.worker_crash":
      invalidate("bots");
      return;
    case "thread.created":
      invalidate("threads");
      return;
    case "message.appended": {
      const tid = threadIdOf(envelope);
      clearDelta(tid ?? "");
      invalidate("messages", tid);
      invalidate("threads");
      return;
    }
    case "message.delta": {
      const tid = threadIdOf(envelope);
      if (typeof p.text === "string" && tid) pushDelta(tid, p.text);
      else if (tid) invalidate("messages", tid);
      return;
    }
    case "tool.updated":
      invalidate("messages", threadIdOf(envelope));
      return;
    case "permission.requested":
    case "permission.decided":
    case "permission.expired":
      invalidate("approvals");
      invalidate("tasks");
      invalidate("messages", threadIdOf(envelope));
      return;
    case "task.created":
    case "task.status":
      invalidate("tasks");
      return;
    case "computer.lease.granted":
    case "computer.lease.released":
    case "computer.lease.queued":
    case "computer.take_over":
    case "computer.im_done":
    case "computer.emergency_stop":
    case "computer.resumed":
    case "computer.action":
      invalidate("computer");
      invalidate("bots");
      return;
    default:
      return;
  }
}

/**
 * Single shared WS connection with cursor-based replay. On snapshot_required
 * (or repeated reconnects) callers refetch everything; the cursor resets.
 */
export function startEventPump(invalidate: Invalidate, onSnapshotRequired: () => void): void {
  if (started) return;
  started = true;
  let retries = 0;

  const connect = (): void => {
    socket = api.connectEvents(cursor, (envelope) => {
      cursor = envelope.cursor;
      retries = 0;
      route(envelope, invalidate);
    }, {
      onOpen: () => {
        retries = 0;
      },
      snapshotRequired: () => {
        cursor = undefined;
        onSnapshotRequired();
      },
    });
    socket.onclose = () => {
      retries += 1;
      if (retries > 5) {
        cursor = undefined;
        onSnapshotRequired();
      }
      setTimeout(connect, Math.min(1000 * 2 ** retries, 10_000));
    };
  };
  connect();
}
