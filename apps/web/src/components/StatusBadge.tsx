import { Badge } from "@astryxdesign/core/Badge";

const VARIANTS: Record<string, "neutral" | "info" | "success" | "warning" | "error"> = {
  ready: "success",
  working: "info",
  checking: "info",
  waiting_for_input: "warning",
  waiting_for_approval: "warning",
  waiting_for_computer: "warning",
  blocked: "error",
  incompatible: "error",
  unconfigured: "neutral",
  missing: "neutral",
  offline: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  const variant = VARIANTS[status] ?? "neutral";
  return <Badge variant={variant} label={status.replaceAll("_", " ")} />;
}

export const TASK_STATUS_VARIANT: Record<string, "neutral" | "info" | "success" | "warning" | "error"> = {
  queued: "neutral",
  working: "info",
  waiting_for_input: "warning",
  waiting_for_approval: "warning",
  waiting_for_computer: "warning",
  blocked: "error",
  completed: "success",
  cancelled: "neutral",
  failed: "error",
};
