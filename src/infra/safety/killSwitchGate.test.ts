import { describe, expect, test, beforeEach } from "bun:test";
import { resetAllKillSwitches, tripKillSwitch } from "./killSwitches.ts";
import { checkKillSwitchForOrder } from "./killSwitchGate.ts";

describe("checkKillSwitchForOrder", () => {
  beforeEach(() => resetAllKillSwitches());

  test("passes when no switches tripped", () => {
    const result = checkKillSwitchForOrder(
      { userId: "u1" },
      { instrument: "BTCUSDT", venue: "binance" },
    );
    expect(result.blocked).toBe(false);
  });

  test("blocks on firm-wide trip", () => {
    tripKillSwitch({ scope: "firm" }, "halt");
    const result = checkKillSwitchForOrder(
      { userId: "u1" },
      { instrument: "BTCUSDT", strategyId: "bounce", venue: "binance" },
    );
    expect(result.blocked).toBe(true);
    if (result.blocked) {
      expect(result.error).toContain("tripped");
      expect(result.payload.allowed).toBe(false);
    }
  });
});
