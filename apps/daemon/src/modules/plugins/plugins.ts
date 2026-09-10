import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ToolListChangedNotificationSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import { redactToolErrorSummary, type AgentPluginSnapshot, type AgentPluginToolDefinition, type AgentPluginToolOutput, type NativePluginResources } from "@omarchy-bot/agent-contract";
import {
  PLUGIN_PROVIDERS, PluginProviderId, SaveMcpBody, SKILL_CATALOG_PAGE_SIZE, SKILL_SEARCH_LIMIT,
  type AuthorizePluginBody, type CatalogSkillDetailDto, type CatalogSkillDto, type InstalledSkillDto,
  type McpConnectionDto, type PluginAccountDto, type PluginProviderDto, type PluginServiceDefinition, type PluginStateDto,
  type SkillCatalogDto, type SkillCommandDto,
} from "@omarchy-bot/protocol";
import { HttpError } from "../bots/bots.ts";
import { connectMcp, type McpConnection } from "./mcp.ts";
import { materializeSkill, skillFrontmatter } from "./skillInstaller.ts";

const DEFAULT_PUBLISHER_ORIGIN = "https://omarchy-bot-site-ymlq.vercel.app";

const Grant = z.object({
  generation: z.string(), accessToken: z.string(), refreshToken: z.string().optional(), expiresAt: z.number().optional(),
  scopes: z.array(z.string()), cloudUrl: z.string().url(), metadata: z.record(z.unknown()).default({}),
});
type Grant = z.infer<typeof Grant>;
const Account = z.object({
  id: z.string(), providerId: PluginProviderId, label: z.string(), identity: z.string(), enabledServices: z.array(z.string()),
  status: z.enum(["connected", "reauthorize"]), error: z.string().optional(), grant: Grant,
});
type Account = z.infer<typeof Account>;
const Mcp = SaveMcpBody.extend({
  id: z.string(), generation: z.string(), status: z.enum(["unchecked", "connected", "error"]), toolCount: z.number(), error: z.string().optional(),
});
type Mcp = z.infer<typeof Mcp>;
const Skill = z.object({
  id: z.string(), name: z.string(), description: z.string(), source: z.string(), sourceType: z.enum(["github", "well-known"]), installUrl: z.string(), installs: z.number().optional(),
  enabled: z.boolean(), revision: z.string(), directory: z.string(), installedAt: z.string(), updatedAt: z.string(), lastCheckedAt: z.string().optional(), error: z.string().optional(),
});
type Skill = z.infer<typeof Skill>;
const StoredState = z.object({
  version: z.literal(1), revision: z.number().int().nonnegative(), cloudUrl: z.string().url().nullable(), accounts: z.array(Account), mcp: z.array(Mcp), skills: z.array(Skill),
});
const CatalogEntry = z.object({
  id: z.string(), name: z.string(), source: z.string(), sourceType: z.enum(["github", "well-known"]), installUrl: z.string().url().nullable(), installs: z.number().optional(),
});
const TokenResponse = z.object({ access_token: z.string().min(1), refresh_token: z.string().optional(), expires_in: z.coerce.number().positive().optional(), scope: z.string().optional() }).passthrough();
const ProviderIdentityId = z.union([z.string().min(1), z.number().int()]);
const ApiArguments = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"), path: z.string().min(1),
  query: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(), body: z.unknown().optional(),
  bodyBase64: z.string().max(3 * 1024 * 1024).optional(), contentType: z.string().max(200).optional(),
}).strict().refine((body) => body.body === undefined || body.bodyBase64 === undefined, "Choose JSON body or bodyBase64, not both");
const API_TOOL_SCHEMA: Record<string, unknown> = {
  type: "object", properties: {
    method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
    path: { type: "string", description: "Provider-relative API path, never an arbitrary origin." },
    query: { type: "object", additionalProperties: { type: ["string", "number", "boolean"] } },
    body: { description: "JSON request body." }, bodyBase64: { type: "string", description: "Binary upload bytes as base64, instead of body." },
    contentType: { type: "string" },
  }, required: ["path"], additionalProperties: false,
};

interface PoolEntry {
  promise: Promise<McpConnection>;
  toolPromise?: Promise<AgentPluginToolDefinition[]>;
  refs: number;
  keep(): boolean;
}
interface OAuthPending {
  providerId: PluginProviderId; accountId?: string; verifier: string; cloudUrl: string; returnUrl: string; expiresAt: number;
  brokerState: string;
}
export interface PluginLease {
  snapshot: AgentPluginSnapshot;
  call(name: string, arguments_: Record<string, unknown>, signal: AbortSignal): Promise<AgentPluginToolOutput>;
  release(): void;
}

