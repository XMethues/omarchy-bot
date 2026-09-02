import type {
  AgentDto,
  AttachmentDto,
  ArchiveBodyDto,
  AvatarRecipeBodyDto,
  BotDto,
  BotViewDto,
  ClientToServer,
  ComputerViewDto,
  CreateBotBodyDto,
  DeleteBotBodyDto,
  DeleteBotResultDto,
  DictationDto,
  DictationResultDto,
  EventEnvelope,
  MessageDto,
  PatchBotBodyDto,
  PatchThreadBodyDto,
  PinBodyDto,
  SendMessageBodyDto,
  SendResultDto,
  ServerToClient,
  ThreadDto,
} from "@omarchy-bot/protocol";
import { DeleteBotResultDto as DeleteBotResultSchema } from "@omarchy-bot/protocol";

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface ApiError extends Error {
  status: number;
  body: unknown;
}

/** Shared by apps/web today and the Tauri client after the MVP. */
export class ApiClient {
  private readonly base: string;
  private readonly f: typeof fetch;

  constructor(opts: ApiClientOptions = {}) {
    this.base = (opts.baseUrl ?? "").replace(/\/$/, "");
    this.f = opts.fetch ?? fetch.bind(globalThis);
  }

  get baseUrl(): string {
    return this.base;
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.f(`${this.base}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-command-id": crypto.randomUUID(),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* keep raw text */
      }
      const err = new Error(`${res.status} ${res.statusText}: ${typeof body === "string" ? body : JSON.stringify(body)}`) as ApiError;
      err.status = res.status;
      err.body = body;
      throw err;
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // ----- agents -----
  listAgents(): Promise<AgentDto[]> {
    return this.req("/api/agents");
  }

  // ----- bots -----
  listBots(includeArchived = false): Promise<BotViewDto[]> {
    return this.req(`/api/bots${includeArchived ? "?includeArchived=1" : ""}`);
  }
  createBot(body: CreateBotBodyDto): Promise<BotDto> {
    return this.req("/api/bots", { method: "POST", body: JSON.stringify(body) });
  }
  getBot(id: string): Promise<BotViewDto> {
    return this.req(`/api/bots/${id}`);
  }
  patchBot(id: string, body: PatchBotBodyDto): Promise<BotDto> {
    return this.req(`/api/bots/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  }
  pinBot(id: string, body: PinBodyDto): Promise<BotDto> {
    return this.req(`/api/bots/${id}/pin`, { method: "POST", body: JSON.stringify(body) });
  }
  archiveBot(id: string, body: ArchiveBodyDto = {}): Promise<BotDto> {
    return this.req(`/api/bots/${id}/archive`, { method: "POST", body: JSON.stringify(body) });
  }
  restoreBot(id: string): Promise<BotDto> {
    return this.req(`/api/bots/${id}/restore`, { method: "POST" });
  }
  async deleteBot(id: string, body: DeleteBotBodyDto): Promise<DeleteBotResultDto> {
    try {
      return await this.req(`/api/bots/${id}`, { method: "DELETE", body: JSON.stringify(body) });
    } catch (error) {
      if (error !== null && typeof error === "object" && "body" in error) {
        const result = DeleteBotResultSchema.safeParse(error.body);
        if (result.success) return result.data;
      }
      throw error;
    }
  }
  generateAvatar(id: string): Promise<BotDto> {
    return this.req(`/api/bots/${id}/avatar/generate`, { method: "POST" });
  }
  async uploadAvatar(id: string, file: Blob): Promise<BotDto> {
    const res = await this.f(`${this.base}/api/bots/${id}/avatar/upload`, {
      method: "POST",
      headers: { "content-type": file.type || "application/octet-stream", "x-command-id": crypto.randomUUID() },
      body: file,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`${res.status}: ${text}`) as ApiError;
      err.status = res.status;
      err.body = text;
      throw err;
    }
    return (await res.json()) as BotDto;
  }
  avatarRecipe(id: string, body: AvatarRecipeBodyDto): Promise<BotDto> {
    return this.req(`/api/bots/${id}/avatar/recipe`, { method: "POST", body: JSON.stringify(body) });
  }
  avatarUrl(id: string): string {
    return `${this.base}/api/bots/${id}/avatar`;
  }
  markBotRead(id: string, threadId: string): Promise<void> {
    return this.req(`/api/bots/${id}/read`, { method: "POST", body: JSON.stringify({ threadId }) });
  }
  listBotThreads(id: string, q?: string): Promise<ThreadDto[]> {
    return this.req(`/api/bots/${id}/threads${q ? `?q=${encodeURIComponent(q)}` : ""}`);
  }
  sendBotMessage(id: string, body: SendMessageBodyDto): Promise<SendResultDto> {
    return this.req(`/api/bots/${id}/messages`, { method: "POST", body: JSON.stringify(body) });
  }

  // ----- threads & messages -----
  getThread(id: string): Promise<ThreadDto> {
    return this.req(`/api/threads/${id}`);
  }
  patchThread(id: string, body: PatchThreadBodyDto): Promise<ThreadDto> {
    return this.req(`/api/threads/${id}`, { method: "PATCH", body: JSON.stringify(body) });
  }
  listMessages(threadId: string): Promise<MessageDto[]> {
    return this.req(`/api/threads/${threadId}/messages`);
  }
  sendMessage(threadId: string, body: SendMessageBodyDto): Promise<SendResultDto> {
    return this.req(`/api/threads/${threadId}/messages`, { method: "POST", body: JSON.stringify(body) });
  }


  // ----- attachments -----
  async stageAttachment(botId: string, file: File): Promise<AttachmentDto> {
    const form = new FormData();
    form.append("file", file);
    const res = await this.f(`${this.base}/api/attachments/stage`, {
      method: "POST",
      headers: { "x-bot-id": botId, "x-command-id": crypto.randomUUID() },
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const err = new Error(`${res.status}: ${text}`) as ApiError;
      err.status = res.status;
      err.body = text;
      throw err;
    }
    return (await res.json()) as AttachmentDto;
  }
  getStagedAttachment(id: string): Promise<AttachmentDto> {
    return this.req(`/api/attachments/staged/${id}`);
  }
  unstageAttachment(id: string): Promise<void> {
    return this.req(`/api/attachments/staged/${id}`, { method: "DELETE" });
  }
  attachmentUrl(id: string): string {
    return `${this.base}/api/attachments/${id}`;
  }


  // ----- dictation -----
  dictation(): Promise<DictationDto> {
    return this.req("/api/dictation");
  }
  startDictation(): Promise<DictationDto> {
    return this.req("/api/dictation/start", { method: "POST" });
  }
  stopDictation(): Promise<DictationResultDto> {
    return this.req("/api/dictation/stop", { method: "POST" });
  }
  cancelDictation(): Promise<DictationDto> {
    return this.req("/api/dictation/cancel", { method: "POST" });
  }


  // ----- computer -----
  computerState(botId?: string): Promise<ComputerViewDto> {
    return this.req(`/api/computer/state${botId === undefined ? "" : `?botId=${encodeURIComponent(botId)}`}`);
  }
  takeControl(): Promise<ComputerViewDto> {
    return this.req("/api/computer/take-control", { method: "POST" });
  }
  returnToBot(): Promise<ComputerViewDto> {
    return this.req("/api/computer/return-to-bot", { method: "POST" });
  }
  emergencyStop(): Promise<ComputerViewDto> {
    return this.req("/api/computer/emergency-stop", { method: "POST" });
  }
  resumeComputer(): Promise<ComputerViewDto> {
    return this.req("/api/computer/resume", { method: "POST" });
  }
  computerImageUrl(): string {
    return `${this.base}/api/computer/snapshot?t=${Date.now()}`;
  }

  // ----- events -----
  /** Control/state WebSocket with cursor replay. Never guesses missed state. */
  connectEvents(
    lastCursor: number | undefined,
    onEvent: (e: EventEnvelope) => void,
    opts?: { snapshotRequired?: () => void; onOpen?: () => void; onCaughtUp?: () => void },
  ): WebSocket {
    // Resolve relative bases (web served by the daemon) against the page origin.
    const base = this.base !== "" ? this.base : (typeof window !== "undefined" ? window.location.origin : "");
    const wsUrl = `${base.replace(/^http/, "ws")}/api/events`;
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
      const hello: ClientToServer = { type: "hello", ...(lastCursor !== undefined ? { lastCursor } : {}) };
      ws.send(JSON.stringify(hello));
      opts?.onOpen?.();
    };
    ws.onmessage = (ev) => {
      let msg: ServerToClient;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === "event") onEvent(msg.envelope);
      if (msg.type === "snapshot_required") opts?.snapshotRequired?.();
      if (msg.type === "hello") opts?.onCaughtUp?.();
    };
    return ws;
  }
}

