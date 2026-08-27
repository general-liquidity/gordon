import { describe, expect, it } from "bun:test";

import type { BacktestTrade } from "../../../backtest/types.ts";
import { formatOperatorReport } from "./operator-report.ts";
import { buildBiasDiagnostics } from "./service.ts";
import { createMockConfig } from "../../../test-utils/mocks.ts";

describe("operator report formatting", () => {
  it("renders structured sections for metrics, tables, gates, diffs, and actions", () => {
    const output = formatOperatorReport({
      title: "Runtime Health",
      status: "warning",
      summary: "One slot is approaching its drawdown limit.",
      metrics: [{ label: "Active Slots", value: "3", tone: "info" }],
      tables: [
        {
          title: "Slots",
          columns: [
            { key: "slot", header: "Slot" },
            { key: "status", header: "Status" },
          ],
          rows: [{ slot: "momentum", status: "running" }],
        },
      ],
      gates: [
        {
          name: "walk_forward",
          status: "warn",
          score: 55,
          detail: "Only 2 windows.",
          blocker: false,
        },
      ],
      diffs: [
        { label: "Win Rate", baseline: "54.0%", current: "49.0%", delta: "-5.0%", status: "worse" },
      ],
      warnings: ["Drawdown has widened over the last 10 trades."],
      actions: [{ label: "Inspect runtime", command: "/runtime health", priority: "now" }],
    });

    expect(output).toContain("=== RUNTIME HEALTH ===");
    expect(output).toContain("Metrics");
    expect(output).toContain("Validation Gates");
    expect(output).toContain("Diffs");
    expect(output).toContain("Next Actions");
    expect(output).toContain("/runtime health");
  });
});

describe("bias diagnostics", () => {
  it("flags weak samples and missing robustness checks as blockers", () => {
    const trades: BacktestTrade[] = [
      {
        id: "t1",
        entryTime: "2026-01-01T00:00:00.000Z",
        exitTime: "2026-01-02T00:00:00.000Z",
        entryPrice: 100,
        exitPrice: 105,
        quantity: 1,
        positionValue: 100,
        side: "LONG",
        pnl: 500,
        pnlPercent: 5,
        fees: 1,
        exitReason: "TP1",
      },
      {
        id: "t2",
        entryTime: "2026-01-03T00:00:00.000Z",
        exitTime: "2026-01-04T00:00:00.000Z",
        entryPrice: 100,
        exitPrice: 104,
        quantity: 1,
        positionValue: 100,
        side: "LONG",
        pnl: 420,
        pnlPercent: 4.2,
        fees: 1,
        exitReason: "TP1",
      },
      {
        id: "t3",
        entryTime: "2026-01-05T00:00:00.000Z",
        exitTime: "2026-01-06T00:00:00.000Z",
        entryPrice: 100,
        exitPrice: 103.8,
        quantity: 1,
        positionValue: 100,
        side: "LONG",
        pnl: 380,
        pnlPercent: 3.8,
        fees: 1,
        exitReason: "TP1",
      },
      {
        id: "t4",
        entryTime: "2026-01-07T00:00:00.000Z",
        exitTime: "2026-01-08T00:00:00.000Z",
        entryPrice: 100,
        exitPrice: 98.8,
        quantity: 1,
        positionValue: 100,
        side: "LONG",
        pnl: -120,
        pnlPercent: -1.2,
        fees: 1,
        exitReason: "STOP",
      },
    ];

    const diagnostics = buildBiasDiagnostics({
      config: createMockConfig(),
      quality: {
        qualityScore: 68,
        coveragePercent: 92,
        expectedCandles: 100,
        actualCandles: 92,
        gapCount: 3,
        duplicateCount: 0,
        stale: false,
        warnings: ["Gaps detected"],
      },
      metrics: {
        totalReturn: 12,
        annualizedReturn: 18,
        cagr: 16,
        maxDrawdown: 14,
        sharpeRatio: 1.1,
        sortinoRatio: 1.4,
        volatility: 20,
        calmarRatio: 0.8,
        totalTrades: 12,
        winningTrades: 7,
        losingTrades: 5,
        winRate: 58.3,
        profitFactor: 1.3,
        averageTrade: 42,
        averageWin: 110,
        averageLoss: -75,
        expectancy: 18,
        maxConsecutiveWins: 3,
        maxConsecutiveLosses: 2,
        initialValue: 10000,
        finalValue: 11200,
        totalPnl: 1200,
        netProfit: 1100,
        totalFees: 100,
        avgTradeDuration: 12,
        maxDrawdownDuration: 9,
      },
      trades,
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-02-01T00:00:00.000Z",
      walkForward: undefined,
      monteCarlo: undefined,
      overfitting: undefined,
    });

    expect(diagnostics.status).toBe("failed");
    expect(diagnostics.blockerCount).toBeGreaterThan(0);
    expect(diagnostics.checks.some((check) => check.name === "sample_size" && check.blocker)).toBe(
      true,
    );
    expect(
      diagnostics.checks.some((check) => check.name === "walk_forward_oos" && check.blocker),
    ).toBe(true);
  });
});