function skillCommand(id: string): string {
  return `omarchy-${createHash("sha256").update(id).digest("hex").slice(0, 16)}`;
}
function toolName(connectionId: string, name: string): string {
  return `plugin_${name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 35)}_${createHash("sha256").update(connectionId).update("\0").update(name).digest("hex").slice(0, 16)}`;
}
function hasScopes(grant: Grant, service: PluginServiceDefinition): boolean {
  const granted = new Set(grant.scopes.map((scope) => scope.replace(/^https:\/\/graph\.microsoft\.com\//, "").toLowerCase()));
  return service.scopes.every((scope) => granted.has(scope.replace(/^https:\/\/graph\.microsoft\.com\//, "").toLowerCase()));
}

export class PluginsService {
  #state: z.infer<typeof StoredState>;
  #file: string;
  #pool = new Map<string, PoolEntry>();
  #refreshing = new Map<Grant, Promise<string>>();
  #oauth = new Map<string, OAuthPending>();
  #installing = new Map<string, Promise<InstalledSkillDto>>();
  #skillRefs = new Map<string, number>();
  #catalog = new Map<string, CatalogSkillDto>();
  #providerCache: { at: number; providers: PluginProviderDto[]; error?: string } | undefined;
  #nativeCache?: { at: number; resources: NativePluginResources; error?: string };
  #nativePending: Promise<NativePluginResources> | undefined;
  #updatePromise: Promise<void> | undefined;
  #timer: ReturnType<typeof setInterval>;
  #stopping = false;

  constructor(private readonly rootDir: string, private readonly cwd: string, private readonly nativeResources: () => Promise<NativePluginResources>) {
    mkdirSync(rootDir, { recursive: true, mode: 0o700 });
    if (!lstatSync(rootDir).isDirectory() || lstatSync(rootDir).isSymbolicLink()) throw new Error("Plugin state directory must be a private real directory");
    chmodSync(rootDir, 0o700);
    this.#file = path.join(rootDir, "configuration.json");
    if (existsSync(this.#file)) {
      if (!lstatSync(this.#file).isFile() || lstatSync(this.#file).isSymbolicLink()) throw new Error("Plugin configuration must be a private regular file");
      chmodSync(this.#file, 0o600);
      this.#state = StoredState.parse(JSON.parse(readFileSync(this.#file, "utf8")));
    } else {
      this.#state = { version: 1, revision: 0, cloudUrl: null, accounts: [], mcp: [], skills: [] };
    }
    this.#timer = setInterval(() => { if (this.#state.skills.length) void this.updateSkills().catch(() => undefined); }, 6 * 60 * 60 * 1000);
    this.#timer.unref();
  }

  #persist(configurationChanged = false): void {
    if (configurationChanged) this.#state.revision++;
    const temporary = `${this.#file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(this.#state), { flag: "wx", mode: 0o600 });
      renameSync(temporary, this.#file);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
    if (configurationChanged) this.#reap();
  }

  #reap(): void {
    for (const [key, entry] of this.#pool) {
      if (entry.refs !== 0 || (!this.#stopping && entry.keep())) continue;
      this.#pool.delete(key);
      void entry.promise.then((connection) => connection.close()).catch(() => undefined);
    }
  }

  async #cloud(base: string, route: string, body?: unknown): Promise<unknown> {
    const url = new URL(base);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new HttpError(400, "Publisher URL must be an HTTPS origin");
    const response = await fetch(`${url.origin}/api/plugins/${route}`, {
      method: body === undefined ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json", accept: "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new HttpError(502, "Publisher backend returned an invalid response"); }
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string" ? payload.error : `Publisher backend returned HTTP ${response.status}`;
      throw new HttpError(response.status, redactToolErrorSummary(message));
    }
    return payload;
  }

  #cloudUrl(): string {
    return this.#state.cloudUrl ?? DEFAULT_PUBLISHER_ORIGIN;
  }

  configure(cloudUrl: string | null): void {
    if (cloudUrl !== null) {
      const url = new URL(cloudUrl);
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new HttpError(400, "Publisher URL must be an HTTPS origin");
      cloudUrl = url.origin;
    }
    this.#state.cloudUrl = cloudUrl;
    this.#providerCache = undefined;
    this.#catalog.clear();
    this.#persist(true);
  }

  async #providers(): Promise<{ providers: PluginProviderDto[]; error?: string }> {
    if (this.#providerCache && Date.now() - this.#providerCache.at < 30_000) return this.#providerCache;
    let providers: PluginProviderDto[] = Object.values(PLUGIN_PROVIDERS).map(({ id, name, mode, services, documentationUrl }) => ({ id, name, mode, documentationUrl,
      services: services.map(({ id: serviceId, name: serviceName, description }) => ({ id: serviceId, name: serviceName, description })), setupReason: "Publisher backend is unavailable." }));
    let error: string | undefined;
    try {
      const remote = z.array(z.object({ id: PluginProviderId, setupReason: z.string().optional() })).parse(await this.#cloud(this.#cloudUrl(), "providers"));
      providers = providers.map((provider) => {
        const registered = remote.find((item) => item.id === provider.id);
        const { setupReason: _reason, ...known } = provider;
        return { ...known, ...(registered === undefined ? { setupReason: "Publisher does not support this provider." } : registered.setupReason ? { setupReason: registered.setupReason } : {}) };
      });
    } catch (failure) { error = redactToolErrorSummary(failure instanceof Error ? failure.message : failure); }
    this.#providerCache = { at: Date.now(), providers, ...(error ? { error } : {}) };
    return this.#providerCache;
  }

  async #native(): Promise<NativePluginResources> {
    if (this.#nativeCache && Date.now() - this.#nativeCache.at < 30_000) return this.#nativeCache.resources;
    this.#nativePending ??= this.nativeResources().then((resources) => {
      this.#nativeCache = { at: Date.now(), resources };
      return resources;
    }).catch((error: unknown) => {
      this.#nativeCache = { at: Date.now(), resources: { skills: [] }, error: redactToolErrorSummary(error instanceof Error ? error.message : error) };
      return this.#nativeCache.resources;
    }).finally(() => { this.#nativePending = undefined; });
    return this.#nativePending;
  }

  #accountDto(account: Account): PluginAccountDto {
    const { grant, error, ...visible } = account;
    return { ...visible, grantedScopes: [...grant.scopes], ...(error === undefined ? {} : { error }) };
  }
  #mcpDto(connection: Mcp): McpConnectionDto {
    const { id, name, enabled, status, toolCount, error, transport } = connection;
    return { id, name, enabled, status, toolCount, ...(error ? { error } : {}), transport: transport.type === "stdio"
      ? { type: "stdio", command: transport.command, args: transport.args, envKeys: Object.keys(transport.env ?? {}) }
      : { type: "http", url: transport.url, headerKeys: Object.keys(transport.headers ?? {}) } };
  }
  #skillDto(skill: Skill): InstalledSkillDto {
    const { directory: _directory, error, installs, lastCheckedAt, ...visible } = skill;
    return { ...visible, ...(error === undefined ? {} : { error }), ...(installs === undefined ? {} : { installs }), ...(lastCheckedAt === undefined ? {} : { lastCheckedAt }) };
  }

  async state(): Promise<PluginStateDto> {
    const [cloud, native] = await Promise.all([this.#providers(), this.#native()]);
    return { revision: this.#state.revision, cloudUrl: this.#cloudUrl(), providers: cloud.providers,
      accounts: this.#state.accounts.map((account) => this.#accountDto(account)), mcp: this.#state.mcp.map((connection) => this.#mcpDto(connection)), skills: this.#state.skills.map((skill) => this.#skillDto(skill)),
      nativeSkills: native.skills.map((skill) => ({ ...skill, agentId: "pi", readOnly: true })),
      ...(cloud.error ? { cloudError: cloud.error } : {}), ...(this.#nativeCache?.error ? { nativeError: this.#nativeCache.error } : {}) };
  }

  saveMcp(id: string | null, input: z.input<typeof SaveMcpBody>): McpConnectionDto {
    const body = SaveMcpBody.parse(input);
    const previous = id === null ? undefined : this.#state.mcp.find((entry) => entry.id === id);
    if (id !== null && !previous) throw new HttpError(404, "MCP connection not found");
    if (body.transport.type === "http") {
      const url = new URL(body.transport.url);
      if (url.username || url.password || [...url.searchParams.keys()].some((key) => /^(access_token|token|api[_-]?key|secret|password)$/i.test(key))) throw new HttpError(400, "Put MCP credentials in write-only headers, not in the URL");
      if (body.transport.headers === undefined && previous?.transport.type === "http") body.transport.headers = previous.transport.headers;
    } else if (body.transport.env === undefined && previous?.transport.type === "stdio") body.transport.env = previous.transport.env;
    const connection: Mcp = { ...body, id: id ?? `mcp_${randomUUID().replace(/-/g, "")}`, generation: randomUUID(), status: "unchecked", toolCount: 0 };
    this.#state.mcp = [...this.#state.mcp.filter((entry) => entry.id !== id), connection];
    this.#persist(true);
    return this.#mcpDto(connection);
  }

  enableMcp(id: string, enabled: boolean): void {
    const connection = this.#state.mcp.find((entry) => entry.id === id);
    if (!connection) throw new HttpError(404, "MCP connection not found");
    connection.enabled = enabled;
    this.#persist(true);
  }
  removeMcp(id: string): void {
    if (!this.#state.mcp.some((entry) => entry.id === id)) throw new HttpError(404, "MCP connection not found");
    this.#state.mcp = this.#state.mcp.filter((entry) => entry.id !== id);
    this.#persist(true);
  }

  #connection(key: string, create: () => Promise<McpConnection>, keep: () => boolean): PoolEntry {
    let entry = this.#pool.get(key);
    if (!entry) {
      entry = { promise: create(), refs: 0, keep };
      this.#pool.set(key, entry);
      const selected = entry;
      void entry.promise.then((connection) => {
        const previousClose = connection.client.onclose;
        connection.client.onclose = () => {
          previousClose?.();
          if (this.#pool.get(key) === selected) this.#pool.delete(key);
        };
        connection.client.setNotificationHandler(ToolListChangedNotificationSchema, () => { delete selected.toolPromise; });
      }).catch(() => { if (this.#pool.get(key) === selected) this.#pool.delete(key); });
    }
    return entry;
  }

  async #tools(entry: PoolEntry): Promise<AgentPluginToolDefinition[]> {
    entry.toolPromise ??= (async () => {
      const signal = AbortSignal.timeout(20_000);
      const connection = await entry.promise;
      if (!connection.client.getServerCapabilities()?.tools) return [];
      const tools: AgentPluginToolDefinition[] = [];
      const cursors = new Set<string>();
      const names = new Set<string>();
      let cursor: string | undefined;
      do {
        const page = await connection.client.listTools(cursor ? { cursor } : {}, { timeout: 20_000, signal });
        for (const tool of page.tools) {
          if (names.has(tool.name)) throw new Error("MCP server returned duplicate tool names");
          names.add(tool.name);
          tools.push({ name: tool.name, description: tool.description ?? tool.title ?? tool.name, inputSchema: tool.inputSchema });
        }
        cursor = page.nextCursor;
        if (cursor && cursors.has(cursor)) throw new Error("MCP server returned a repeated tool-list cursor");
        if (cursor) cursors.add(cursor);
        if (tools.length > 2000) throw new Error("MCP server exposed more than 2000 tools");
      } while (cursor);
      return tools;
    })().catch((error) => { delete entry.toolPromise; throw error; });
    return entry.toolPromise;
  }

  async checkMcp(id: string): Promise<McpConnectionDto> {
    const current = this.#state.mcp.find((entry) => entry.id === id);
    if (!current) throw new HttpError(404, "MCP connection not found");
    const generation = current.generation;
    const entry = this.#connection(`${id}:${generation}`, () => connectMcp(current.transport, this.cwd), () => this.#state.mcp.some((item) => item.id === id && item.generation === generation && item.enabled));
    entry.refs++;
    try {
      const tools = await this.#tools(entry);
      if (this.#state.mcp.includes(current)) { current.status = "connected"; current.toolCount = tools.length; delete current.error; this.#persist(); }
    } catch (error) {
      if (this.#state.mcp.includes(current)) { current.status = "error"; current.error = redactToolErrorSummary(error instanceof Error ? error.message : error); this.#persist(); }
    } finally { entry.refs--; this.#reap(); }
    return this.#mcpDto(current);
  }

  async catalog(query = "", cursor?: string, view = "trending"): Promise<SkillCatalogDto> {
    const parameters = new URLSearchParams({ q: query, view, ...(cursor === undefined ? {} : { cursor }) });
    const raw = z.object({ data: z.array(CatalogEntry), pagination: z.object({ page: z.number().int().nonnegative(), perPage: z.number().int().positive(), total: z.number().int().nonnegative(), hasMore: z.boolean() }).optional() }).parse(await this.#cloud(this.#cloudUrl(), `catalog?${parameters}`));
    const isSearch = Boolean(query.trim());
    if (!isSearch && !raw.pagination) throw new HttpError(502, "Catalog pagination is unavailable");
    const skills = raw.data.map((entry): CatalogSkillDto => {
      const { installs, ...fields } = entry;
      const skill: CatalogSkillDto = { ...fields, installUrl: entry.installUrl ?? (entry.sourceType === "github" ? `https://github.com/${entry.source}` : `https://${entry.source}`), description: "", ...(installs === undefined ? {} : { installs }) };
      this.#catalog.set(skill.id, skill);
      return skill;
    });
    return {
      skills,
      total: isSearch ? skills.length : raw.pagination!.total,
      pageSize: isSearch ? SKILL_CATALOG_PAGE_SIZE : raw.pagination!.perPage,
      ...(isSearch ? { searchLimit: SKILL_SEARCH_LIMIT } : raw.pagination!.hasMore ? { nextCursor: String(raw.pagination!.page + 1) } : {}),
    };
  }

  async detail(id: string): Promise<CatalogSkillDetailDto> {
    const raw = z.object({ id: z.string(), source: z.string(), slug: z.string(), installs: z.number().optional(), files: z.array(z.object({ path: z.string(), contents: z.string() })).nullable() }).parse(await this.#cloud(this.#cloudUrl(), `catalog/detail?${new URLSearchParams({ id })}`));
    const content = raw.files?.find((file) => file.path === "SKILL.md")?.contents ?? "";
    const cached = this.#catalog.get(id);
    const sourceType = cached?.sourceType ?? (raw.source.includes("/") ? "github" : "well-known");
    let metadata = { name: cached?.name ?? raw.slug, description: cached?.description ?? "" };
    if (content) metadata = skillFrontmatter(content);
    // The catalog can use the original name while detail returns a canonical slug.
    if (raw.id !== `${raw.source}/${raw.slug}` || (raw.id !== id && (!content || id !== `${raw.source}/${metadata.name}`))) throw new HttpError(502, "Catalog returned a mismatched skill identity");
    return { id, ...metadata, source: raw.source, sourceType, installUrl: cached?.installUrl ?? (sourceType === "github" ? `https://github.com/${raw.source}` : `https://${raw.source}`),
      ...(raw.installs === undefined ? {} : { installs: raw.installs }), content, url: `https://skills.sh/${id.split("/").map(encodeURIComponent).join("/")}` };
  }

  installSkill(id: string): Promise<InstalledSkillDto> {
    const pending = this.#installing.get(id);
    if (pending) return pending;
    const existed = this.#state.skills.some((skill) => skill.id === id);
    const operation = (async () => {
      const detail = await this.detail(id);
      const installed = await materializeSkill(detail, path.join(this.rootDir, "skills"));
      const previous = this.#state.skills.find((skill) => skill.id === id);
      if (this.#stopping || (existed && !previous)) {
        await this.#removeUnusedSkill(installed.directory);
        throw new HttpError(409, "Skill was removed or plugin runtime stopped during installation");
      }
      const now = new Date().toISOString();
      const { content: _content, url: _url, ...catalog } = detail;
      const skill: Skill = { ...catalog, ...installed, enabled: previous?.enabled ?? true, installedAt: previous?.installedAt ?? now,
        updatedAt: previous?.revision === installed.revision ? previous.updatedAt : now, lastCheckedAt: now };
      this.#state.skills = [...this.#state.skills.filter((item) => item.id !== id), skill];
      this.#persist(previous?.revision !== installed.revision);
      if (previous?.directory !== skill.directory && previous) void this.#removeUnusedSkill(previous.directory);
      return this.#skillDto(skill);
    })().catch((error) => {
      const skill = this.#state.skills.find((item) => item.id === id);
      if (skill) { skill.error = redactToolErrorSummary(error instanceof Error ? error.message : error); skill.lastCheckedAt = new Date().toISOString(); this.#persist(); }
      throw error;
    }).finally(() => { this.#installing.delete(id); });
    this.#installing.set(id, operation);
    return operation;
  }

  updateSkills(): Promise<void> {
    this.#updatePromise ??= (async () => {
      const failures: string[] = [];
      for (const skill of [...this.#state.skills]) {
        if (this.#stopping) break;
        try { await this.installSkill(skill.id); } catch { failures.push(skill.name); }
      }
      if (failures.length) throw new HttpError(502, `Could not update: ${failures.join(", ")}. Existing installed versions are retained.`);
    })().finally(() => { this.#updatePromise = undefined; });
    return this.#updatePromise;
  }

  enableSkill(id: string, enabled: boolean): void {
    const skill = this.#state.skills.find((entry) => entry.id === id);
    if (!skill) throw new HttpError(404, "Installed skill not found");
    skill.enabled = enabled;
    this.#persist(true);
  }
  removeSkill(id: string): void {
    const skill = this.#state.skills.find((entry) => entry.id === id);
    if (!skill) throw new HttpError(404, "Installed skill not found");
    this.#state.skills = this.#state.skills.filter((entry) => entry.id !== id);
    this.#persist(true);
    void this.#removeUnusedSkill(skill.directory);
  }
  async #removeUnusedSkill(directory: string): Promise<void> {
    if ((this.#skillRefs.get(directory) ?? 0) > 0 || this.#state.skills.some((skill) => skill.directory === directory)) return;
    const relative = path.relative(path.join(this.rootDir, "skills"), directory);
    if (/^[0-9a-f]{64}$/.test(relative)) await rm(directory, { recursive: true, force: true });
  }

  async commands(): Promise<SkillCommandDto[]> {
    const native = await this.#native();
    return [
      ...this.#state.skills.filter((skill) => skill.enabled).map((skill): SkillCommandDto => ({ name: skill.name, description: skill.description, command: `/skill:${skillCommand(skill.id)}`, source: "managed" })),
      ...native.skills.map((skill): SkillCommandDto => ({ name: skill.name, description: skill.description, command: `/skill:${skill.name}`, source: "native" })),
    ];
  }

  async authorize(body: AuthorizePluginBody): Promise<{ url: string }> {
    const cloudUrl = this.#cloudUrl();
    const account = body.accountId === undefined ? undefined : this.#state.accounts.find((entry) => entry.id === body.accountId);
    if (body.accountId !== undefined && (!account || account.providerId !== body.providerId)) throw new HttpError(404, "Provider account not found");
    for (const [state, entry] of this.#oauth) if (entry.expiresAt < Date.now()) this.#oauth.delete(state);
    const localState = randomBytes(32).toString("base64url");
    const verifier = randomBytes(32).toString("base64url");
    const callback = new URL("/api/plugins/oauth/callback", body.returnUrl);
    const result = z.object({ url: z.string().url() }).parse(await this.#cloud(cloudUrl, "oauth/start", { providerId: body.providerId, callbackUrl: callback.href,
      localState, challenge: createHash("sha256").update(verifier).digest("base64url") }));
    if (new URL(result.url).origin !== new URL(PLUGIN_PROVIDERS[body.providerId].authorizeUrl).origin) throw new HttpError(502, "Publisher returned an unexpected authorization origin");
    const brokerState = new URL(result.url).searchParams.get("state");
    if (!brokerState) throw new HttpError(502, "Publisher authorization did not include its transaction binding");
    this.#oauth.set(localState, { providerId: body.providerId, verifier, brokerState, cloudUrl, returnUrl: new URL(body.returnUrl).origin, expiresAt: Date.now() + 15 * 60_000,
      ...(body.accountId === undefined ? {} : { accountId: body.accountId }) });
    return result;
  }

  async finishAuthorization(url: URL): Promise<{ returnUrl: string; label: string }> {
    const state = url.searchParams.get("state") ?? "";
    const pending = this.#oauth.get(state);
    if (!pending || pending.expiresAt < Date.now()) throw new HttpError(400, "Authorization state is missing, expired, or already used. Start again from Plugins.");
    this.#oauth.delete(state);
    const code = url.searchParams.get("code");
    const brokerState = url.searchParams.get("brokerState");
    if (url.searchParams.has("error") || !code || !brokerState) throw new HttpError(400, "Authorization was not granted");
    if (brokerState !== pending.brokerState) throw new HttpError(400, "Authorization callback belongs to a different publisher transaction");
    const tokens = TokenResponse.parse(await this.#cloud(pending.cloudUrl, "oauth/token", { grantType: "authorization_code", code, state: brokerState, verifier: pending.verifier }));
    const metadata: Record<string, unknown> = {};
    for (const key of ["identity", "user_id", "workspace_id", "email_domain", "team_id", "data"]) {
      if (tokens[key] !== undefined) metadata[key] = tokens[key];
    }
    const grant: Grant = { generation: randomUUID(), accessToken: tokens.access_token, scopes: (tokens.scope ?? "").split(/[\s,]+/).filter(Boolean), cloudUrl: pending.cloudUrl, metadata,
      ...(tokens.refresh_token === undefined ? {} : { refreshToken: tokens.refresh_token }), ...(tokens.expires_in === undefined ? {} : { expiresAt: Date.now() + tokens.expires_in * 1000 }) };
    const identity = await this.#identify(pending.providerId, grant);
    const previous = pending.accountId === undefined ? undefined : this.#state.accounts.find((account) => account.id === pending.accountId);
    if (pending.accountId !== undefined && !previous) throw new HttpError(409, "Account was removed during authorization");
    if (previous && previous.identity !== identity.identity) throw new HttpError(409, "A different provider identity was authorized. Use Add account instead of reconnecting this account.");
    if (!grant.refreshToken && previous?.status === "connected" && previous.grant.cloudUrl === grant.cloudUrl && previous.grant.refreshToken) {
      grant.refreshToken = previous.grant.refreshToken;
    }
    const services = PLUGIN_PROVIDERS[pending.providerId].services.filter((service) => hasScopes(grant, service)).map((service) => service.id);
    const account: Account = { id: previous?.id ?? `account_${randomUUID().replace(/-/g, "")}`, providerId: pending.providerId,
      label: previous?.label ?? identity.label, identity: identity.identity, enabledServices: previous ? previous.enabledServices.filter((id) => services.includes(id)) : services,
      status: "connected", grant };
    this.#state.accounts = [...this.#state.accounts.filter((item) => item.id !== account.id), account];
    this.#persist(true);
    return { returnUrl: pending.returnUrl, label: account.label };
  }

  labelAccount(id: string, label: string): void {
    const account = this.#state.accounts.find((entry) => entry.id === id);
    if (!account) throw new HttpError(404, "Provider account not found");
    account.label = label;
    this.#persist(true);
  }
  enableService(id: string, serviceId: string, enabled: boolean): PluginAccountDto {
    const account = this.#state.accounts.find((entry) => entry.id === id);
    if (!account) throw new HttpError(404, "Provider account not found");
    const service = PLUGIN_PROVIDERS[account.providerId].services.find((entry) => entry.id === serviceId);
    if (!service) throw new HttpError(404, "Service is not part of this provider account");
    if (enabled && (account.status === "reauthorize" || !hasScopes(account.grant, service))) throw new HttpError(409, "This service needs additional consent. Reconnect the account to request the supported provider permission group.");
    account.enabledServices = enabled ? [...new Set([...account.enabledServices, serviceId])] : account.enabledServices.filter((entry) => entry !== serviceId);
    this.#persist(true);
    return this.#accountDto(account);
  }
  disconnectAccount(id: string): void {
    if (!this.#state.accounts.some((entry) => entry.id === id)) throw new HttpError(404, "Provider account not found");
    this.#state.accounts = this.#state.accounts.filter((entry) => entry.id !== id);
    this.#persist(true);
  }

  async #token(providerId: PluginProviderId, grant: Grant, force = false): Promise<string> {
    const refreshing = this.#refreshing.get(grant);
    if (refreshing) return refreshing;
    if (!force && (grant.expiresAt === undefined || grant.expiresAt > Date.now() + 60_000)) return grant.accessToken;
    const refresh = (async () => {
      try {
        if (!grant.refreshToken) throw new HttpError(401, "Access expired or was revoked; reconnect this provider account");
        const replacement = TokenResponse.parse(await this.#cloud(grant.cloudUrl, "oauth/token", { grantType: "refresh_token", providerId, refreshToken: grant.refreshToken }));
        grant.accessToken = replacement.access_token;
        if (replacement.refresh_token !== undefined) grant.refreshToken = replacement.refresh_token;
        if (replacement.expires_in === undefined) delete grant.expiresAt;
        else grant.expiresAt = Date.now() + replacement.expires_in * 1000;
        if (replacement.scope !== undefined) grant.scopes = replacement.scope.split(/[\s,]+/).filter(Boolean);
        if (this.#state.accounts.some((account) => account.grant === grant)) this.#persist();
        return grant.accessToken;
      } catch (error) {
        if (error instanceof HttpError && error.status === 401) {
          const account = this.#state.accounts.find((entry) => entry.grant === grant);
          if (account) { account.status = "reauthorize"; account.error = "Provider authorization expired or was revoked. Reconnect this account."; this.#persist(); }
        }
        throw error;
      }
    })().finally(() => { this.#refreshing.delete(grant); });
    this.#refreshing.set(grant, refresh);
    return refresh;
  }

  #authenticatedFetch(providerId: PluginProviderId, grant: Grant): FetchLike {
    return async (input, init) => {
      const token = await this.#token(providerId, grant);
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${token}`);
      let response = await fetch(input, { ...init, headers, redirect: "manual" });
      if (response.status === 401) {
        await response.body?.cancel();
        const refreshed = grant.accessToken === token ? await this.#token(providerId, grant, true) : grant.accessToken;
        headers.set("authorization", `Bearer ${refreshed}`);
        response = await fetch(input, { ...init, headers, redirect: "manual" });
        if (response.status === 401) {
          const account = this.#state.accounts.find((entry) => entry.grant === grant);
          if (account) {
            account.status = "reauthorize";
            account.error = "Provider rejected refreshed authorization. Reconnect this account.";
            this.#persist();
          }
        }
      }
      return response;
    };
  }

  async #identify(providerId: PluginProviderId, grant: Grant): Promise<{ identity: string; label: string }> {
    const fetchWithAccount = this.#authenticatedFetch(providerId, grant);
    const json = async (url: string, init?: RequestInit): Promise<Record<string, unknown>> => {
      const response = await fetchWithAccount(url, { ...init, signal: AbortSignal.timeout(30_000), headers: { "content-type": "application/json", accept: "application/json", ...init?.headers } });
      if (!response.ok) throw new HttpError(502, `${PLUGIN_PROVIDERS[providerId].name} identity lookup returned HTTP ${response.status}`);
      return z.record(z.unknown()).parse(await response.json());
    };
    let id: unknown;
    let label: unknown;
    switch (providerId) {
      case "google": {
        const user = await json("https://openidconnect.googleapis.com/v1/userinfo");
        const claims = z.object({ subject: z.string() }).safeParse(grant.metadata.identity);
        if (!claims.success || claims.data.subject !== user.sub) throw new HttpError(401, "Google access token and verified identity do not match");
        id = user.sub; label = user.email ?? user.name; break;
      }
      case "microsoft": {
        const user = await json("https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName");
        const claims = z.object({ tenantId: z.string(), userId: z.string() }).safeParse(grant.metadata.identity);
        if (!claims.success || claims.data.userId !== user.id) throw new HttpError(401, "Microsoft token identity did not match its directory context");
        id = `${claims.data.tenantId}:${user.id}`; label = user.mail ?? user.userPrincipalName ?? user.displayName; break;
      }
      case "github": { const user = await json("https://api.github.com/user"); id = user.id; label = user.login; break; }
      case "linear": {
        const result = z.object({ data: z.object({ viewer: z.object({ id: ProviderIdentityId, name: z.string() }) }) }).parse(await json("https://api.linear.app/graphql", { method: "POST", body: JSON.stringify({ query: "{ viewer { id name } }" }) }));
        id = result.data.viewer.id; label = result.data.viewer.name; break;
      }
      case "dropbox": {
        const user = z.object({ account_id: z.string(), email: z.string().optional(), name: z.object({ display_name: z.string() }).optional() }).parse(await json("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", body: "null" }));
        id = user.account_id; label = user.email ?? user.name?.display_name; break;
      }
      case "intercom": {
        const user = z.object({ id: ProviderIdentityId, email: z.string().nullish(), name: z.string().nullish(), app: z.object({ id_code: z.string(), name: z.string().optional(), region: z.string().optional() }) }).parse(await json("https://api.intercom.io/me"));
        if (user.app.region === "AU") throw new HttpError(409, "Intercom MCP does not support Australian workspaces");
        id = `${user.app.id_code}:${user.id}`; label = user.email ? `${user.email} · ${user.app.name ?? user.app.id_code}` : user.name; grant.metadata.region = user.app.region; break;
      }
      case "miro": {
        const user = z.object({ user: z.object({ id: ProviderIdentityId, name: z.string().optional() }).optional(), team: z.object({ id: ProviderIdentityId, name: z.string().optional() }).optional() }).parse(await json("https://api.miro.com/v1/oauth-token"));
        const userId = ProviderIdentityId.parse(user.user?.id ?? grant.metadata.user_id);
        const teamId = ProviderIdentityId.parse(user.team?.id ?? grant.metadata.team_id);
        id = `${teamId}:${userId}`; label = [user.user?.name, user.team?.name].filter(Boolean).join(" · "); break;
      }
      case "notion": {
        if (typeof grant.metadata.user_id === "string" && typeof grant.metadata.workspace_id === "string") id = `${grant.metadata.workspace_id}:${grant.metadata.user_id}`;
        label = `${grant.metadata.email_domain ?? "Notion"} · ${grant.metadata.workspace_id ?? ""}`; break;
      }
      case "asana": {
        const data = z.object({ gid: ProviderIdentityId.optional(), id: ProviderIdentityId.optional(), email: z.string().optional(), name: z.string().optional() }).parse(grant.metadata.data);
        id = data.gid ?? data.id; label = data.email ?? data.name; break;
      }
      case "hubspot": {
        const connection = await connectMcp({ type: "http", url: PLUGIN_PROVIDERS.hubspot.services[0]!.mcpUrl! }, this.cwd, fetchWithAccount);
        try {
          const result = await connection.client.callTool({ name: "get_user_details", arguments: {} }, undefined, { timeout: 30_000 });
          if (result.isError) throw new HttpError(502, "HubSpot could not return its authenticated user details");
          const text = (result.content as { type: string; text?: string }[]).filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
          const user = z.record(z.unknown()).parse(result.structuredContent ?? JSON.parse(text));
          const details = z.record(z.unknown()).parse(user.data ?? user);
          const userId = ProviderIdentityId.parse(details.userId ?? details.user_id);
          const hubId = ProviderIdentityId.parse(details.hubId ?? details.hub_id ?? details.portalId);
          id = `${hubId}:${userId}`;
          label = details.email ?? details.userEmail;
        } finally { await connection.close(); }
        break;
      }
    }
    if ((typeof id !== "string" && typeof id !== "number") || !String(id)) throw new HttpError(502, `${PLUGIN_PROVIDERS[providerId].name} did not return a stable authorized account identity`);
    return { identity: `${providerId}:${id}`, label: typeof label === "string" && label.trim() ? label.trim() : `${PLUGIN_PROVIDERS[providerId].name} · ${id}` };
  }

  async #apiCall(providerId: PluginProviderId, grant: Grant, service: PluginServiceDefinition, input: Record<string, unknown>, signal: AbortSignal): Promise<AgentPluginToolOutput> {
    const args = ApiArguments.parse(input);
    const api = service.api!;
    if (!args.path.startsWith("/") || args.path.startsWith("//") || args.path.includes("\\")) throw new Error("Use a provider-relative API path");
    const url = new URL(args.path, api.baseUrl);
    const decoded = decodeURIComponent(url.pathname);
    if (url.origin !== api.baseUrl || url.username || url.password || url.hash || decoded.split("/").includes("..")
      || !api.pathPrefixes.some((prefix) => decoded === prefix || decoded.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))) throw new Error("API path is outside this service card");
    for (const [key, value] of Object.entries(args.query ?? {})) url.searchParams.set(key, String(value));
    if (!hasScopes(grant, service)) throw new Error("Provider grant no longer includes the permissions required by this service");
    const response = await this.#authenticatedFetch(providerId, grant)(url, {
      method: args.method, signal, headers: { "content-type": args.contentType ?? (args.bodyBase64 === undefined ? "application/json" : "application/octet-stream"), ...(providerId === "microsoft" ? { Prefer: 'IdType="ImmutableId"' } : {}) },
      ...(args.bodyBase64 !== undefined ? { body: Buffer.from(args.bodyBase64, "base64") } : args.body !== undefined ? { body: JSON.stringify(args.body) } : {}),
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location && providerId === "microsoft" && url.pathname.endsWith("/content")) return { content: [{ type: "text", text: JSON.stringify({ status: response.status, downloadUrl: location, note: "Provider-issued preauthenticated download URL; do not attach account credentials." }) }] };
      throw new Error(`Provider returned an unexpected redirect (${response.status})`);
    }
    if (!contentType.includes("json") && !contentType.startsWith("text/") && response.ok && response.status !== 204) {
      const bytes = Buffer.from(await response.arrayBuffer());
      const directory = path.join(this.rootDir, "results");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = path.join(directory, `${randomUUID()}.bin`);
      await writeFile(file, bytes, { mode: 0o600, flag: "wx" });
      return { content: [{ type: "text", text: JSON.stringify({ status: response.status, filePath: file, contentType, bytes: bytes.length }) }] };
    }
    const text = await response.text();
    return { content: [{ type: "text", text: JSON.stringify({ status: response.status, body: contentType.includes("json") && text ? JSON.parse(text) : text,
      ...(response.headers.get("retry-after") ? { retryAfter: response.headers.get("retry-after") } : {}) }) }], ...(response.ok ? {} : { isError: true }) };
  }

  async #toolOutput(result: CallToolResult | AgentPluginToolOutput): Promise<AgentPluginToolOutput> {
    const encoded = JSON.stringify(result);
    if (Buffer.byteLength(encoded) > 2 * 1024 * 1024) {
      const directory = path.join(this.rootDir, "results");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const file = path.join(directory, `${randomUUID()}.json`);
      await writeFile(file, encoded, { mode: 0o600, flag: "wx" });
      return { content: [{ type: "text", text: `Full plugin output saved to ${file}; ${Buffer.byteLength(encoded)} bytes. Read this file for the complete result.` }], ...(result.isError ? { isError: true } : {}) };
    }
    return { content: result.content.map((part) => part.type === "text" ? { type: "text", text: part.text }
      : part.type === "image" ? { type: "image", data: part.data, mimeType: part.mimeType }
      : { type: "text", text: JSON.stringify(part) }), ...(result.isError ? { isError: true } : {}),
      ...(result.structuredContent ? { structuredContent: result.structuredContent } : {}) };
  }

  async acquire(): Promise<PluginLease> {
    if (this.#stopping) throw new Error("Plugin runtime is stopping");
    const snapshot: AgentPluginSnapshot = { revision: this.#state.revision, tools: [], skills: [], diagnostics: [] };
    const calls = new Map<string, (args: Record<string, unknown>, signal: AbortSignal) => Promise<CallToolResult | AgentPluginToolOutput>>();
    const entries = new Set<PoolEntry>();
    const skillDirectories: string[] = [];
    const activeCalls = new Set<AbortController>();
    let released = false;
    let statusChanged = false;
    const accountErrors = new Map<Account, string[]>();
    const release = (): void => {
      if (released) return;
      released = true;
      for (const controller of activeCalls) controller.abort("Plugin turn ended");
      for (const entry of entries) entry.refs--;
      for (const directory of skillDirectories) {
        const count = (this.#skillRefs.get(directory) ?? 1) - 1;
        if (count > 0) this.#skillRefs.set(directory, count); else this.#skillRefs.delete(directory);
        void this.#removeUnusedSkill(directory);
      }
      this.#reap();
    };
    const addMcp = async (key: string, description: string, entry: PoolEntry, onStatus: (error: string | undefined, count: number) => void) => {
      if (!entries.has(entry)) { entry.refs++; entries.add(entry); }
      try {
        const tools = await this.#tools(entry);
        for (const tool of tools) {
          const name = toolName(key, tool.name);
          if (calls.has(name)) throw new Error("MCP server returned duplicate tool names");
          snapshot.tools.push({ ...tool, name, description: `${description}\n${tool.description}` });
          calls.set(name, async (args, signal) => {
            const connection = await entry.promise;
            const result = await connection.client.callTool({ name: tool.name, arguments: args }, undefined, { signal, timeout: 120_000 });
            return result as CallToolResult;
          });
        }
        onStatus(undefined, tools.length);
      } catch (error) {
        const message = redactToolErrorSummary(error instanceof Error ? error.message : error);
        snapshot.diagnostics.push(`${description}: ${message}`);
        onStatus(message, 0);
      }
    };
    try {
    // Capture enabled lists before awaiting any network request. Later mutations cannot alter this turn.
    const skills = this.#state.skills.filter((skill) => skill.enabled);
    const connections = this.#state.mcp.filter((connection) => connection.enabled);
    const services = this.#state.accounts.flatMap((account) => account.status === "connected"
      ? PLUGIN_PROVIDERS[account.providerId].services.filter((service) => account.enabledServices.includes(service.id)).map((service) => ({ account, grant: account.grant, service, label: account.label, identity: account.identity })) : []);
    for (const { account } of services) accountErrors.set(account, []);
    for (const account of this.#state.accounts) {
      if (account.status === "reauthorize" && account.enabledServices.length) snapshot.diagnostics.push(`${account.label} (${account.identity}): provider authorization requires reconnecting.`);
    }
    for (const skill of skills) {
      this.#skillRefs.set(skill.directory, (this.#skillRefs.get(skill.directory) ?? 0) + 1);
      skillDirectories.push(skill.directory);
      snapshot.skills.push({ name: skillCommand(skill.id), filePath: path.join(skill.directory, "SKILL.md") });
    }
    await Promise.all([
      ...connections.map(async (connection) => {
        const key = `${connection.id}:${connection.generation}`;
        const entry = this.#connection(key, () => connectMcp(connection.transport, this.cwd), () => this.#state.mcp.some((item) => item.id === connection.id && item.generation === connection.generation && item.enabled));
        await addMcp(connection.id, `Custom MCP: ${connection.name} (${connection.id})`, entry, (error, count) => {
          if (!this.#state.mcp.includes(connection)) return;
          const status = error ? "error" : "connected";
          if (connection.status !== status || connection.toolCount !== count || connection.error !== error) statusChanged = true;
          connection.status = status; connection.toolCount = count;
          if (error) connection.error = error; else delete connection.error;
        });
      }),
      ...services.map(async ({ account, grant, service, label, identity }) => {
        const key = `${account.id}:${grant.generation}:${service.id}`;
        const description = `${service.name}; account ${label}; provider identity ${identity}; account ID ${account.id}. This tool is bound to that account. Choose accounts based on the user's request; do not assume a default account.`;
        if (!hasScopes(grant, service)) {
          snapshot.diagnostics.push(`${description}: additional consent is required`);
          accountErrors.get(account)!.push(`${service.name}: additional consent is required`);
          return;
        }
        if (service.api) {
          const name = toolName(`${account.id}:${service.id}`, `${service.id}_request`);
          snapshot.tools.push({ name, description: `${description}\n${service.api.instructions}`, inputSchema: API_TOOL_SCHEMA });
          calls.set(name, (args, signal) => this.#apiCall(account.providerId, grant, service, args, signal));
        }
        if (service.mcpUrl) {
          let url = service.mcpUrl;
          if (account.providerId === "intercom" && grant.metadata.region === "EU") url = "https://mcp.eu.intercom.com/mcp";
          const entry = this.#connection(key, () => connectMcp({ type: "http", url }, this.cwd, this.#authenticatedFetch(account.providerId, grant)),
            () => this.#state.accounts.some((item) => item.id === account.id && item.grant === grant && item.enabledServices.includes(service.id)));
          await addMcp(`${account.id}:${service.id}`, description, entry, (error) => {
            if (error) accountErrors.get(account)!.push(`${service.name}: ${error}`);
          });
        }
      }),
    ]);
    for (const [account, errors] of accountErrors) {
      if (!this.#state.accounts.includes(account) || account.status === "reauthorize") continue;
      const error = errors.length ? errors.join("; ") : undefined;
      if (account.error !== error) statusChanged = true;
      if (error) account.error = error; else delete account.error;
    }
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 3 * 1024 * 1024) throw new HttpError(413, "Enabled plugin schemas exceed the worker protocol frame limit. Disable an oversized connection.");
    if (statusChanged) this.#persist();
    return {
      snapshot,
      call: async (name, args, signal) => {
        if (released) throw new Error("Plugin turn snapshot was released");
        const call = calls.get(name);
        if (!call) throw new Error("Plugin tool does not belong to this turn snapshot");
        const controller = new AbortController();
        activeCalls.add(controller);
        try { return await this.#toolOutput(await call(args, AbortSignal.any([signal, controller.signal]))); }
        finally { activeCalls.delete(controller); }
      },
      release,
    };
    } catch (error) {
      release();
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    this.#stopping = true;
    clearInterval(this.#timer);
    this.#oauth.clear();
    await Promise.allSettled(this.#installing.values());
    await Promise.allSettled([...this.#pool.values()].map(async (entry) => (await entry.promise).close()));
    this.#pool.clear();
  }
}
