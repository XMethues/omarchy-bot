import { describe, expect, test } from "bun:test";
import { assertTransitionTurn, assertTurnTerminalOnce, canTransitionTurn, isTerminalTurn } from "./turn.ts";
import { isInputAction } from "./computer.ts";
import { isBotId, isSurfaceId } from "./ids.ts";

describe("turn state machine", () => {
  test("working turns settle directly without intermediate waiting states", () => {
    expect(canTransitionTurn("working", "completed")).toBeTrue();
    expect(canTransitionTurn("working", "cancelled")).toBeTrue();
    expect(canTransitionTurn("working", "failed")).toBeTrue();
  });
  test("terminals are absorbing", () => {
    for (const t of ["completed", "cancelled", "failed"] as const) {
      expect(isTerminalTurn(t)).toBeTrue();
      expect(canTransitionTurn(t, "working")).toBeFalse();
    }
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
