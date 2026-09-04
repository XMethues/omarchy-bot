import { z } from "zod";
import {
  isAgentCapabilityInventory,
  type AgentCapabilityInventory,
} from "@omarchy-bot/agent-contract";
import {
  AGENT_IDS,
  TOOL_CALL_ERROR_SUMMARY_MAX_LENGTH,
  isSurfaceId,
  type SurfaceId,
} from "@omarchy-bot/domain";

// ----- Agents -----

export const AgentStatusSchema = z.enum(["ready", "missing", "unconfigured", "incompatible", "checking", "offline"]);
export type AgentStatusDto = z.infer<typeof AgentStatusSchema>;

const AgentCapabilityInventoryDto = z.custom<AgentCapabilityInventory>(
  isAgentCapabilityInventory,
  "invalid agent capability inventory",
);

export const AgentDto = z.object({
  id: z.enum(AGENT_IDS),
  displayName: z.string(),
  version: z.string(),
  status: AgentStatusSchema,
  reason: z.string().optional(),
  /** Plain-language setup guidance shown when the Agent is not ready. */
  guidance: z.string().optional(),
  capabilities: AgentCapabilityInventoryDto.optional(),
}).superRefine((agent, context) => {
  if (agent.status === "ready" && agent.capabilities === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "ready agents must expose capabilities", path: ["capabilities"] });
  }
  if (agent.status !== "ready" && agent.capabilities !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "non-ready agents cannot expose capabilities", path: ["capabilities"] });
  }
});
export type AgentDto = z.infer<typeof AgentDto>;

// ----- Avatars -----
export const AVATAR_RENDERER_ID = "dicebear-core@10.7.0+styles@10.6.0" as const;
export const AVATAR_STYLE_IDS = [
  "clay",
  "critters",
  "gaze",
  "initial-face",
  "moods",
  "pixelbot",
  "shapes",
  "sprouts",
  "thumbs",
  "voxel-art",
  "voxel-bot",
] as const;
export const DEFAULT_AVATAR_STYLE_ID = "pixelbot" as const satisfies (typeof AVATAR_STYLE_IDS)[number];


const AvatarOptionValueDto = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

export const AvatarRecipeDto = z.object({
  rendererVersion: z.literal(AVATAR_RENDERER_ID),
  style: z.enum(AVATAR_STYLE_IDS),
  seed: z.string(),
  options: z.record(AvatarOptionValueDto),
});
export type AvatarRecipeDto = z.infer<typeof AvatarRecipeDto>;

export const AvatarDto = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["generated", "recipe"]), recipe: AvatarRecipeDto }),
  z.object({ kind: z.literal("upload"), url: z.string() }),
]);
export type AvatarDto = z.infer<typeof AvatarDto>;


export const SurfaceIdDto = z.custom<SurfaceId>(
  (value) => typeof value === "string" && isSurfaceId(value),
  "invalid Computer Surface id",
);
// ----- Bots -----

