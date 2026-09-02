import type {
  ApprovalDto,
  BotDto,
  ComputerStateDto,
  CreateThreadBodyDto,
  EventEnvelope,
  MessageDto,
  ServerToClient,
  ClientToServer,
  RespondApprovalBodyDto,
  SendMessageBodyDto,
  TaskDto,
  ThreadDto,
} from "@omarchy-bot/protocol";

export interface ApiClientOptions {
  baseUrl?: string;
  fetch?: typeof fetch;
}

/** Shared by apps/web today and the Tauri client after the MVP. */
export class ApiClient {
  private readonly base: string;
  private readonly f: typeof fetch;

  constructor(opts: ApiClientOptions = {}) {
    this.base = (opts.baseUrl ?? "").replace(/\/$/, "");
    this.f = opts.fetch ?? fetch;
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await this.f(this.base + path, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-command-id": crypto.randomUUID(), // idempotency key on mutations
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${await res.text()}`);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  listBots(): Promise<BotDto[]> {
    return this.req("/api/bots");
  }
  recheckBot(id: string): Promise<BotDto> {
    return this.req(`/api/bots/${id}/recheck`, { method: "POST" });
  }
  listThreads(): Promise<ThreadDto[]> {
    return this.req("/api/threads");
  }
  createThread(body: CreateThreadBodyDto): Promise<ThreadDto> {
    return this.req("/api/threads", { method: "POST", body: JSON.stringify(body) });
  }
  listMessages(threadId: string): Promise<MessageDto[]> {
    return this.req(`/api/threads/${threadId}/messages`);
  }
  sendMessage(threadId: string, body: SendMessageBodyDto): Promise<MessageDto> {
    return this.req(`/api/threads/${threadId}/messages`, { method: "POST", body: JSON.stringify(body) });
  }
  listTasks(): Promise<TaskDto[]> {
    return this.req("/api/tasks");
  }
  abortTask(id: string): Promise<TaskDto> {
    return this.req(`/api/tasks/${id}/abort`, { method: "POST" });
  }
  listApprovals(): Promise<ApprovalDto[]> {
    return this.req("/api/permissions");
  }
  respondApproval(id: string, body: RespondApprovalBodyDto): Promise<ApprovalDto> {
    return this.req(`/api/permissions/${id}/respond`, { method: "POST", body: JSON.stringify(body) });
  }
  computerState(): Promise<ComputerStateDto> {
    return this.req("/api/computer/state");
  }
  takeOver(): Promise<ComputerStateDto> {
    return this.req("/api/computer/take-over", { method: "POST" });
  }
  release(): Promise<ComputerStateDto> {
    return this.req("/api/computer/release", { method: "POST" });
  }
  emergencyStop(): Promise<ComputerStateDto> {
    return this.req("/api/computer/emergency-stop", { method: "POST" });
  }
  resume(): Promise<ComputerStateDto> {
    return this.req("/api/computer/resume", { method: "POST" });
  }
  computerImageUrl(): string {
    return `${this.base}/api/computer/snapshot?t=${Date.now()}`;
  }

  /** Control/state WebSocket with cursor replay. Never guesses missed state. */
  connectEvents(lastCursor: number | undefined, onEvent: (e: EventEnvelope) => void, opts?: { snapshotRequired?: () => void; onOpen?: () => void }): WebSocket {
    const url = (this.base || `http://${location.host}`).replace(/^http/, "ws") + "/api/events";
    const ws = new WebSocket(url);
    ws.onopen = () => {
      const hello: ClientToServer = lastCursor === undefined ? { type: "hello" } : { type: "hello", lastCursor };
      ws.send(JSON.stringify(hello));
      opts?.onOpen?.();
    };
    ws.onmessage = (m) => {
      const msg = JSON.parse(String(m.data)) as ServerToClient;
      if (msg.type === "event") onEvent(msg.envelope);
      else if (msg.type === "snapshot_required") opts?.snapshotRequired?.();
    };
    return ws;
  }
}
