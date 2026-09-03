import { describe, expect, test } from "bun:test";
import { isEmergencyControlVisible } from "./emergencyControl.ts";

describe("emergency control visibility", () => {
  test("hidden while the computer is idle or unavailable", () => {
    expect(isEmergencyControlVisible("idle")).toBeFalse();
    expect(isEmergencyControlVisible("unavailable")).toBeFalse();
  });

  test("visible while input is active or stopped", () => {
    expect(isEmergencyControlVisible("bot-using")).toBeTrue();
    expect(isEmergencyControlVisible("waiting")).toBeTrue();
    expect(isEmergencyControlVisible("needs-you")).toBeTrue();
    expect(isEmergencyControlVisible("user-control")).toBeTrue();
    expect(isEmergencyControlVisible("emergency-stopped")).toBeTrue();
  });
});
