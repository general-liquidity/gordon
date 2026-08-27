import { describe, expect, it } from "bun:test";
import {
  buildShadowDivergenceReport,
  formatShadowDivergenceReport,
} from "./shadowDivergenceReport.ts";
import { summarizeShadowFills, type ShadowFill } from "./shadowMode.ts";

describe("shadowDivergenceReport", () => {
  it("formats empty report without throwing", () => {
    const report = buildShadowDivergenceReport();
    const text = formatShadowDivergenceReport(report);
    expect(text).toContain("Shadow vs realized");
    expect(report.shadowFillCount).toBe(0);
  });

  it("computes divergence when shadow outperforms", () => {
    const shadow = summarizeShadowFills([
      {
        planId: "p1",
        symbol: "BTC/USD",
        side: "long",
        entryPrice: 100,
        intendedSize: 1,
        strategy: "x",
        stopLoss: null,
        takeProfit: null,
        openedAt: 1,
        closedAt: 2,
        exitPrice: 110,
        pnl: 10,
        pnlFraction: 0.1,
        closeReason: "target",
        status: "closed",
      } satisfies ShadowFill,
    ]);
    expect(shadow.totalPnl).toBe(10);
    const formatted = formatShadowDivergenceReport({
      shadow,
      real: { ...shadow, totalPnl: 5 },
      divergencePnl: 5,
      divergencePnlFraction: 0.05,
      shadowFillCount: 1,
      realOutcomeCount: 1,
    });
    expect(formatted).toContain("Shadow outperformed");
  });
});
