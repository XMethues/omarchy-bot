import type { Database } from "bun:sqlite";
import type { SurfaceId } from "@omarchy-bot/domain";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const EXPIRY_SWEEP_MS = 60 * 60 * 1_000;

export type InputDiagnosticCategory =
  | "controller"
  | "pointer-button"
  | "pointer-scroll"
  | "key"
  | "shortcut"
  | "paste"
  | "release"
  | "invalid";
export type InputDiagnosticOutcome = "accepted" | "rejected" | "failed" | "released";

/**
 * Local-only diagnostics whose interface cannot accept text, key characters,
 * controller identifiers, frames, tokens, or arbitrary metadata.
 */
export class InputDiagnostics {
  #expiryTimer: Timer;

  constructor(
    private readonly db: Database,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.expire();
    this.#expiryTimer = setInterval(() => this.expire(), EXPIRY_SWEEP_MS);
    this.#expiryTimer.unref?.();
  }

  record(
    surfaceId: SurfaceId,
    category: InputDiagnosticCategory,
    outcome: InputDiagnosticOutcome,
    latencyMs: number,
    redactedLength?: number,
  ): void {
    const occurredAt = this.now();
    this.expire(occurredAt);
    this.db.query(
      `INSERT INTO input_diagnostics
       (surface_id, occurred_at, actor_kind, action_category, outcome, redacted_length, latency_ms)
       VALUES (?, ?, 'browser', ?, ?, ?, ?)`,
    ).run(
      surfaceId,
      occurredAt.toISOString(),
      category,
      outcome,
      redactedLength ?? null,
      Math.max(0, Math.round(latencyMs)),
    );
  }

  expire(now = this.now()): void {
    this.db.query("DELETE FROM input_diagnostics WHERE occurred_at < ?")
      .run(new Date(now.getTime() - RETENTION_MS).toISOString());
  }

  shutdown(): void {
    clearInterval(this.#expiryTimer);
  }
}
