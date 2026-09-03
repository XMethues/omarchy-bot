import { isInputAction, type ComputerActionName } from "@omarchy-bot/domain";

/** Defense in depth: every desktop-mutating action requires daemon-issued input authority. */
export function assertInputLease(name: string, leaseToken?: string): void {
  if (isInputAction(name as ComputerActionName) && !leaseToken) {
    throw new Error("input action refused: no lease token provided");
  }
}
