import { describe, expect, test } from "bun:test";
import { assertTransitionTurn, assertTurnTerminalOnce, canTransitionTurn, isTerminalTurn } from "./turn.ts";
import { isInputAction, leaseExpired } from "./computer.ts";
import { isBotId, isSurfaceId, type SurfaceId } from "./ids.ts";

describe("turn state machine", () => {
  test("working can pause for current input and computer states before completion", () => {
    expect(canTransitionTurn("working", "waiting_for_input")).toBeTrue();
    expect(canTransitionTurn("waiting_for_input", "working")).toBeTrue();
    expect(canTransitionTurn("working", "waiting_for_computer")).toBeTrue();
    expect(canTransitionTurn("waiting_for_computer", "working")).toBeTrue();
    expect(canTransitionTurn("working", "completed")).toBeTrue();
  });
  test("terminals are absorbing", () => {
    for (const t of ["completed", "cancelled", "failed"] as const) {
      expect(isTerminalTurn(t)).toBeTrue();
      expect(canTransitionTurn(t, "working")).toBeFalse();
    }
  });
  test("no queued/blocked states remain", () => {
    expect(canTransitionTurn("waiting_for_input", "completed")).toBeFalse();
    expect(() => assertTransitionTurn("waiting_for_input", "completed")).toThrow();
  });
  test("illegal transitions throw", () => {
    expect(() => assertTransitionTurn("completed", "working")).toThrow();
  });
  test("turn terminal only once", () => {
    expect(() => assertTurnTerminalOnce("completed", "failed")).toThrow();
    expect(() => assertTurnTerminalOnce(undefined, "completed")).not.toThrow();
  });
});

describe("computer actions", () => {
  test("input vs observation", () => {
    expect(isInputAction("click")).toBeTrue();
    expect(isInputAction("screenshot")).toBeFalse();
  });
  test("lease expiry", () => {
    const lease = {
      surfaceId: "surf_0123456789abcdef0123456789abcdef" as SurfaceId,
      holder: "human" as const,
      acquiredAt: "2026-01-01T00:00:00Z",
      expiresAt: "2026-01-01T00:01:00Z",
    };
    expect(leaseExpired(lease, new Date("2026-01-01T00:02:00Z"))).toBeTrue();
    expect(leaseExpired(lease, new Date("2026-01-01T00:00:30Z"))).toBeFalse();
  });
});

describe("bot ids", () => {
  test("bot ids never alias agent ids", () => {
    expect(isBotId("bot_0123456789abcdef0123456789abcdef")).toBeTrue();
    expect(isBotId("pi")).toBeFalse();
  });

  test("Surface ids are opaque and distinct from Bot ids", () => {
    expect(isSurfaceId("surf_0123456789abcdef0123456789abcdef")).toBeTrue();
    expect(isSurfaceId("bot_0123456789abcdef0123456789abcdef")).toBeFalse();
  });
});
