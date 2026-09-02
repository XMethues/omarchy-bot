import { randomUUID } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { AgentEvent } from "@omarchy-bot/agent-contract";
import type { MessageDto, TaskDto } from "@omarchy-bot/protocol";
import { assertRunTerminalOnce, canTransitionTask, isTerminalTask, type ActorRef, type AgentId, type TaskStatus } from "@omarchy-bot/domain";
import type { ThreadsService } from "../threads/threads.ts";
import type { PermissionsService } from "../permissions/permissions.ts";
import type { BotRegistry } from "../bots/registry.ts";
import type { EventLog } from "../events/eventLog.ts";
import type { Supervisor } from "../../supervision/supervisor.ts";

interface RunRow { id: string; task_id: string; actor_bot_id: string; actor_role_id: string; native_session_id: string; worker_session_id: string; state: string; started_at: string; finished_at: string | null }

interface TurnContext {
  threadId: string;
  taskId: string;
  runId: string;
  botId: string;
  roleId: string;
  workerSessionId: string;
  assistantBuf: string;
  openAssistantMsgId?: string;
  turnTimeout: ReturnType<typeof setTimeout>;
  /** daemon approval id -> worker-side permission id (p_…) */
  permissionWorkerIds: Map<string, string>;
}

/**
 * Owns the Task/Run state machine and turn lifecycle. Completion means work
 * landed — the model stopping only completes a turn; a Task completes when the
 * turn completes cleanly or the user cancels it.
 */
export class TaskRunner {
  #turns = new Map<string, TurnContext>(); // workerSessionId -> ctx
  #activeByTask = new Map<string, string>(); // taskId -> workerSessionId

  constructor(
    private readonly db: Database,
    private readonly events: EventLog,
    private readonly threads: ThreadsService,
    private readonly permissions: PermissionsService,
    private readonly bots: BotRegistry,
    private readonly supervisor: Supervisor,
    private readonly cfg: { turnTimeoutMs: number },
  ) {}

