import { describe, expect, test } from "bun:test";
import { assertRunTerminalOnce, assertTransitionTask, canTransitionTask, isTerminalTask } from "./task.ts";
import { isInputAction, isSensitiveAction, leaseExpired } from "./computer.ts";

describe("task state machine", () => {
  test("happy path", () => {
    expect(canTransitionTask("queued", "working")).toBeTrue();
    expect(canTransitionTask("working", "waiting_for_approval")).toBeTrue();
    expect(canTransitionTask("waiting_for_approval", "working")).toBeTrue();
    expect(canTransitionTask("working", "completed")).toBeTrue();
  });
  test("terminals are absorbing", () => {
    for (const t of ["completed", "cancelled", "failed"] as const) {
      expect(isTerminalTask(t)).toBeTrue();
      expect(canTransitionTask(t, "working")).toBeFalse();
    }
  });
  test("illegal transitions throw", () => {
    expect(() => assertTransitionTask("queued", "completed")).toThrow();
    expect(() => assertTransitionTask("waiting_for_input", "completed")).toThrow();
  });
  test("run terminal only once", () => {
    expect(() => assertRunTerminalOnce("completed", "failed")).toThrow();
    expect(() => assertRunTerminalOnce(undefined, "completed")).not.toThrow();
  });
});

describe("computer actions", () => {
  test("input vs observation", () => {
    expect(isInputAction("click")).toBeTrue();
    expect(isInputAction("screenshot")).toBeFalse();
    expect(isSensitiveAction("open_url")).toBeTrue();
    expect(isSensitiveAction("click")).toBeFalse();
  });
  test("lease expiry", () => {
    const lease = { holder: "human" as const, acquiredAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-01T00:01:00Z" };
    expect(leaseExpired(lease, new Date("2026-01-01T00:02:00Z"))).toBeTrue();
    expect(leaseExpired(lease, new Date("2026-01-01T00:00:30Z"))).toBeFalse();
  });
});
