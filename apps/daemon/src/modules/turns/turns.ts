import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { AgentEvent, WorkerUserMessage } from "@omarchy-bot/agent-contract";
import type { MessageDto, SendResultDto, TurnDto } from "@omarchy-bot/protocol";
import { canTransitionTurn, isTerminalTurn, type AgentId, type TurnStatus } from "@omarchy-bot/domain";
import type { ThreadsService } from "../threads/threads.ts";
import type { AgentsRegistry } from "../agents/registry.ts";
import type { BotsService } from "../bots/bots.ts";
import type { EventLog } from "../events/eventLog.ts";
import type { AttachmentsService } from "../attachments/attachments.ts";
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
  /** Present only when cancellation came from the explicit abort path. */
  abortReason?: string;
}

interface TerminalTurnWaiter {
  resolve: (turn: TurnDto) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/** Local title from the first user message — no extra Agent call. */
export function deriveTitle(text: string): string {
  const firstLine = text.trim().split("\n")[0]?.trim() ?? "";
  return firstLine.length <= 60 ? firstLine || "New conversation" : `${firstLine.slice(0, 57).trimEnd()}…`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function agentEventFamily(event: AgentEvent): string {
  return event.type === "native" ? "native" : event.type.split(".", 1)[0]!;
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
  #terminalWaiters = new Map<string, Set<TerminalTurnWaiter>>();
  #timeoutQueues = new Map<AgentId, Promise<void>>();

  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly threads: ThreadsService,
    private readonly agents: AgentsRegistry,
    private readonly bots: BotsService,
    private readonly attachments: AttachmentsService,
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
    if (finished) {
      const terminal = this.#turnDto(turnId);
      const waiters = this.#terminalWaiters.get(turnId);
      if (terminal !== undefined && waiters !== undefined) {
        this.#terminalWaiters.delete(turnId);
        for (const waiter of waiters) {
          clearTimeout(waiter.timeout);
          waiter.resolve(terminal);
        }
      }
    }
  }

  /**
   * Send a user message. `threadId: null` creates the thread atomically with
   * the first message and turn (lazy threads — abandoned blanks persist nothing).
   */
  async send(
    botId: string,
    threadId: string | null,
    text: string,
    attachmentIds: string[] = [],
    attachmentDraftToken?: string,
    opts: { cwd?: string } = {},
  ): Promise<SendResultDto> {
    const bot = this.db.query(`SELECT * FROM bots WHERE id = ? AND archived = 0`).get(botId) as { id: string; agent_id: string; instructions: string } | undefined;
    if (!bot) throw new HttpError(404, `unknown bot ${botId}`);
    const agentId = bot.agent_id as AgentId;
    if (this.#timeoutQueues.has(agentId)) {
      throw new HttpError(409, `agent '${agentId}' is stopping a timed-out session; the bot cannot chat right now`);
    }
    const capabilities = this.agents.capabilityInventory(agentId);
    if (!this.agents.isReady(agentId) || capabilities === undefined) {
      throw new HttpError(409, `agent '${agentId}' is not ready; the bot cannot chat right now`);
    }

    // Active turn on the thread -> steer instead of a new turn.
    const existingThreadId = threadId ?? undefined;
    if (existingThreadId !== undefined) {
      const thread = this.threads.getThread(existingThreadId);
      if (!thread || thread.botId !== botId) throw new HttpError(404, `unknown thread ${existingThreadId} for bot ${botId}`);
      const active = this.threads.activeTurn(existingThreadId);
      if (active !== undefined) {
        if (attachmentIds.length > 0) throw new HttpError(409, "attachments cannot be added while steering an active turn");
        return this.#steer(active, text, agentId);
      }
      if (
        this.threads.getNativeSession(existingThreadId) !== undefined
        && !capabilities.nativeThreadActions.includes("resume")
      ) {
        throw new HttpError(409, `session resume is not supported by ${agentId}`);
      }
    }

    const turnId = `turn_${randomUUID().replace(/-/g, "")}`;
    const result: {
      threadId: string;
      messageId: string;
      workerAttachments: NonNullable<WorkerUserMessage["attachments"]>;
    } = this.db.transaction(() => {
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
      const workerAttachments = this.attachments.promoteForMessage({
        attachmentIds,
        botId,
        threadId: tid,
        messageId: userMsg.id,
        draftToken: attachmentDraftToken,
      });
      return { threadId: tid, messageId: userMsg.id, workerAttachments };
    })();

    this.events.append("thread", result.threadId, "thread.created", { botId, threadId: result.threadId, turnId });
    const userMsgDto = this.threads.getMessage(result.messageId)!;
    this.events.append("thread", result.threadId, "message.appended", userMsgDto);
    this.events.append("turn", turnId, "turn.created", { turnId, threadId: result.threadId, botId });
    this.bots.recordActivity(botId, result.threadId, text, false);
    const start = this.#startTurn(turnId, result.threadId, botId, agentId, text, result.workerAttachments);
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

  async #startTurn(
    turnId: string,
    threadId: string,
    botId: string,
    agentId: AgentId,
    text: string,
    attachments: NonNullable<WorkerUserMessage["attachments"]>,
  ): Promise<TurnContext> {
    const botRow = this.db.query(`SELECT instructions FROM bots WHERE id = ?`).get(botId) as { instructions: string } | undefined;
    const thread = this.threads.getThread(threadId)!;
    const worker = await this.supervisor.agentWorker(agentId);
    const nativeSessionId = this.threads.getNativeSession(threadId);
    const options = { cwd: thread.cwd ?? process.cwd(), instructions: botRow?.instructions ?? "" };
    if (
      nativeSessionId !== undefined
      && !this.agents.capabilityInventory(agentId)?.nativeThreadActions.includes("resume")
    ) {
      throw new HttpError(409, `session resume is not supported by ${agentId}`);
    }
    const opened = nativeSessionId
      ? await worker.request({ type: "session.resume", botId, threadId, nativeSessionId, options }, 30_000)
      : await worker.request({ type: "session.open", botId, threadId, options }, 30_000);

    this.threads.setNativeSession(threadId, opened.nativeSessionId);
    this.db.query(`UPDATE turns SET worker_session_id = ?, native_session_id = ? WHERE id = ?`).run(opened.sessionId, opened.nativeSessionId, turnId);

    const turnTimeout = setTimeout(() => {
      const active = this.#turns.get(opened.sessionId);
      if (active !== undefined) this.#queueTimeout(active);
    }, this.cfg.turnTimeoutMs);
    turnTimeout.unref?.();

    const ctx: TurnContext = {
      turnId, threadId, botId, agentId, workerSessionId: opened.sessionId,
      assistantBuf: "", turnTimeout,
    };
    this.#turns.set(opened.sessionId, ctx);
    this.#setTurnStatus(turnId, "working");

    // Dispatch without awaiting turn completion. A worker acknowledges send
    // independently, while this resolved start promise makes immediate steering
    // wait only for the worker session to become drivable.
    const message: WorkerUserMessage = {
      text,
      ...(attachments.length > 0 ? { attachments } : {}),
    };
    void worker.request({ type: "message.send", sessionId: opened.sessionId, turnId, message }, 60_000).catch((err: unknown) => {
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

  async #steer(turn: TurnDto, text: string, agentId: AgentId): Promise<SendResultDto> {
    if (!this.agents.capabilityInventory(agentId)?.steering) {
      throw new HttpError(409, `steering is not supported by ${agentId}`);
    }
    // Supported redirects appear immediately, even while the initial worker
    // session is still opening.
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
      if (!this.agents.capabilityInventory(ctx.agentId)?.steering) {
        throw new Error(`steering is no longer supported by ${ctx.agentId}`);
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

  /** Central agent-event router: worker events become transcript activity and turn transitions. */
  onAgentEvent(agentId: AgentId, event: AgentEvent): void {
    const family = agentEventFamily(event);
    if (!this.agents.capabilityInventory(agentId)?.nativeEventFamilies.includes(family)) {
      this.events.append("agent", agentId, "agent.event_rejected", {
        agentId,
        family,
        eventType: event.type,
        ...(event.type === "native"
          ? { capability: event.capability, sensitivity: event.sensitivity }
          : {}),
        reason: "event family was not declared by the ready agent capability inventory",
      });
      return;
    }
    const sessionId = event.sessionId;
    if (event.type !== "error" || sessionId !== undefined) {
      const ctx = sessionId !== undefined ? this.#turns.get(sessionId) : undefined;
      if (ctx) return this.#routeTurnEvent(ctx, event);
    }
    if (event.type === "error") this.events.append("agent", agentId, "agent.error", { agentId, message: event.message, retryable: event.retryable });
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
          ...(event.sensitivity === "public" ? { payload: event.payload } : { redacted: true }),
        };
        this.threads.appendMessage(ctx.threadId, {
          author: { kind: "bot" },
          kind: "event",
          payload: transcriptPayload,
        });
        this.events.append("turn", ctx.turnId, "agent.native", {
          threadId: ctx.threadId,
          botId: ctx.botId,
          ...transcriptPayload,
        });
        break;
      }
    }
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

  #queueTimeout(ctx: TurnContext): void {
    const previous = this.#timeoutQueues.get(ctx.agentId) ?? Promise.resolve();
    const queued = previous
      .catch(() => {
        // A prior timeout still must not prevent this expired turn from settling.
      })
      .then(() => this.#timeoutTurn(ctx))
      .finally(() => {
        if (this.#timeoutQueues.get(ctx.agentId) === queued) {
          this.#timeoutQueues.delete(ctx.agentId);
        }
      });
    this.#timeoutQueues.set(ctx.agentId, queued);
  }

  async #timeoutTurn(ctx: TurnContext): Promise<void> {
    if (this.#turns.get(ctx.workerSessionId) !== ctx) return;
    const reason = `timed out after ${Math.round(this.cfg.turnTimeoutMs / 1000)}s`;
    let cancellationConfirmed = false;
    try {
      if (this.agents.capabilityInventory(ctx.agentId)?.abort) {
        ctx.abortReason = reason;
        const worker = await this.supervisor.agentWorker(ctx.agentId);
        await worker.request({ type: "turn.abort", sessionId: ctx.workerSessionId }, 30_000);
        await this.waitForTerminal(ctx.turnId, 5_000);
        cancellationConfirmed = true;
      }
    } catch {
      // A failed or unconfirmed native abort falls through to worker quarantine.
    }
    if (cancellationConfirmed) return;

    await this.supervisor.stopAgentWorker(ctx.agentId);
    this.agents.markOffline(ctx.agentId, `worker stopped after ${reason}`);
    for (const active of [...this.#turns.values()]) {
      if (active.agentId !== ctx.agentId) continue;
      this.#finishTurn(
        active,
        "failed",
        active === ctx ? reason : `agent worker stopped after another turn ${reason}`,
      );
    }
  }


  /**
   * Resolve only after the persisted turn is terminal. Archive uses this
   * barrier so a Bot cannot disappear while its native Agent is still working.
   */
  waitForTerminal(turnId: string, timeoutMs = 30_000): Promise<TurnDto> {
    const current = this.#turnDto(turnId);
    if (current === undefined) return Promise.reject(new HttpError(404, `unknown turn ${turnId}`));
    if (isTerminalTurn(current.status)) return Promise.resolve(current);

    return new Promise<TurnDto>((resolve, reject) => {
      let waiter: TerminalTurnWaiter;
      const timeout = setTimeout(() => {
        const waiters = this.#terminalWaiters.get(turnId);
        waiters?.delete(waiter);
        if (waiters?.size === 0) this.#terminalWaiters.delete(turnId);
        reject(new HttpError(502, `turn ${turnId} did not stop`));
      }, timeoutMs);
      waiter = { resolve, timeout };
      const waiters = this.#terminalWaiters.get(turnId) ?? new Set<TerminalTurnWaiter>();
      waiters.add(waiter);
      this.#terminalWaiters.set(turnId, waiters);
    });
  }

  /** Internal cancellation for lifecycle services and timeout recovery. */
  async abortTurn(turnId: string, reason: string): Promise<void> {
    const t = this.threads.turnRow(turnId);
    if (!t || isTerminalTurn(t.status as TurnStatus)) return;
    const bot = this.db.query(`SELECT agent_id FROM bots WHERE id = ?`).get(t.bot_id) as { agent_id: AgentId } | undefined;
    const agentId = bot?.agent_id;
    if (agentId === undefined || !this.agents.capabilityInventory(agentId)?.abort) {
      throw new HttpError(409, `turn abort is not supported by ${agentId ?? "the turn's agent"}`);
    }
    let ctx = [...this.#turns.values()].find((candidate) => candidate.turnId === turnId);
    if (!ctx) {
      const starting = this.#turnStarts.get(turnId);
      if (starting) ctx = await starting.catch(() => undefined);
    }
    if (ctx) {
      if (!this.agents.capabilityInventory(ctx.agentId)?.abort) {
        throw new HttpError(409, `turn abort is not supported by ${ctx.agentId}`);
      }
      ctx.abortReason = reason;
      try {
        const worker = await this.supervisor.agentWorker(ctx.agentId);
        await worker.request({ type: "turn.abort", sessionId: ctx.workerSessionId }, 30_000);
      } catch (error) {
        throw new HttpError(409, `turn abort failed: ${errorMessage(error)}`);
      }
      return;
    }
    this.#setTurnStatus(turnId, "cancelled", reason);
    this.#emitSystemNote(t.thread_id, `turn cancelled (${reason})`);
  }

  /** Lease contention: the turn parks in waiting_for_computer until granted. */
  parkForComputer(turnId: string): void {
    this.#setTurnStatus(turnId, "waiting_for_computer");
  }
  resumeAfterComputer(turnId: string | undefined): void {
    if (turnId === undefined) return;
    const turn = this.threads.turnRow(turnId);
    if (turn?.status === "waiting_for_computer") this.#setTurnStatus(turnId, "working");
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