  #taskRow(id: string): { id: string; thread_id: string; owner_bot_id: string; owner_role_id: string; title: string; status: string; created_at: string; updated_at: string } | undefined {
    return this.db.query(`SELECT * FROM tasks WHERE id = ?`).get(id) as any;
  }

  #setTaskStatus(taskId: string, next: TaskStatus): void {
    const t = this.#taskRow(taskId);
    if (!t) return;
    const from = t.status as TaskStatus;
    if (from === next) return;
    if (isTerminalTask(from)) return;
    if (!canTransitionTask(from, next)) return;
    this.db.query(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`).run(next, new Date().toISOString(), taskId);
    this.events.append("task", taskId, "task.status", { taskId, from, to: next, threadId: t.thread_id });
  }

  #setRunState(runId: string, next: TaskStatus, finished = false): void {
    const r = this.db.query(`SELECT * FROM runs WHERE id = ?`).get(runId) as RunRow | undefined;
    if (!r) return;
    assertRunTerminalOnce(isTerminalTask(r.state as TaskStatus) ? (r.state as TaskStatus) : undefined, next);
    this.db.query(`UPDATE runs SET state = ?${finished ? ", finished_at = ?" : ""} WHERE id = ?`).run(...(finished ? [next, new Date().toISOString(), runId] : [next, runId]));
  }

  async sendUserMessage(threadId: string, text: string): Promise<MessageDto> {
    const thread = this.threads.getThread(threadId);
    if (!thread) throw new Error("thread not found");
    if (!this.bots.isEnabled(thread.botId)) throw new Error(`bot ${thread.botId} is not enabled`);
    const bot = this.bots.get(thread.botId);
    if (bot.status !== "ready" && bot.status !== "working" && bot.status !== "waiting_for_input" && bot.status !== "waiting_for_computer" && bot.status !== "waiting_for_approval") {
      throw new Error(`bot ${thread.botId} is ${bot.status}; chat unavailable`);
    }
    const userMsg = this.threads.appendMessage(threadId, { author: { kind: "user" }, kind: "text", text });
    const actor: ActorRef = { botId: thread.botId as AgentId, roleId: thread.roleId };

    const taskId = randomUUID();
    const runId = randomUUID();
    const now = new Date().toISOString();
    this.db
      .query(`INSERT INTO tasks (id, thread_id, owner_bot_id, owner_role_id, assigned_by, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'user', ?, 'queued', ?, ?)`)
      .run(taskId, threadId, actor.botId, actor.roleId, text.slice(0, 80), now, now);
    this.db
      .query(`INSERT INTO runs (id, task_id, actor_bot_id, actor_role_id, worker_session_id, state, started_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)`)
      .run(runId, taskId, actor.botId, actor.roleId, "pending", now);
    this.events.append("task", taskId, "task.created", { taskId, runId, threadId, actor, title: text.slice(0, 80) });

    void this.#startTurn(threadId, taskId, runId, actor, text);
    return userMsg;
  }

  async #startTurn(threadId: string, taskId: string, runId: string, actor: ActorRef, text: string): Promise<void> {
    const thread = this.threads.getThread(threadId)!;
    const cwd = thread.cwd ?? this.bots.defaultCwd(actor.botId);
    const worker = await this.supervisor.agentWorker(actor.botId);
    const nativeSessionId = this.threads.getNativeSession(actor.roleId, threadId);

    const opened = nativeSessionId
      ? await worker.request({ type: "session.resume", actor, nativeSessionId, options: { cwd, permissionPolicy: this.bots.policy(actor.botId) } }, 30_000)
      : await worker.request({ type: "session.open", actor, options: { cwd, permissionPolicy: this.bots.policy(actor.botId) } }, 30_000);

    this.threads.setNativeSession(actor.roleId, threadId, opened.nativeSessionId);
    this.db.query(`UPDATE runs SET worker_session_id = ?, native_session_id = ? WHERE id = ?`).run(opened.sessionId, opened.nativeSessionId, runId);

    const turnTimeout = setTimeout(() => {
      this.#emitSystemNote(threadId, `turn timed out after ${Math.round(this.cfg.turnTimeoutMs / 1000)}s; failing closed`);
      void this.abortTask(taskId, "timeout");
    }, this.cfg.turnTimeoutMs);
    turnTimeout.unref?.();

    const ctx: TurnContext = { threadId, taskId, runId, botId: actor.botId, roleId: actor.roleId, workerSessionId: opened.sessionId, assistantBuf: "", turnTimeout, permissionWorkerIds: new Map() };
    this.#turns.set(opened.sessionId, ctx);
    this.#activeByTask.set(taskId, opened.sessionId);

    this.#setTaskStatus(taskId, "working");
    this.#setRunState(runId, "working");
    this.#setStatusBot(actor.botId, "working");

    await worker.request({ type: "message.send", sessionId: opened.sessionId, runId, message: { text } }, 60_000);
  }

  #setStatusBot(botId: string, status: "ready" | "working" | "waiting_for_input" | "waiting_for_approval" | "waiting_for_computer"): void {
    this.db.query(`UPDATE bots SET status = ?, updated_at = ? WHERE id = ? AND enabled = 1`).run(status, new Date().toISOString(), botId);
    this.events.append("bot", botId, "bot.status", { status });
  }

  /** Central agent-event router: worker events become messages, approvals, task transitions. */
  onAgentEvent(botId: string, event: AgentEvent): void {
    const sessionId = (event as { sessionId?: string }).sessionId;
    if (event.type !== "error" || sessionId) {
      const ctx = sessionId ? this.#turns.get(sessionId) : undefined;
    if (ctx) return this.#routeTurnEvent(ctx, event);
    }
    // Unmatched events (e.g. crash notifications) — surface as system notes on the bot's latest thread if any
    if (event.type === "error") this.events.append("bot", botId, "bot.error", { message: event.message, retryable: event.retryable });
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
          author: { kind: "bot", botId: ctx.botId, roleId: ctx.roleId },
          kind: "tool",
          payload: { toolId: event.id, name: event.name, input: event.input, state: "running" },
        });
        this.events.append("thread", ctx.threadId, "message.delta", { threadId: ctx.threadId, messageId: m.id });
        break;
      }
      case "tool.updated":
      case "tool.completed": {
        this.events.append("thread", ctx.threadId, "tool.updated", { threadId: ctx.threadId, toolId: event.id, output: event.type === "tool.completed" ? event.output : event.output, isError: event.type === "tool.completed" ? event.isError : false, final: event.type === "tool.completed" });
        break;
      }
      case "permission.requested": {
        this.#setTaskStatus(ctx.taskId, "waiting_for_approval");
        const approval = this.permissions.create({
          source: "agent",
          tool: event.tool,
          details: event.details,
          runId: ctx.runId,
          workerSessionId: ctx.workerSessionId,
          timeoutMs: this.cfg.turnTimeoutMs,
          threadId: ctx.threadId,
        });
        ctx.permissionWorkerIds.set(approval.id, event.id);
        this.threads.appendMessage(ctx.threadId, {
          author: { kind: "system" },
          kind: "approval",
          payload: { permissionId: approval.id, tool: event.tool, details: event.details },
        });
        void this.#awaitPermission(ctx, approval.id).catch((err: unknown) => {
          this.#emitSystemNote(ctx.threadId, `permission forward failed: ${String(err)}`);
        });
        break;
      }
      case "turn.completed": {
        this.#finishTurn(ctx, "completed");
        break;
      }
      case "turn.cancelled": {
        this.#finishTurn(ctx, "cancelled");
        break;
      }
      case "error": {
        this.threads.appendMessage(ctx.threadId, { author: { kind: "system" }, kind: "event", text: `error: ${event.message}` });
        this.#finishTurn(ctx, "failed", event.message);
        break;
      }
      default:
        // native envelopes: preserved as typed events, never dropped silently
        this.events.append("run", ctx.runId, "agent.native", { capability: (event as any).capability, sensitivity: (event as any).sensitivity ?? "public", payload: (event as any).payload });
    }
  }

  async #awaitPermission(ctx: TurnContext, permissionId: string): Promise<void> {
    const allowed = await new Promise<boolean>((resolve) => this.permissions.registerWaiter(permissionId, resolve));
    const t = this.#taskRow(ctx.taskId);
    if (t && t.status === "waiting_for_approval") this.#setTaskStatus(ctx.taskId, "working");
    const workerPermissionId = ctx.permissionWorkerIds.get(permissionId);
    if (!workerPermissionId) throw new Error(`no worker permission id recorded for approval ${permissionId}`);
    const w = await this.supervisor.agentWorker(ctx.botId);
    await w.request({ type: "permission.respond", sessionId: ctx.workerSessionId, permissionId: workerPermissionId, decision: { allow: allowed } }, 30_000);
  }

  #finishTurn(ctx: TurnContext, outcome: "completed" | "cancelled" | "failed", reason?: string): void {
    clearTimeout(ctx.turnTimeout);
    this.#turns.delete(ctx.workerSessionId);
    this.#activeByTask.delete(ctx.taskId);

    if (ctx.assistantBuf.trim()) {
      this.threads.appendMessage(ctx.threadId, {
        author: { kind: "bot", botId: ctx.botId, roleId: ctx.roleId },
        kind: "text",
        text: ctx.assistantBuf,
      });
    } else if (outcome !== "completed") {
      this.threads.appendMessage(ctx.threadId, { author: { kind: "system" }, kind: "event", text: reason ? `turn ${outcome}: ${reason}` : `turn ${outcome}` });
    }

    this.#setRunState(ctx.runId, outcome, true);
    this.#setTaskStatus(ctx.taskId, outcome);
    // Bot returns to ready only if no other turn is active for it.
    const stillBusy = [...this.#turns.values()].some((t) => t.botId === ctx.botId);
    this.#setStatusBot(ctx.botId, stillBusy ? "working" : "ready");
    this.events.append("thread", ctx.threadId, "message.delta", { threadId: ctx.threadId, messageId: "turn-end" });
  }

  #emitSystemNote(threadId: string, text: string): void {
    this.threads.appendMessage(threadId, { author: { kind: "system" }, kind: "event", text });
  }

  async abortTask(taskId: string, reason: string): Promise<void> {
    const t = this.#taskRow(taskId);
    if (!t || isTerminalTask(t.status as TaskStatus)) return undefined;
    const wsid = this.#activeByTask.get(taskId);
    if (wsid) {
      const ctx = this.#turns.get(wsid);
      if (ctx) {
        const worker = await this.supervisor.agentWorker(ctx.botId).catch(() => undefined);
        await worker?.request({ type: "turn.abort", sessionId: wsid }, 30_000).catch(() => {});
        return; // terminal state arrives via turn.cancelled/error
      }
    }
    this.#setRunState((this.db.query(`SELECT id FROM runs WHERE task_id = ? ORDER BY started_at DESC`).get(taskId) as { id: string } | undefined)?.id ?? "", "cancelled", true);
    this.#setTaskStatus(taskId, "cancelled");
    this.#emitSystemNote(t.thread_id, `task cancelled (${reason})`);
  }

  /** Lease contention: the run parks in waiting_for_computer until granted. */
  parkForComputer(runId: string): void {
    const r = this.db.query(`SELECT * FROM runs WHERE id = ?`).get(runId) as RunRow | undefined;
    if (!r || isTerminalTask(r.state as TaskStatus)) return;
    this.#setRunState(runId, "waiting_for_computer");
    this.#setTaskStatus(r.task_id, "waiting_for_computer");
    this.#setStatusBot(r.actor_bot_id, "waiting_for_computer");
  }

  /** Computer lease handover: Take over parks the driving run in waiting_for_input. */
  parkForHuman(ctxBotId: string, runId: string | undefined): void {
    if (!runId) return;
    const r = this.db.query(`SELECT * FROM runs WHERE id = ?`).get(runId) as RunRow | undefined;
    if (!r || isTerminalTask(r.state as TaskStatus)) return;
    this.#setRunState(runId, "waiting_for_input");
    this.#setTaskStatus(r.task_id, "waiting_for_input");
    this.#setStatusBot(ctxBotId, "waiting_for_input");
  }

  resumeAfterHuman(runId: string | undefined): void {
    if (!runId) return;
    const r = this.db.query(`SELECT * FROM runs WHERE id = ?`).get(runId) as RunRow | undefined;
    if (!r || r.state !== "waiting_for_input") return;
    this.#setRunState(runId, "working");
    this.#setTaskStatus(r.task_id, "working");
    this.#setStatusBot(r.actor_bot_id, "working");
  }
}