export const BotDto = z.object({
  id: z.string(),
  surfaceId: SurfaceIdDto,
  name: z.string(),
  instructions: z.string(),
  agentId: z.enum(AGENT_IDS),
  avatar: AvatarDto,
  pinned: z.boolean(),
  showToolCalls: z.boolean(),
  showThinking: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BotDto = z.infer<typeof BotDto>;

export const ThinkingAvailabilitySchema = z.enum(["supported", "history", "unavailable"]);
export type ThinkingAvailabilityDto = z.infer<typeof ThinkingAvailabilitySchema>;

export const BotUpdatedEventPayload = z.object({
  name: z.string(),
  instructions: z.string(),
  showToolCalls: z.boolean(),
  showThinking: z.boolean(),
});
export type BotUpdatedEventPayload = z.infer<typeof BotUpdatedEventPayload>;

export const BotActivityStatusSchema = z.enum(["active", "inactive"]);
export type BotActivityStatusDto = z.infer<typeof BotActivityStatusSchema>;

/** Sidebar-facing Bot projection: identity + live activity + preview/unread. */
export const BotViewDto = BotDto.extend({
  status: BotActivityStatusSchema,
  unreadCount: z.number().int().nonnegative(),
  unreadThreadId: z.string().optional(),
  previewText: z.string().optional(),
  previewAt: z.string().optional(),
  lastActivityAt: z.string().optional(),
  /** Derived from current Agent capability and retained Thinking across every Thread. */
  thinkingAvailability: ThinkingAvailabilitySchema,
});
export type BotViewDto = z.infer<typeof BotViewDto>;

// ----- Threads, turns, messages -----

export const TurnStatusSchema = z.enum([
  "working",
  "completed",
  "cancelled",
  "failed",
]);
export type TurnStatusDto = z.infer<typeof TurnStatusSchema>;

export const TurnDto = z.object({
  id: z.string(),
  threadId: z.string(),
  botId: z.string(),
  status: TurnStatusSchema,
  steerCount: z.number().int().nonnegative(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  reason: z.string().optional(),
});

export const BotActivityEventPayload = z.object({
  status: BotActivityStatusSchema,
  threadId: z.string(),
  turnId: z.string(),
});
export type BotActivityEventPayload = z.infer<typeof BotActivityEventPayload>;
export type TurnDto = z.infer<typeof TurnDto>;

export const ThreadDto = z.object({
  id: z.string(),
  botId: z.string(),
  title: z.string(),
  cwd: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  activeTurn: TurnDto.optional(),
  /** Most recently started Turn, retained after it becomes terminal. */
  latestTurn: TurnDto.optional(),
});
export type ThreadDto = z.infer<typeof ThreadDto>;

export const AuthorDto = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user") }),
  z.object({ kind: z.literal("bot") }),
  z.object({ kind: z.literal("system") }),
]);
export type AuthorDto = z.infer<typeof AuthorDto>;

export const AttachmentDto = z.object({
  id: z.string(),
  kind: z.enum(["staged", "managed"]),
  name: z.string(),
  mediaType: z.string(),
  size: z.number().int().nonnegative(),
  /** Present only for managed attachments (/api/attachments/:id). */
  url: z.string().optional(),
});
export type AttachmentDto = z.infer<typeof AttachmentDto>;

export const ResponseStateSchema = z.enum(["streaming", "completed"]);
export type ResponseStateDto = z.infer<typeof ResponseStateSchema>;

export const ResponseBlockDto = z.object({
  blockId: z.string().min(1),
  state: ResponseStateSchema,
  startedAt: z.string(),
  completedAt: z.string().optional(),
}).superRefine((response, context) => {
  if (response.state === "completed" && response.completedAt === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "completed Responses require completedAt", path: ["completedAt"] });
  }
  if (response.state === "streaming" && response.completedAt !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "streaming Responses cannot have completedAt", path: ["completedAt"] });
  }
});
export type ResponseBlockDto = z.infer<typeof ResponseBlockDto>;

export const ThinkingStateSchema = z.enum(["streaming", "completed"]);
export type ThinkingStateDto = z.infer<typeof ThinkingStateSchema>;

export const ThinkingBlockDto = z.object({
  blockId: z.string().min(1),
  state: ThinkingStateSchema,
  startedAt: z.string(),
  completedAt: z.string().optional(),
}).superRefine((thinking, context) => {
  if (thinking.state === "completed" && thinking.completedAt === undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "completed Thinking Blocks require completedAt", path: ["completedAt"] });
  }
  if (thinking.state === "streaming" && thinking.completedAt !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "streaming Thinking Blocks cannot have completedAt", path: ["completedAt"] });
  }
});
export type ThinkingBlockDto = z.infer<typeof ThinkingBlockDto>;

export const ToolCallStatusSchema = z.enum(["running", "completed", "error"]);
export type ToolCallStatusDto = z.infer<typeof ToolCallStatusSchema>;

export const ToolCallSummaryDto = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: ToolCallStatusSchema,
  target: z.string().min(1).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  additions: z.number().int().nonnegative().optional(),
  deletions: z.number().int().nonnegative().optional(),
  errorSummary: z.string().min(1).max(TOOL_CALL_ERROR_SUMMARY_MAX_LENGTH).optional(),
}).strict().superRefine((toolCall, context) => {
  if (toolCall.status !== "error" && toolCall.errorSummary !== undefined) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "only failed Tool Calls carry an error summary",
      path: ["errorSummary"],
    });
  }
});
export type ToolCallSummaryDto = z.infer<typeof ToolCallSummaryDto>;


export const MessageKindSchema = z.enum(["text", "response", "thinking", "tool", "event"]);
export type MessageKindDto = z.infer<typeof MessageKindSchema>;

