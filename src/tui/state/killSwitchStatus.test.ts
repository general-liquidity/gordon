import { describe, expect, it } from "bun:test";
import { buildKillSwitchStatus, formatKillSwitchKey } from "./killSwitchStatus.ts";

describe("killSwitchStatus", () => {
  it("formats scoped keys", () => {
    expect(formatKillSwitchKey({ scope: "firm" })).toBe("firm");
    expect(formatKillSwitchKey({ scope: "venue", id: "binance" })).toBe("venue:binance");
  });

  it("summarizes armed state", () => {
    const status = buildKillSwitchStatus({ enabled: true, trips: [] });
    expect(status.halted).toBe(false);
    expect(status.summary).toBe("kill switches armed");
  });

  it("summarizes firm halt loudly", () => {
    const status = buildKillSwitchStatus({
      enabled: true,
      trips: [{ key: { scope: "firm" }, reason: "operator halt", trippedAt: 10 }],
    });
    expect(status.halted).toBe(true);
    expect(status.summary).toBe("HALTED: firm - operator halt");
    expect(status.signature).toContain("firm:10:operator halt");
  });

  it("includes disabled state in the signature", () => {
    const status = buildKillSwitchStatus({ enabled: false, trips: [] });
    expect(status.enabled).toBe(false);
    expect(status.signature).toBe("disabled");
  });
});
