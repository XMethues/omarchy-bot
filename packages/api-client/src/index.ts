import type {
  AgentDto,
  AttachmentDto,
  AttachmentDraftTokenDto,
  AvatarRecipeBodyDto,
  BotDto,
  BotViewDto,
  ClientToServer,
  ComputerViewDto,
  CreateBotBodyDto,
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
import {
  ComputerViewDto as ComputerViewSchema,
  DeleteBotResultDto as DeleteBotResultSchema,
} from "@omarchy-bot/protocol";

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface ComputerSurfaceOwner {
  botId: string;
  surfaceId: ComputerViewDto["surfaceId"];
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
  recheckAgent(id: AgentDto["id"]): Promise<AgentDto> {
    return this.req(`/api/agents/${id}/recheck`, { method: "POST" });
  }

  // ----- bots -----
  listBots(): Promise<BotViewDto[]> {
    return this.req("/api/bots");
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
  async deleteBot(id: string): Promise<DeleteBotResultDto> {
    try {
      const response = await this.req<unknown>(`/api/bots/${id}`, { method: "DELETE", body: "{}" });
      return DeleteBotResultSchema.parse(response);
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
  async stageAttachment(botId: string, draftToken: AttachmentDraftTokenDto, file: File): Promise<AttachmentDto> {
    const form = new FormData();
    form.append("file", file);
    const res = await this.f(`${this.base}/api/attachments/stage`, {
      method: "POST",
      headers: {
        "x-bot-id": botId,
        "x-attachment-draft-token": draftToken,
        "x-command-id": crypto.randomUUID(),
      },
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
  getStagedAttachment(id: string, draftToken: AttachmentDraftTokenDto): Promise<AttachmentDto> {
    return this.req(`/api/attachments/staged/${id}`, {
      headers: { "x-attachment-draft-token": draftToken },
    });
  }
  unstageAttachment(id: string, draftToken: AttachmentDraftTokenDto): Promise<void> {
    return this.req(`/api/attachments/staged/${id}`, {
      method: "DELETE",
      headers: { "x-attachment-draft-token": draftToken },
    });
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
  async computerState(owner: ComputerSurfaceOwner): Promise<ComputerViewDto> {
    try {
      return ComputerViewSchema.parse(
        await this.req<unknown>(this.computerPath("/api/computer/state", owner)),
      );
    } catch (error) {
      if (error !== null && typeof error === "object" && "body" in error) {
        const result = ComputerViewSchema.safeParse(error.body);
        if (result.success && result.data.unavailableReason === "capacity") return result.data;
      }
      throw error;
    }
  }
  takeControl(owner: ComputerSurfaceOwner): Promise<ComputerViewDto> {
    return this.req(this.computerPath("/api/computer/take-control", owner), { method: "POST" });
  }
  returnToBot(owner: ComputerSurfaceOwner): Promise<ComputerViewDto> {
    return this.req(this.computerPath("/api/computer/return-to-bot", owner), { method: "POST" });
  }
  computerProjectionUrl(owner: ComputerSurfaceOwner): string {
    return `${this.base}${this.computerPath("/api/computer/projection", owner)}`;
  }

  private computerPath(path: string, owner: ComputerSurfaceOwner): string {
    return `${path}?botId=${encodeURIComponent(owner.botId)}&surfaceId=${encodeURIComponent(owner.surfaceId)}`;
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