export const MessageDto = z.object({
  id: z.string(),
  threadId: z.string(),
  seq: z.number().int(),
  author: AuthorDto,
  kind: MessageKindSchema,
  text: z.string().optional(),
  response: ResponseBlockDto.optional(),
  thinking: ThinkingBlockDto.optional(),
  toolCall: ToolCallSummaryDto.optional(),
  attachments: z.array(AttachmentDto).optional(),
  payload: z.unknown().optional(),
  createdAt: z.string(),
}).strict().superRefine((message, context) => {
  if (message.kind === "text") {
    if (message.author.kind === "bot") {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Bot output must use an ordered transcript block", path: ["author"] });
    }
    if (message.text === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "text messages require text content", path: ["text"] });
    }
  } else if (message.author.kind !== "bot") {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "ordered Agent transcript records must be Bot-authored", path: ["author"] });
  }

  if (message.kind === "response") {
    if (message.text === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Responses require text content", path: ["text"] });
    }
    if (message.response === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Responses require lifecycle metadata", path: ["response"] });
    }
  } else if (message.response !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "only Responses carry lifecycle metadata", path: ["response"] });
  }

  if (message.kind === "thinking") {
    if (message.text === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Thinking Blocks require text content", path: ["text"] });
    }
    if (message.thinking === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Thinking Blocks require lifecycle metadata", path: ["thinking"] });
    }
  } else if (message.thinking !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "only Thinking Blocks carry Thinking lifecycle metadata", path: ["thinking"] });
  }

  if (message.kind === "tool") {
    if (message.toolCall === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Tool Calls require a safe summary", path: ["toolCall"] });
    }
  } else if (message.toolCall !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "only Tool Calls carry Tool Call summaries", path: ["toolCall"] });
  }

  if (message.kind === "event") {
    if (message.payload === undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: "Native Events require retained metadata", path: ["payload"] });
    }
  } else if (message.kind !== "text" && message.payload !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "only text records and Native Events carry payloads", path: ["payload"] });
  }

  if (message.kind !== "text" && message.kind !== "response" && message.kind !== "thinking" && message.text !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "this transcript record cannot carry text", path: ["text"] });
  }
  if (message.attachments !== undefined && (message.kind !== "text" || message.author.kind !== "user")) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "only user text messages carry attachments", path: ["attachments"] });
  }
});
export type MessageDto = z.infer<typeof MessageDto>;


// ----- Dictation -----

export const DictationDto = z.object({
  state: z.enum(["unavailable", "idle", "recording", "transcribing"]),
  recordingId: z.string().optional(),
  error: z.string().optional(),
});
export type DictationDto = z.infer<typeof DictationDto>;

export const DictationResultDto = z.object({
  outcome: z.enum(["success", "empty", "timeout", "failure", "unavailable", "cancelled"]),
  text: z.string().optional(),
});
export type DictationResultDto = z.infer<typeof DictationResultDto>;


// ----- Computer -----

export const ComputerViewDto = z.object({
  surfaceId: SurfaceIdDto,
  botId: z.string(),
  state: z.enum(["starting", "ready", "bot-using", "needs-you", "user-control", "unavailable"]),
  takeover: z.enum(["unavailable", "available", "active"]),
  activity: z.string().optional(),
  unavailableReason: z.literal("capacity").optional(),
  capacity: z.object({
    active: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
  }).optional(),
  previewAt: z.string().optional(),
});
export type ComputerViewDto = z.infer<typeof ComputerViewDto>;

export const SCREEN_PROJECTION_PROTOCOL_VERSION = 2 as const;
export const SCREEN_PREVIEW_CHANNEL = "screen.preview.v2" as const;
export const SCREEN_CONTROL_CHANNEL = "screen.control.v2" as const;
export const SCREEN_INPUT_CHANNEL = "screen.input.v2" as const;
export const SCREEN_H264_CLOCK_RATE = 90_000 as const;
export const SCREEN_H264_PROFILE = "42e01f" as const;
export const SCREEN_H264_FMTP =
  `level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=${SCREEN_H264_PROFILE}` as const;

export const ScreenProjectionModeDto = z.enum(["idle", "preview", "expanded"]);
export type ScreenProjectionModeDto = z.infer<typeof ScreenProjectionModeDto>;

