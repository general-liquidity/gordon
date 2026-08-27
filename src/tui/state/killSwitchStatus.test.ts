import { describe, expect, it } from "bun:test";
import {
  buildKillSwitchStatus,
  formatKillSwitchBadge,
  formatKillSwitchKey,
} from "./killSwitchStatus.ts";

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

  describe("formatKillSwitchBadge", () => {
    it("formats disabled as halt off", () => {
      const badge = formatKillSwitchBadge(buildKillSwitchStatus({ enabled: false, trips: [] }));
      expect(badge).toEqual({ text: "⛉ halt off", severity: "off" });
    });

    it("formats armed with no trips", () => {
      const badge = formatKillSwitchBadge(buildKillSwitchStatus({ enabled: true, trips: [] }));
      expect(badge).toEqual({ text: "⛉ halt armed", severity: "armed" });
    });

    it("formats a single firm trip without a count", () => {
      const badge = formatKillSwitchBadge(
        buildKillSwitchStatus({
          enabled: true,
          trips: [{ key: { scope: "firm" }, reason: "operator halt", trippedAt: 10 }],
        }),
      );
      expect(badge).toEqual({ text: "⛔ HALTED: firm", severity: "halted" });
    });

    it("formats a single scoped trip with its id", () => {
      const badge = formatKillSwitchBadge(
        buildKillSwitchStatus({
          enabled: true,
          trips: [
            { key: { scope: "venue", id: "binance" }, reason: "venue degraded", trippedAt: 20 },
          ],
        }),
      );
      expect(badge).toEqual({ text: "⛔ HALTED: venue:binance", severity: "halted" });
    });

    it("leads with the firm trip and counts the rest", () => {
      const badge = formatKillSwitchBadge(
        buildKillSwitchStatus({
          enabled: true,
          trips: [
            { key: { scope: "venue", id: "binance" }, reason: "venue degraded", trippedAt: 20 },
            { key: { scope: "firm" }, reason: "operator halt", trippedAt: 30 },
            { key: { scope: "instrument", id: "BTC/USDT" }, reason: "vol spike", trippedAt: 40 },
          ],
        }),
      );
      expect(badge).toEqual({ text: "⛔ HALTED: firm +2", severity: "halted" });
    });
  });
});
