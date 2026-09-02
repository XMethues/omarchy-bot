import type { EventEnvelope } from "@omarchy-bot/protocol";
import { api } from "./api.ts";
import { clearDelta, pushDelta } from "./live.ts";

export type QueryTag =
  | "agents"
  | "bots"
  | "threads"
  | "messages"
  | "approvals"
  | "turns"
  | "computer"
  | "dictation";

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
    case "agent.status":
    case "agent.error":
    case "agent.worker_crash":
      invalidate("agents");
      invalidate("bots");
      return;
    case "bot.created":
    case "bot.updated":
    case "bot.activity":
    case "bot.archived":
    case "bot.restored":
    case "bot.read":
      invalidate("bots");
      return;
    case "thread.created":
      invalidate("threads");
      invalidate("bots");
      return;
    case "message.appended": {
      clearDelta(threadIdOf(envelope) ?? "");
      invalidate("messages", threadIdOf(envelope));
      invalidate("threads");
      invalidate("bots");
      return;
    }
    case "message.delta": {
      if (typeof p.text === "string") {
        pushDelta(threadIdOf(envelope) ?? "", p.text);
      } else if (typeof p.messageId === "string") {
        clearDelta(threadIdOf(envelope) ?? "");
        invalidate("messages", threadIdOf(envelope));
      }
      return;
    }
    case "tool.updated":
      invalidate("messages", threadIdOf(envelope));
      return;
    case "agent.native":
      invalidate("messages", threadIdOf(envelope));
      return;
    case "turn.created":
    case "turn.status":
    case "turn.steered":
      invalidate("turns");
      invalidate("threads");
      invalidate("bots");
      return;
    case "approval.requested":
    case "approval.decided":
    case "approval.expired":
      invalidate("approvals");
      invalidate("turns");
      invalidate("messages", threadIdOf(envelope));
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
    case "dictation.state.changed":
      invalidate("dictation");
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
    socket = api.connectEvents(
      cursor,
      (envelope) => {
        cursor = envelope.cursor;
        route(envelope, invalidate);
      },
      {
        snapshotRequired: () => {
          cursor = undefined;
          onSnapshotRequired();
        },
        onOpen: () => {
          retries = 0;
        },
      },
    );
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