export const ScreenProjectionCapabilitiesDto = z.object({
  previewImage: z.object({
    transport: z.literal("data-channel"),
    channel: z.literal(SCREEN_PREVIEW_CHANNEL),
    mediaType: z.literal("image/png"),
  }),
  expandedVideo: z.object({
    transport: z.literal("webrtc-video-track"),
    codec: z.literal("video/H264"),
    profileLevelId: z.literal(SCREEN_H264_PROFILE),
    clockRate: z.literal(SCREEN_H264_CLOCK_RATE),
  }),
  control: z.object({
    transport: z.literal("data-channel"),
    channel: z.literal(SCREEN_CONTROL_CHANNEL),
  }),
  input: z.object({
    transport: z.literal("data-channel"),
    channel: z.literal(SCREEN_INPUT_CHANNEL),
  }),
  snapshotFallback: z.object({
    transport: z.literal("http"),
    mediaType: z.literal("image/png"),
  }),
});
export type ScreenProjectionCapabilitiesDto = z.infer<typeof ScreenProjectionCapabilitiesDto>;

export const ScreenProjectionOfferDto = z.object({
  version: z.literal(SCREEN_PROJECTION_PROTOCOL_VERSION),
  type: z.literal("offer"),
  sdp: z.string().min(1),
  capabilities: ScreenProjectionCapabilitiesDto,
});
export type ScreenProjectionOfferDto = z.infer<typeof ScreenProjectionOfferDto>;

export const ScreenProjectionAnswerDto = z.object({
  version: z.literal(SCREEN_PROJECTION_PROTOCOL_VERSION),
  type: z.literal("answer"),
  sdp: z.string().min(1),
  sessionId: z.string().min(1),
  surfaceId: SurfaceIdDto,
  runtimeGeneration: z.number().int().positive(),
  geometryGeneration: z.number().int().positive(),
  logicalWidth: z.number().int().positive(),
  logicalHeight: z.number().int().positive(),
  videoWidth: z.number().int().positive(),
  videoHeight: z.number().int().positive(),
  scale: z.number().positive(),
  state: z.literal("connecting"),
  capabilities: ScreenProjectionCapabilitiesDto,
  security: z.object({
    authentication: z.literal("none"),
    httpsRequired: z.literal(false),
  }),
  candidates: z.array(z.object({ candidate: z.string(), sdpMid: z.string() })),
});
export type ScreenProjectionAnswerDto = z.infer<typeof ScreenProjectionAnswerDto>;

export const ScreenProjectionControlMessageDto = z.object({
  version: z.literal(SCREEN_PROJECTION_PROTOCOL_VERSION),
  type: z.literal("view"),
  surfaceId: SurfaceIdDto,
  runtimeGeneration: z.number().int().positive(),
  mode: ScreenProjectionModeDto,
});
export type ScreenProjectionControlMessageDto = z.infer<typeof ScreenProjectionControlMessageDto>;

export const ScreenProjectionFailureReasonDto = z.enum([
  "unsupported-h264",
  "missing-first-frame",
  "capture-failed",
  "encoder-failed",
  "transport-failed",
  "decode-failed",
]);
export type ScreenProjectionFailureReasonDto = z.infer<typeof ScreenProjectionFailureReasonDto>;

export const ScreenProjectionBrowserMetricsDto = z.object({
  browserReceives: z.number().int().nonnegative(),
  browserDecodes: z.number().int().nonnegative(),
  browserPaints: z.number().int().nonnegative(),
  decodeDrops: z.number().int().nonnegative(),
  paintDrops: z.number().int().nonnegative(),
  captureToPaintLatencySamples: z.number().int().nonnegative(),
  captureToPaintLatencyTotalMs: z.number().finite().nonnegative(),
  captureToPaintLatencyMaxMs: z.number().finite().nonnegative(),
});
export type ScreenProjectionBrowserMetricsDto = z.infer<typeof ScreenProjectionBrowserMetricsDto>;

export const ScreenProjectionBrowserMetricsMessageDto = z.object({
  version: z.literal(SCREEN_PROJECTION_PROTOCOL_VERSION),
  type: z.literal("browser-metrics"),
  surfaceId: SurfaceIdDto,
  runtimeGeneration: z.number().int().positive(),
  metrics: ScreenProjectionBrowserMetricsDto,
});
export type ScreenProjectionBrowserMetricsMessageDto = z.infer<typeof ScreenProjectionBrowserMetricsMessageDto>;

export const ScreenProjectionClientControlMessageDto = z.discriminatedUnion("type", [
  ScreenProjectionControlMessageDto,
  ScreenProjectionBrowserMetricsMessageDto,
]);
export type ScreenProjectionClientControlMessageDto = z.infer<typeof ScreenProjectionClientControlMessageDto>;

