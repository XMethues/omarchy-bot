import { describe, expect, test } from "bun:test";
import { assertInputLease } from "./inputLease.ts";

describe("computer worker input lease guard", () => {
  test("observation does not require a lease token", () => {
    expect(() => assertInputLease("observe")).not.toThrow();
    expect(() => assertInputLease("screenshot")).not.toThrow();
    expect(() => assertInputLease("notify")).not.toThrow();
  });

  test("native extras that change the desktop require a lease token", () => {
    expect(() => assertInputLease("open_app")).toThrow(/no lease token/);
    expect(() => assertInputLease("open_url")).toThrow(/no lease token/);
    expect(() => assertInputLease("open_url", "tok")).not.toThrow();
  });
});
