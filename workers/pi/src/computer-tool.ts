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
      "Observe or operate this Bot's own Bot Screen: an independent, on-demand, private Bot Desktop Session, not the user's Host Session (Omarchy/Hyprland) or another Bot's Screen. Screenshots, input, open_app and open_url target only this desktop. Omarchy supplies the binding; pass action-specific values in args, never a target session.",
    promptSnippet: "Observe and operate this Bot's independent Bot Screen, not the user's Host Session.",
    promptGuidelines: [
      "Session map: your Native Session is conversation memory; the Bot Desktop Session is this Bot's running private graphical environment; a Screen Projection is only a client's view. Resuming a conversation does not restore old windows, and switching or closing a view does not end desktop work.",
      "The computer tool uses a private WAYLAND_DISPLAY managed by Omarchy. Native shell tools are not automatically bound to this display; use computer open_app/open_url for applications on this Screen rather than guessing socket names or routing to the Host Session or another Bot.",
      "Each computer result identifies its botId, surfaceId and runtimeGeneration. The Surface remains the Bot's identity across desktop restarts; a new runtimeGeneration is a new desktop, not a new conversation. Use current observations rather than remembered windows or coordinates.",
      "A gray or blank image describes only this Bot Screen; it does not show that the user's Hyprland desktop or another Bot's Screen is empty. This Bot Desktop Session is not a full Omarchy session and may have no application open. Observe or list_windows, then open the needed application here when appropriate.",
      "Observe before coordinate-sensitive input and after an action when visual confirmation matters. Mismatched bindings or unavailable input authority reject actions; they do not fall back to the Host Session. Shared files and native Agent capabilities are unchanged; this is not a security sandbox.",
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
      const summary: string[] = [
        `Bot Desktop Session: ${JSON.stringify(output.desktopSession)}`,
      ];
      if (output.text !== undefined) summary.push(output.text);
      if (output.imageRef !== undefined) {
        summary.push(`Bot Screen snapshot artifact: ${output.imageRef}`);
      }
      if (output.windowList !== undefined) {
        summary.push(`Windows: ${JSON.stringify(output.windowList)}`);
      }
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
