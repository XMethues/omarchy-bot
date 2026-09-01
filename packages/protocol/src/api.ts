import { z } from "zod";

export const ActorRefSchema = z.object({ botId: z.string(), roleId: z.string() });
export type ActorRefDto = z.infer<typeof ActorRefSchema>;

export const BotDto = z.object({
  id: z.string(),
  displayName: z.string(),
  agentVersion: z.string(),
  status: z.string(),
  defaultCwd: z.string(),
  defaultModel: z.string().optional(),
  permissionPolicy: z.enum(["ask", "trusted"]),
  enabled: z.boolean(),
  reason: z.string().optional(),
});
export type BotDto = z.infer<typeof BotDto>;

export const ThreadDto = z.object({
  id: z.string(),
  kind: z.enum(["direct", "channel"]),
  title: z.string(),
  botId: z.string(),
  roleId: z.string(),
  cwd: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ThreadDto = z.infer<typeof ThreadDto>;

export const AuthorDto = z.union([
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("bot"), botId: z.string(), roleId: z.string() }),
  z.object({ kind: z.literal("system") }),
]);
export type AuthorDto = z.infer<typeof AuthorDto>;

export const MessageDto = z.object({
  id: z.string(),
  threadId: z.string(),
  seq: z.number().int(),
  author: AuthorDto,
  kind: z.enum(["text", "tool", "approval", "task", "event"]),
  text: z.string().optional(),
  payload: z.unknown().optional(),
  createdAt: z.string(),
});
export type MessageDto = z.infer<typeof MessageDto>;

export const TaskDto = z.object({
  id: z.string(),
  threadId: z.string(),
  owner: ActorRefSchema,
  title: z.string(),
  status: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaskDto = z.infer<typeof TaskDto>;

export const ApprovalDto = z.object({
  id: z.string(),
  source: z.enum(["agent", "computer"]),
  runId: z.string().optional(),
  tool: z.string(),
  details: z.unknown(),
  status: z.enum(["pending", "allowed", "denied", "expired"]),
  createdAt: z.string(),
});
export type ApprovalDto = z.infer<typeof ApprovalDto>;

export const ComputerStateDto = z.object({
  lease: z
    .object({
      holder: z.union([ActorRefSchema, z.literal("human")]),
      runId: z.string().optional(),
      acquiredAt: z.string(),
      expiresAt: z.string(),
    })
    .nullable(),
  queueDepth: z.number().int(),
  emergencyStopped: z.boolean(),
  lastImageAt: z.string().optional(),
});
export type ComputerStateDto = z.infer<typeof ComputerStateDto>;

// ----- command bodies -----

export const CreateThreadBody = z.object({
  botId: z.string(),
  roleId: z.string().optional(),
  title: z.string().optional(),
  cwd: z.string().optional(),
});
export const SendMessageBody = z.object({
  text: z.string().min(1),
  clientTag: z.string().optional(),
});
export const RespondApprovalBody = z.object({
  decision: z.boolean(),
  note: z.string().optional(),
});

export type CreateThreadBodyDto = z.infer<typeof CreateThreadBody>;
export type SendMessageBodyDto = z.infer<typeof SendMessageBody>;
export type RespondApprovalBodyDto = z.infer<typeof RespondApprovalBody>;