export const ScreenProjectionFailureMessageDto = z.object({
  version: z.literal(SCREEN_PROJECTION_PROTOCOL_VERSION),
  type: z.literal("projection-failure"),
  surfaceId: SurfaceIdDto,
  runtimeGeneration: z.number().int().positive(),
  reason: ScreenProjectionFailureReasonDto,
  snapshotFallback: z.literal(true),
});
export type ScreenProjectionFailureMessageDto = z.infer<typeof ScreenProjectionFailureMessageDto>;

const ScreenInputEnvelopeDto = z.object({
  version: z.literal(SCREEN_PROJECTION_PROTOCOL_VERSION),
  surfaceId: SurfaceIdDto,
  runtimeGeneration: z.number().int().positive(),
  geometryGeneration: z.number().int().positive(),
  controllerEpoch: z.number().int().positive(),
  sequence: z.number().int().positive(),
});

const ScreenPointerPositionDto = {
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative(),
};

export const SCREEN_KEY_CODES = [
  "Escape", "Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6", "Digit7", "Digit8", "Digit9", "Digit0",
  "Minus", "Equal", "Backspace", "Tab",
  "KeyQ", "KeyW", "KeyE", "KeyR", "KeyT", "KeyY", "KeyU", "KeyI", "KeyO", "KeyP", "BracketLeft", "BracketRight",
  "Enter", "ControlLeft",
  "KeyA", "KeyS", "KeyD", "KeyF", "KeyG", "KeyH", "KeyJ", "KeyK", "KeyL", "Semicolon", "Quote", "Backquote",
  "ShiftLeft", "Backslash",
  "KeyZ", "KeyX", "KeyC", "KeyV", "KeyB", "KeyN", "KeyM", "Comma", "Period", "Slash", "ShiftRight",
  "AltLeft", "Space", "CapsLock",
  "F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8", "F9", "F10", "F11", "F12",
  "NumLock", "ScrollLock",
  "Numpad7", "Numpad8", "Numpad9", "NumpadSubtract", "Numpad4", "Numpad5", "Numpad6", "NumpadAdd",
  "Numpad1", "Numpad2", "Numpad3", "Numpad0", "NumpadDecimal", "NumpadEnter", "NumpadDivide", "NumpadMultiply",
  "ControlRight", "AltRight", "Home", "ArrowUp", "PageUp", "ArrowLeft", "ArrowRight", "End", "ArrowDown", "PageDown",
  "Insert", "Delete", "MetaLeft", "MetaRight", "ContextMenu", "PrintScreen", "Pause",
] as const;
export const ScreenKeyCodeDto = z.enum(SCREEN_KEY_CODES);
export type ScreenKeyCodeDto = z.infer<typeof ScreenKeyCodeDto>;

export const ScreenInputMessageDto = z.discriminatedUnion("type", [
  ScreenInputEnvelopeDto.extend({
    type: z.literal("pointer-motion"),
    ...ScreenPointerPositionDto,
  }),
  ScreenInputEnvelopeDto.extend({
    type: z.literal("pointer-button"),
    ...ScreenPointerPositionDto,
    button: z.enum(["left", "middle", "right"]),
    state: z.enum(["pressed", "released"]),
  }),
  ScreenInputEnvelopeDto.extend({
    type: z.literal("pointer-scroll"),
    ...ScreenPointerPositionDto,
    deltaX: z.number().finite(),
    deltaY: z.number().finite(),
  }),
  ScreenInputEnvelopeDto.extend({
    type: z.literal("key"),
    code: ScreenKeyCodeDto,
    state: z.enum(["pressed", "released"]),
    modifiers: z.object({
      control: z.boolean(),
      alt: z.boolean(),
      shift: z.boolean(),
      meta: z.boolean(),
    }),
  }),
  ScreenInputEnvelopeDto.extend({
    type: z.literal("paste"),
    text: z.string().min(1).max(65_536),
  }),
  ScreenInputEnvelopeDto.extend({
    type: z.literal("release-control"),
    reason: z.enum(["blur", "visibility-loss", "navigation", "teardown"]),
  }),
]);
export type ScreenInputMessageDto = z.infer<typeof ScreenInputMessageDto>;

export const ScreenInputAuthorityMessageDto = z.object({
  version: z.literal(SCREEN_PROJECTION_PROTOCOL_VERSION),
  type: z.literal("input-authority"),
  active: z.boolean(),
  surfaceId: SurfaceIdDto,
  runtimeGeneration: z.number().int().positive(),
  geometryGeneration: z.number().int().positive(),
  controllerEpoch: z.number().int().positive(),
  logicalWidth: z.number().int().positive(),
  logicalHeight: z.number().int().positive(),
  videoWidth: z.number().int().positive(),
  videoHeight: z.number().int().positive(),
  scale: z.number().positive(),
});
export type ScreenInputAuthorityMessageDto = z.infer<typeof ScreenInputAuthorityMessageDto>;

