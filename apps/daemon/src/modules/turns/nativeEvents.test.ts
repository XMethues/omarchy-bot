import { describe, expect, test } from "bun:test";
import { nativeEventClientPayload } from "./nativeEvents.ts";

describe("native event client projection", () => {
  test("secret payloads are redacted", () => {
    expect(
      nativeEventClientPayload({
        type: "native",
        agentId: "pi",
        capability: "auth.token",
        payload: { token: "secret-value" },
        sensitivity: "secret",
      }),
    ).toEqual({ capability: "auth.token", sensitivity: "secret", redacted: true });
  });

  test("public payloads are forwarded", () => {
    expect(
      nativeEventClientPayload({
        type: "native",
        agentId: "pi",
        capability: "progress",
        payload: { step: 1 },
        sensitivity: "public",
      }),
    ).toEqual({ capability: "progress", sensitivity: "public", payload: { step: 1 } });
  });
});
