import { z } from "zod";

export const PluginProviderId = z.enum([
  "google", "microsoft", "notion", "github", "linear", "asana", "dropbox", "hubspot", "intercom", "miro",
]);
export type PluginProviderId = z.infer<typeof PluginProviderId>;

export interface PluginServiceDto {
  id: string;
  name: string;
  description: string;
}

export interface PluginProviderDto {
  id: PluginProviderId;
  name: string;
  services: PluginServiceDto[];
  mode: "mcp" | "api";
  /** A publisher configuration or provider access prerequisite, not a connected state. */
  setupReason?: string;
  documentationUrl: string;
}

export interface PluginAccountDto {
  id: string;
  providerId: PluginProviderId;
  label: string;
  identity: string;
  enabledServices: string[];
  grantedScopes: string[];
  status: "connected" | "reauthorize";
  error?: string;
}

export const McpTransport = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stdio"),
    command: z.string().trim().min(1).max(4096),
    args: z.array(z.string()).max(128).default([]),
    env: z.record(z.string()).optional(),
  }).strict(),
  z.object({
    type: z.literal("http"),
    url: z.string().url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "Use an HTTP or HTTPS URL"),
    headers: z.record(z.string()).optional(),
  }).strict(),
]);
export type McpTransport = z.infer<typeof McpTransport>;

export const SaveMcpBody = z.object({
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  transport: McpTransport,
}).strict();
export type SaveMcpBody = z.input<typeof SaveMcpBody>;

/** Credential values are never projected back to the client. */
export interface McpConnectionDto {
  id: string;
  name: string;
  enabled: boolean;
  transport: { type: "stdio"; command: string; args: string[]; envKeys: string[] }
    | { type: "http"; url: string; headerKeys: string[] };
  status: "unchecked" | "connected" | "error";
  toolCount: number;
  error?: string;
}

export interface CatalogSkillDto {
  id: string;
  name: string;
  sourceType: "github" | "well-known";
  installUrl: string;
  description: string;
  source: string;
  installs?: number;
}
export interface CatalogSkillDetailDto extends CatalogSkillDto {
  content: string;
  url: string;
}
export interface SkillCatalogDto {
  skills: CatalogSkillDto[];
  nextCursor?: string;
}
export interface InstalledSkillDto extends CatalogSkillDto {
  enabled: boolean;
  revision: string;
  installedAt: string;
  updatedAt: string;
  lastCheckedAt?: string;
  error?: string;
}
export interface NativeSkillDto {
  name: string;
  description: string;
  path: string;
  agentId: string;
  readOnly: true;
}
export interface PluginStateDto {
  revision: number;
  cloudUrl: string;
  cloudError?: string;
  providers: PluginProviderDto[];
  accounts: PluginAccountDto[];
  mcp: McpConnectionDto[];
  skills: InstalledSkillDto[];
  nativeSkills: NativeSkillDto[];
  nativeError?: string;
}
export interface SkillCommandDto {
  name: string;
  description: string;
  command: string;
  source: "managed" | "native";
}

export const ConfigurePluginsBody = z.object({
  cloudUrl: z.string().url().nullable().refine(
    (value) => value === null || new URL(value).protocol === "https:",
    "The publisher backend must use HTTPS",
  ),
}).strict();
export const PluginEnabledBody = z.object({ enabled: z.boolean() }).strict();
export const InstallSkillBody = z.object({ id: z.string().min(1).max(512) }).strict();
export const PluginAccountBody = z.object({ label: z.string().trim().min(1).max(120) }).strict();
export const PluginServiceBody = z.object({ serviceId: z.string().min(1), enabled: z.boolean() }).strict();
export const AuthorizePluginBody = z.object({
  providerId: PluginProviderId,
  accountId: z.string().optional(),
  /** Browser origin; the route validates it against the request origin. */
  returnUrl: z.string().url(),
}).strict();
export type AuthorizePluginBody = z.infer<typeof AuthorizePluginBody>;