export const ScreenProjectionPreviewFrameHeaderDto = z.object({
  version: z.literal(SCREEN_PROJECTION_PROTOCOL_VERSION),
  type: z.literal("preview-frame"),
  surfaceId: SurfaceIdDto,
  runtimeGeneration: z.number().int().positive(),
  geometryGeneration: z.number().int().positive(),
  logicalWidth: z.number().int().positive(),
  logicalHeight: z.number().int().positive(),
  videoWidth: z.number().int().positive(),
  videoHeight: z.number().int().positive(),
  scale: z.number().positive(),
  sequence: z.number().int().positive(),
  mediaType: z.literal("image/png"),
  capturedAt: z.string().optional(),
  byteLength: z.number().int().positive(),
  chunkCount: z.number().int().positive(),
});
export type ScreenProjectionPreviewFrameHeaderDto = z.infer<typeof ScreenProjectionPreviewFrameHeaderDto>;

// ----- command bodies -----

export const CreateBotBody = z.object({
  name: z.string().trim().min(1).max(80),
  instructions: z.string().max(8000).default(""),
  agentId: z.enum(AGENT_IDS),
});
export type CreateBotBodyDto = z.infer<typeof CreateBotBody>;

export const PatchBotBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  instructions: z.string().max(8000).optional(),
  showToolCalls: z.boolean().optional(),
  showThinking: z.boolean().optional(),
});
export type PatchBotBodyDto = z.infer<typeof PatchBotBody>;

export const PinBody = z.object({ pinned: z.boolean() });
export type PinBodyDto = z.infer<typeof PinBody>;

export const DeleteBotBody = z.object({}).strict();
export type DeleteBotBodyDto = z.infer<typeof DeleteBotBody>;

export const DeleteBotFailureDto = z.object({
  stage: z.enum(["turn_cancellation", "terminal_wait", "attachment", "avatar", "surface", "database"]),
  resource: z.string(),
  message: z.string(),
}).strict();
export type DeleteBotFailureDto = z.infer<typeof DeleteBotFailureDto>;

export const DeleteBotResultDto = z.object({
  status: z.enum(["deleted", "failed"]),
  botId: z.string(),
  botName: z.string(),
  removed: z.object({
    threads: z.number().int().nonnegative(),
    messages: z.number().int().nonnegative(),
    turns: z.number().int().nonnegative(),
    attachments: z.number().int().nonnegative(),
    avatar: z.boolean(),
    computerArtifacts: z.number().int().nonnegative(),
    surface: z.boolean(),
  }).strict(),
  failures: z.array(DeleteBotFailureDto),
}).strict();
export type DeleteBotResultDto = z.infer<typeof DeleteBotResultDto>;

export const AvatarRecipeBody = z.object({ prompt: z.string().trim().min(1).max(2000) });
export type AvatarRecipeBodyDto = z.infer<typeof AvatarRecipeBody>;

export const AttachmentDraftToken = z.string().max(128).uuid();
export type AttachmentDraftTokenDto = z.infer<typeof AttachmentDraftToken>;

export const SendMessageBody = z.object({
  text: z.string().refine((t) => t.trim().length >= 1, { message: "text required" }),
  attachmentIds: z.array(z.string()).optional(),
  attachmentDraftToken: AttachmentDraftToken.optional(),
  clientTag: z.string().optional(),
}).superRefine((body, ctx) => {
  if ((body.attachmentIds?.length ?? 0) > 0 && body.attachmentDraftToken === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["attachmentDraftToken"],
      message: "attachmentDraftToken is required when attachmentIds are present",
    });
  }
});
export type SendMessageBodyDto = z.infer<typeof SendMessageBody>;

export const PatchThreadBody = z.object({ title: z.string().trim().min(1).max(120) });
export type PatchThreadBodyDto = z.infer<typeof PatchThreadBody>;


// ----- turn send result -----

export const SendResultDto = z.object({
  threadId: z.string(),
  messageId: z.string(),
  turnId: z.string(),
  action: z.enum(["sent", "steered"]),
});
export type SendResultDto = z.infer<typeof SendResultDto>;
