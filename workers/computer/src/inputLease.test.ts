import { describe, expect, test } from "bun:test";
import { assertInputLease } from "./inputLease.ts";

describe("computer worker input lease guard", () => {
  test("allows observation-only actions without a lease token", () => {
    expect(() => assertInputLease("observe")).not.toThrow();
    expect(() => assertInputLease("screenshot")).not.toThrow();
    expect(() => assertInputLease("notify")).not.toThrow();
  });

  test("rejects every native desktop mutation without a lease token", () => {
    expect(() => assertInputLease("open_app")).toThrow(/no lease token/);
    expect(() => assertInputLease("open_url")).toThrow(/no lease token/);
    expect(() => assertInputLease("open_url", "lease-token")).not.toThrow();
  });
});
