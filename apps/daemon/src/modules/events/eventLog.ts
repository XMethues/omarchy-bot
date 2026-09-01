import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { EventEnvelope } from "@omarchy-bot/protocol";

type Listener = (e: EventEnvelope) => void;

/** Durable, monotonic event log. One SQLite writer; WS clients replay by cursor. */
export class EventLog {
  #listeners = new Set<Listener>();
  constructor(private readonly db: Database) {}

  append(aggregateType: EventEnvelope["aggregateType"], aggregateId: string, type: string, payload: unknown): EventEnvelope {
    const env: EventEnvelope = {
      schemaVersion: 1,
      eventId: randomUUID(),
      cursor: 0,
      occurredAt: new Date().toISOString(),
      aggregateType,
      aggregateId,
      type,
      payload,
    };
    const r = this.db
      .query(
        `INSERT INTO events (event_id, schema_version, occurred_at, aggregate_type, aggregate_id, type, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING cursor`,
      )
      .get(env.eventId, env.schemaVersion, env.occurredAt, aggregateType, aggregateId, type, JSON.stringify(payload ?? null)) as { cursor: number };
    env.cursor = r.cursor;
    for (const l of this.#listeners) l(env);
    return env;
  }

  /** Replay after a cursor. `oldest` is returned when the client is behind retention. */
  replay(lastCursor: number, oldest: number): { events: EventEnvelope[]; snapshotRequired: boolean } {
    if (lastCursor < oldest - 1) return { events: [], snapshotRequired: true };
    const rows = this.db
      .query(`SELECT * FROM events WHERE cursor > ? ORDER BY cursor ASC`)
      .all(lastCursor) as any[];
    return {
      events: rows.map((r) => ({
        schemaVersion: r.schema_version,
        eventId: r.event_id,
        cursor: r.cursor,
        occurredAt: r.occurred_at,
        aggregateType: r.aggregate_type,
        aggregateId: r.aggregate_id,
        type: r.type,
        payload: JSON.parse(r.payload),
      })),
      snapshotRequired: false,
    };
  }

  oldestCursor(): number {
    const r = this.db.query(`SELECT MIN(cursor) AS c FROM events`).get() as { c: number | null };
    return r.c ?? 0;
  }

  subscribe(l: Listener): () => void {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }
}
