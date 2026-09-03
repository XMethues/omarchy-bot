
export type ComputerActionName =
  | "observe"
  | "screenshot"
  | "list_windows"
  | "focus_window"
  | "click"
  | "type"
  | "key"
  | "scroll"
  | "open_app"
  | "open_url"
  | "notify";

export interface ComputerAction {
  name: ComputerActionName;
  args: Record<string, unknown>;
}

/** Input actions require explicit Bot Screen input authority. */
export const INPUT_ACTIONS: readonly ComputerActionName[] = [
  "focus_window",
  "click",
  "type",
  "key",
  "scroll",
  "open_app",
  "open_url",
];

export function isInputAction(name: ComputerActionName): boolean {
  return INPUT_ACTIONS.includes(name);
}

