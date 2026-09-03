import { isInputAction, type ComputerActionName } from "@omarchy-bot/domain";

/** Defense in depth: input actions need a lease token even if the daemon is the authority. */
export function assertInputLease(name: string, leaseToken?: string): void {
  if (isInputAction(name as ComputerActionName) && !leaseToken) {
    throw new Error("input action refused: no lease token provided");
  }
}
