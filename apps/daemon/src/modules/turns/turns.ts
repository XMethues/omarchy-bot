import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { AgentEvent } from "@omarchy-bot/agent-contract";
import type { MessageDto, SendResultDto, TurnDto } from "@omarchy-bot/protocol";
import { canTransitionTurn, isTerminalTurn, type AgentId, type TurnStatus } from "@omarchy-bot/domain";
import type { ThreadsService } from "../threads/threads.ts";
import type { ApprovalsService } from "../approvals/approvals.ts";
import type { AgentsRegistry } from "../agents/registry.ts";
import type { BotsService } from "../bots/bots.ts";
import type { EventLog } from "../events/eventLog.ts";
import type { Supervisor } from "../../supervision/supervisor.ts";
import { HttpError } from "../bots/bots.ts";

interface TurnContext {
  turnId: string;
  threadId: string;
  botId: string;
  agentId: AgentId;
  workerSessionId: string;
  assistantBuf: string;
  turnTimeout: ReturnType<typeof setTimeout>;
  /** daemon approval id -> worker-side permission id (p_…) */
  approvalWorkerIds: Map<string, string>;
  /** Present only when cancellation came from the explicit abort path. */
  abortReason?: string;
}

/** Local title from the first user message — no extra Agent call. */
export function deriveTitle(text: string): string {
  const firstLine = text.trim().split("\n")[0]?.trim() ?? "";
  return firstLine.length <= 60 ? firstLine || "New conversation" : `${firstLine.slice(0, 57).trimEnd()}…`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Owns the turn lifecycle: send (atomic thread+message+turn when the thread
 * is new), steer (mid-turn redirect), and the worker event routing that ends
 * turns. Completion only arrives via terminal worker events, timeout or abort
 * — fail closed.
 */
export class TurnService {
  #turns = new Map<string, TurnContext>(); // workerSessionId -> ctx
  #turnStarts = new Map<string, Promise<TurnContext>>();

  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly threads: ThreadsService,
    private readonly approvals: ApprovalsService,
    private readonly agents: AgentsRegistry,
    private readonly bots: BotsService,
    private readonly supervisor: Supervisor,
    private readonly cfg: { turnTimeoutMs: number },
  ) {}

  #turnDto(id: string): TurnDto | undefined {
    const r = this.threads.turnRow(id);
    return r ? this.threads.turnToDto(r) : undefined;
  }

  #setTurnStatus(turnId: string, next: TurnStatus, reason?: string): void {
    const t = this.threads.turnRow(turnId);
    if (!t) return;
    const from = t.status as TurnStatus;
    if (from === next || isTerminalTurn(from) || !canTransitionTurn(from, next)) return;
    const finished = isTerminalTurn(next);
    this.db
      .query(`UPDATE turns SET status = ?${finished ? ", finished_at = ?" : ""}${reason !== undefined ? ", outcome_reason = ?" : ""} WHERE id = ?`)
      .run(...(finished && reason !== undefined ? [next, new Date().toISOString(), reason, turnId] : finished ? [next, new Date().toISOString(), turnId] : reason !== undefined ? [next, reason, turnId] : [next, turnId]));
    this.events.append("turn", turnId, "turn.status", { turnId, from, to: next, threadId: t.thread_id, botId: t.bot_id });
  }

  /**
   * Send a user message. `threadId: null` creates the thread atomically with
   * the first message and turn (lazy threads — abandoned blanks persist nothing).
   */
  async send(botId: string, threadId: string | null, text: string, opts: { cwd?: string } = {}): Promise<SendResultDto> {
    const bot = this.db.query(`SELECT * FROM bots WHERE id = ? AND archived = 0`).get(botId) as { id: string; agent_id: string; instructions: string } | undefined;
    if (!bot) throw new HttpError(404, `unknown bot ${botId}`);
    const agentId = bot.agent_id as AgentId;
    if (!this.agents.isReady(agentId)) {
      throw new HttpError(409, `agent '${agentId}' is not ready; the bot cannot chat right now`);
    }

    // Active turn on the thread -> steer instead of a new turn.
    const existingThreadId = threadId ?? undefined;
    if (existingThreadId !== undefined) {
      const thread = this.threads.getThread(existingThreadId);
      if (!thread || thread.botId !== botId) throw new HttpError(404, `unknown thread ${existingThreadId} for bot ${botId}`);
      const active = this.threads.activeTurn(existingThreadId);
      if (active !== undefined) return this.#steer(active, text);
    }

    const turnId = `turn_${randomUUID().replace(/-/g, "")}`;
    const result: { threadId: string; messageId: string } = this.db.transaction(() => {
      let tid = existingThreadId;
      let title = "New conversation";
      if (tid === undefined) {
        tid = randomUUID();
        title = deriveTitle(text);
        this.threads.insertThreadRow(tid, botId, title, opts.cwd);
      }
      const userMsg = this.threads.appendMessageQuiet(tid, { author: { kind: "user" }, kind: "text", text });
      if (existingThreadId === undefined) {
        // First message derives the title for pre-existing blank threads too.
        const t = this.threads.getThread(tid);
        if (t && t.title === "New conversation") {
          this.db.query(`UPDATE threads SET title = ? WHERE id = ?`).run(title, tid);
        }
      }
      this.threads.insertTurnRow({ id: turnId, threadId: tid, botId, nativeSessionId: this.threads.getNativeSession(tid) ?? "" });
      return { threadId: tid, messageId: userMsg.id };
    })();

    this.events.append("thread", result.threadId, "thread.created", { botId, threadId: result.threadId, turnId });
    const userMsgDto = this.threads.getMessage(result.messageId)!;
    this.events.append("thread", result.threadId, "message.appended", userMsgDto);
    this.events.append("turn", turnId, "turn.created", { turnId, threadId: result.threadId, botId });
    this.bots.recordActivity(botId, result.threadId, text, false);
    const start = this.#startTurn(turnId, result.threadId, botId, agentId, text);
    this.#turnStarts.set(turnId, start);
    void start
      .catch((err: unknown) => {
        const row = this.threads.turnRow(turnId);
        if (!row || isTerminalTurn(row.status as TurnStatus)) return;
        const reason = errorMessage(err);
        this.#emitSystemNote(result.threadId, `turn failed to start: ${reason}`);
        this.#setTurnStatus(turnId, "failed", reason);
      })
      .finally(() => {
        if (this.#turnStarts.get(turnId) === start) this.#turnStarts.delete(turnId);
      });
    return { threadId: result.threadId, messageId: result.messageId, turnId, action: "sent" };
  }

  async #startTurn(turnId: string, threadId: string, botId: string, agentId: AgentId, text: string): Promise<TurnContext> {
    const botRow = this.db.query(`SELECT instructions FROM bots WHERE id = ?`).get(botId) as { instructions: string } | undefined;
    const thread = this.threads.getThread(threadId)!;
    const worker = await this.supervisor.agentWorker(agentId);
    const nativeSessionId = this.threads.getNativeSession(threadId);
    const options = { cwd: thread.cwd ?? process.cwd(), instructions: botRow?.instructions ?? "" };

    const opened = nativeSessionId
      ? await worker.request({ type: "session.resume", botId, threadId, nativeSessionId, options }, 30_000)
      : await worker.request({ type: "session.open", botId, threadId, options }, 30_000);

    this.threads.setNativeSession(threadId, opened.nativeSessionId);
    this.db.query(`UPDATE turns SET worker_session_id = ?, native_session_id = ? WHERE id = ?`).run(opened.sessionId, opened.nativeSessionId, turnId);

    const turnTimeout = setTimeout(() => {
      this.#emitSystemNote(threadId, `turn timed out after ${Math.round(this.cfg.turnTimeoutMs / 1000)}s; failing closed`);
      void this.abortTurn(turnId, "timeout").catch(() => {});
    }, this.cfg.turnTimeoutMs);
    turnTimeout.unref?.();

    const ctx: TurnContext = {
      turnId, threadId, botId, agentId, workerSessionId: opened.sessionId,
      assistantBuf: "", turnTimeout, approvalWorkerIds: new Map(),
    };
    this.#turns.set(opened.sessionId, ctx);
    this.#setTurnStatus(turnId, "working");

    // Dispatch without awaiting turn completion. A worker acknowledges send
    // independently, while this resolved start promise makes immediate steering
    // wait only for the worker session to become drivable.
    void worker.request({ type: "message.send", sessionId: opened.sessionId, turnId, message: { text } }, 60_000).catch((err: unknown) => {
      if (this.#turns.get(opened.sessionId) !== ctx) return;
      this.#routeTurnEvent(ctx, {
        type: "error",
        sessionId: opened.sessionId,
        message: errorMessage(err),
        retryable: false,
      });
    });
    return ctx;
  }

  async #steer(turn: TurnDto, text: string): Promise<SendResultDto> {
    // Persist and publish first so the user's redirect appears immediately,
    // even while the initial worker session is still opening.
    const userMsg = this.threads.appendMessage(turn.threadId, {
      author: { kind: "user" }, kind: "text", text, payload: { turnId: turn.id },
    });
    this.bots.recordActivity(turn.botId, turn.threadId, text, false);
    try {
      let ctx = [...this.#turns.values()].find((candidate) => candidate.turnId === turn.id);
      if (!ctx) {
        const starting = this.#turnStarts.get(turn.id);
        if (!starting) throw new Error("active turn has no worker session");
        ctx = await starting;
      }
      const current = this.threads.turnRow(turn.id);
      if (!current || isTerminalTurn(current.status as TurnStatus) || this.#turns.get(ctx.workerSessionId) !== ctx) {
        throw new Error("turn is no longer active");
      }
      const worker = await this.supervisor.agentWorker(ctx.agentId);
      await worker.request({ type: "message.steer", sessionId: ctx.workerSessionId, text }, 30_000);
      this.db.query(`UPDATE turns SET steer_count = steer_count + 1 WHERE id = ?`).run(turn.id);
      this.events.append("turn", turn.id, "turn.steered", {
        turnId: turn.id,
        threadId: turn.threadId,
        messageId: userMsg.id,
      });
    } catch (err) {
      // A rejected native steer is transcript-visible but never changes,
      // aborts, or replaces the original turn.
      const reason = errorMessage(err);
      this.#emitSystemNote(turn.threadId, `steer unavailable: ${reason}`);
      throw new HttpError(409, `steer unavailable: ${reason}`);
    }
    return { threadId: turn.threadId, messageId: userMsg.id, turnId: turn.id, action: "steered" };
  }

  /** Central agent-event router: worker events become messages, approvals, turn transitions. */
  onAgentEvent(agentId: AgentId, event: AgentEvent): void {
    const sessionId = (event as { sessionId?: string }).sessionId;
    if (event.type !== "error" || sessionId !== undefined) {
      const ctx = sessionId !== undefined ? this.#turns.get(sessionId) : undefined;
      if (ctx) return this.#routeTurnEvent(ctx, event);
    }
    if (event.type === "error") this.events.append("bot", agentId, "agent.error", { agentId, message: event.message, retryable: event.retryable });
  }

  #routeTurnEvent(ctx: TurnContext, event: AgentEvent): void {
    switch (event.type) {
      case "message.delta": {
        ctx.assistantBuf += event.text;
        this.events.append("thread", ctx.threadId, "message.delta", { threadId: ctx.threadId, text: event.text });
        break;
      }
      case "tool.started": {
        const m = this.threads.appendMessage(ctx.threadId, {
          author: { kind: "bot" },
          kind: "tool",
          payload: { toolId: event.id, name: event.name, input: event.input, state: "running" },
        });
        this.events.append("thread", ctx.threadId, "message.delta", { threadId: ctx.threadId, messageId: m.id });
        break;
      }
      case "tool.updated":
      case "tool.completed": {
        const isComplete = event.type === "tool.completed";
        const isError = isComplete && event.isError;
        this.threads.updateToolMessage(ctx.threadId, event.id, {
          state: isError ? "error" : isComplete ? "complete" : "running",
          ...(event.output !== undefined ? { output: event.output } : {}),
          ...(isComplete ? { isError: event.isError } : {}),
        });
        this.events.append("thread", ctx.threadId, "tool.updated", {
          threadId: ctx.threadId,
          toolId: event.id,
          output: event.output,
          isError,
          final: isComplete,
        });
        break;
      }
      case "permission.requested": {
        this.#setTurnStatus(ctx.turnId, "waiting_for_approval");
        const approval = this.approvals.create({
          tool: event.tool,
          details: event.details,
          turnId: ctx.turnId,
          workerSessionId: ctx.workerSessionId,
          timeoutMs: this.cfg.turnTimeoutMs,
          threadId: ctx.threadId,
        });
        ctx.approvalWorkerIds.set(approval.id, event.id);
        this.threads.appendMessage(ctx.threadId, {
          author: { kind: "system" },
          kind: "approval",
          payload: { approvalId: approval.id, tool: event.tool, details: event.details },
        });
        void this.#awaitApproval(ctx, approval.id).catch((err: unknown) => {
          this.#emitSystemNote(ctx.threadId, `approval forward failed: ${String(err)}`);
        });
        break;
      }
      case "turn.completed": {
        this.#finishTurn(ctx, "completed");
        break;
      }
      case "turn.cancelled": {
        this.#finishTurn(ctx, "cancelled", ctx.abortReason);
        break;
      }
      case "error": {
        this.threads.appendMessage(ctx.threadId, { author: { kind: "system" }, kind: "event", text: `error: ${event.message}` });
        this.#finishTurn(ctx, "failed", event.message);
        break;
      }
      case "native": {
        const transcriptPayload = {
          capability: event.capability,
          sensitivity: event.sensitivity,
          ...(event.sensitivity === "secret" ? { redacted: true } : { payload: event.payload }),
        };
        this.threads.appendMessage(ctx.threadId, {
          author: { kind: "bot" },
          kind: "event",
          payload: transcriptPayload,
        });
        this.events.append("turn", ctx.turnId, "agent.native", {
          threadId: ctx.threadId,
          botId: ctx.botId,
          capability: event.capability,
          sensitivity: event.sensitivity,
          payload: event.payload,
        });
        break;
      }
    }
  }

  async #awaitApproval(ctx: TurnContext, approvalId: string): Promise<void> {
    const allowed = await new Promise<boolean>((resolve) => this.approvals.registerWaiter(approvalId, resolve));
    const t = this.threads.turnRow(ctx.turnId);
    if (t && t.status === "waiting_for_approval") this.#setTurnStatus(ctx.turnId, "working");
    const workerPermissionId = ctx.approvalWorkerIds.get(approvalId);
    if (!workerPermissionId) throw new Error(`no worker permission id recorded for approval ${approvalId}`);
    const w = await this.supervisor.agentWorker(ctx.agentId);
    await w.request({ type: "permission.respond", sessionId: ctx.workerSessionId, permissionId: workerPermissionId, decision: { allow: allowed } }, 30_000);
  }

  #finishTurn(ctx: TurnContext, outcome: "completed" | "cancelled" | "failed", reason?: string): void {
    clearTimeout(ctx.turnTimeout);
    this.#turns.delete(ctx.workerSessionId);

    let assistantMsg: MessageDto | undefined;
    if (ctx.assistantBuf.trim()) {
      assistantMsg = this.threads.appendMessage(ctx.threadId, { author: { kind: "bot" }, kind: "text", text: ctx.assistantBuf });
      this.bots.recordActivity(ctx.botId, ctx.threadId, ctx.assistantBuf.trim(), true);
    }
    if (outcome !== "completed") {
      // Keep the transcript honest: non-clean turn ends always leave a note.
      this.threads.appendMessage(ctx.threadId, { author: { kind: "system" }, kind: "event", text: reason ? `turn ${outcome}: ${reason}` : `turn ${outcome}` });
    }

    this.#setTurnStatus(ctx.turnId, outcome, reason);
    this.events.append("thread", ctx.threadId, "message.delta", { threadId: ctx.threadId, messageId: assistantMsg?.id ?? "turn-end" });
  }

  #emitSystemNote(threadId: string, text: string): void {
    this.threads.appendMessage(threadId, { author: { kind: "system" }, kind: "event", text });
  }

  /** Explicit abort (archive-with-stop, tests). Terminal arrives via turn.cancelled. */
  async abortTurn(turnId: string, reason: string): Promise<void> {
    const t = this.threads.turnRow(turnId);
    if (!t || isTerminalTurn(t.status as TurnStatus)) return;
    let ctx = [...this.#turns.values()].find((candidate) => candidate.turnId === turnId);
    if (!ctx) {
      const starting = this.#turnStarts.get(turnId);
      if (starting) ctx = await starting.catch(() => undefined);
    }
    if (ctx) {
      ctx.abortReason = reason;
      const worker = await this.supervisor.agentWorker(ctx.agentId).catch(() => undefined);
      await worker?.request({ type: "turn.abort", sessionId: ctx.workerSessionId }, 30_000).catch(() => {});
      return;
    }
    this.#setTurnStatus(turnId, "cancelled", reason);
    this.#emitSystemNote(t.thread_id, `turn cancelled (${reason})`);
  }

  /** Lease contention: the turn parks in waiting_for_computer until granted. */
  parkForComputer(turnId: string): void {
    this.#setTurnStatus(turnId, "waiting_for_computer");
  }

  /** Computer lease handover: Take over parks the driving turn in waiting_for_input. */
  parkForHuman(turnId: string | undefined): void {
    if (turnId !== undefined) this.#setTurnStatus(turnId, "waiting_for_input");
  }

  resumeAfterHuman(turnId: string | undefined): void {
    if (turnId === undefined) return;
    const t = this.threads.turnRow(turnId);
    if (t && t.status === "waiting_for_input") this.#setTurnStatus(turnId, "working");
  }
}

