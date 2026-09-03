import { defineTool } from "@earendil-works/pi-coding-agent";
import type {
  AgentComputerToolContext,
  AgentComputerToolOutput,
  AgentComputerTurnContext,
} from "@omarchy-bot/agent-contract";
import type { ComputerAction } from "@omarchy-bot/domain";
import { Type } from "typebox";

const COMPUTER_ACTION = Type.Union([
  Type.Literal("observe"),
  Type.Literal("screenshot"),
  Type.Literal("list_windows"),
  Type.Literal("focus_window"),
  Type.Literal("click"),
  Type.Literal("type"),
  Type.Literal("key"),
  Type.Literal("scroll"),
  Type.Literal("open_app"),
  Type.Literal("open_url"),
  Type.Literal("notify"),
]);

export interface PiComputerBridge {
  request(
    context: AgentComputerToolContext,
    action: ComputerAction,
    signal: AbortSignal | undefined,
  ): Promise<AgentComputerToolOutput>;
}

export function createComputerTool(
  turnContext: () => AgentComputerTurnContext | undefined,
  bridge: PiComputerBridge,
) {
  return defineTool({
    name: "computer",
    label: "Computer",
    description:
      "Observe or operate this Bot's own Bot Screen. All actions are routed by Omarchy through the owning Computer Surface. Pass action-specific values in args.",
    promptSnippet: "Observe and operate this Bot's own visible Bot Screen.",
    promptGuidelines: [
      "Use the computer tool only for visible desktop interaction on this Bot's Screen.",
      "Observe before coordinate-sensitive input and after an action when visual confirmation matters.",
    ],
    parameters: Type.Object({
      action: COMPUTER_ACTION,
      args: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    }),
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const active = turnContext();
      if (active === undefined) {
        throw new Error("computer tool has no active Omarchy turn binding");
      }
      signal?.throwIfAborted();
      const output = await bridge.request(
        { ...active, toolCallId },
        { name: params.action, args: params.args ?? {} },
        signal,
      );
      signal?.throwIfAborted();
      const summary: string[] = [];
      if (output.text !== undefined) summary.push(output.text);
      if (output.imageRef !== undefined) {
        summary.push(`Bot Screen snapshot artifact: ${output.imageRef}`);
      }
      if (output.windowList !== undefined) {
        summary.push(`Windows: ${JSON.stringify(output.windowList)}`);
      }
      if (summary.length === 0) summary.push("Bot Screen action completed.");
      const content: Array<
        { type: "text"; text: string }
        | { type: "image"; data: string; mimeType: string }
      > = [{ type: "text", text: summary.join("\n") }];
      if (output.imageFile !== undefined) {
        const bytes = await Bun.file(output.imageFile.path).arrayBuffer();
        content.push({
          type: "image",
          data: Buffer.from(bytes).toString("base64"),
          mimeType: output.imageFile.mediaType,
        });
      }
      const { imageFile: _imageFile, ...details } = output;
      return { content, details };
    },
  });
}
