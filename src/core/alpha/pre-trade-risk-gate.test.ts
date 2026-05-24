import { describe, expect, test } from "bun:test";
import {
  checkPreTradeRiskGate,
  formatPreTradeRiskGate,
  type TradeProposal,
  type ExistingPosition,
} from "./pre-trade-risk-gate.ts";

function genSeries(seed: number, n = 30): number[] {
  const out: number[] = [];
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out.push(((x / 0x7fffffff) - 0.5) * 0.04);
  }
  return out;
}

function clone(xs: number[]): number[] {
  return [...xs];
}

describe("checkPreTradeRiskGate", () => {
  test("all 4 layers pass → allow", () => {
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.003,
      side: "LONG",
      returnSeries: genSeries(1),
    };
    const existing: ExistingPosition[] = [
      { symbol: "BBB", sector: "energy", exposurePct: 0.003, side: "LONG", returnSeries: genSeries(2) },
    ];
    const pnl = [0.002, -0.001, 0.001, -0.002, 0.001];
    const r = checkPreTradeRiskGate(proposal, existing, pnl);
    expect(r.verdict).toBe("allow");
    expect(r.allowed).toBe(true);
    expect(r.blockingLayer).toBeNull();
  });

  test("position size too large → block_position_size", () => {
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.02, // 2% > 0.5% default cap
      side: "LONG",
      returnSeries: genSeries(1),
    };
    const r = checkPreTradeRiskGate(proposal, [], [0, 0, 0, 0, 0]);
    expect(r.verdict).toBe("block_position_size");
    expect(r.blockingLayer).toBe("position_size");
  });

  test("correlated cluster exceeds cap → block_correlation", () => {
    const sharedSeries = genSeries(42);
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.005,
      side: "LONG",
      returnSeries: clone(sharedSeries), // identical → corr = 1
    };
    const existing: ExistingPosition[] = [
      { symbol: "BBB", sector: "energy", exposurePct: 0.005, side: "LONG", returnSeries: clone(sharedSeries) },
    ];
    const r = checkPreTradeRiskGate(proposal, existing, [0]);
    expect(r.verdict).toBe("block_correlation");
    expect(r.blockingLayer).toBe("correlation");
    const corrLayer = r.layers.find((l) => l.layer === "correlation")!;
    expect((corrLayer.detail as { mostCorrelatedSymbol: string }).mostCorrelatedSymbol).toBe("BBB");
  });

  test("sector aggregate exceeds cap → block_sector", () => {
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.003,
      side: "LONG",
      returnSeries: genSeries(1),
    };
    // 12 small tech positions × 0.0035 = 0.042 + proposed 0.003 = 0.045 > 0.04 sector cap.
    // Each existing exposure 0.0035 keeps cluster (proposed 0.003 + any existing 0.0035 = 0.0065)
    // under the 0.0075 default cluster cap regardless of correlation, so the only
    // layer that fails is sector aggregate.
    const existing: ExistingPosition[] = [];
    for (let i = 0; i < 12; i++) {
      existing.push({
        symbol: `T${i}`,
        sector: "tech",
        exposurePct: 0.0035,
        side: "LONG",
        returnSeries: genSeries(100 + i),
      });
    }
    const r = checkPreTradeRiskGate(proposal, existing, [0]);
    expect(r.verdict).toBe("block_sector");
    expect(r.blockingLayer).toBe("sector");
  });

  test("daily drawdown triggered → block_drawdown_window", () => {
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.003,
      side: "LONG",
      returnSeries: genSeries(1),
    };
    const pnl = [0.001, 0.001, 0.001, 0.001, -0.015]; // today -1.5% > 1% cap
    const r = checkPreTradeRiskGate(proposal, [], pnl);
    expect(r.verdict).toBe("block_drawdown_window");
    expect(r.blockingLayer).toBe("drawdown_window");
  });

  test("weekly rolling drawdown triggered → block_drawdown_window", () => {
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.003,
      side: "LONG",
      returnSeries: genSeries(1),
    };
    // Last 5 days: -0.5% each = -2.5% total, exceeds 2% weekly cap
    // (no single day exceeds 1% daily)
    const pnl = [-0.005, -0.005, -0.005, -0.005, -0.005];
    const r = checkPreTradeRiskGate(proposal, [], pnl);
    expect(r.verdict).toBe("block_drawdown_window");
    expect(r.blockingLayer).toBe("drawdown_window");
  });

  test("missing returnSeries on proposal with existing positions → data_gap", () => {
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.003,
      side: "LONG",
      // no returnSeries
    };
    const existing: ExistingPosition[] = [
      { symbol: "BBB", sector: "energy", exposurePct: 0.003, side: "LONG", returnSeries: genSeries(2) },
    ];
    const r = checkPreTradeRiskGate(proposal, existing, [0]);
    expect(r.verdict).toBe("data_gap");
    expect(r.blockingLayer).toBe("correlation");
  });

  test("empty PnL history → data_gap on drawdown layer", () => {
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.003,
      side: "LONG",
      returnSeries: genSeries(1),
    };
    const r = checkPreTradeRiskGate(proposal, [], []);
    expect(r.verdict).toBe("data_gap");
    expect(r.blockingLayer).toBe("drawdown_window");
  });

  test("no existing positions → correlation layer passes trivially", () => {
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.003,
      side: "LONG",
      returnSeries: genSeries(1),
    };
    const r = checkPreTradeRiskGate(proposal, [], [0, 0, 0]);
    expect(r.verdict).toBe("allow");
    const corrLayer = r.layers.find((l) => l.layer === "correlation")!;
    expect(corrLayer.status).toBe("passed");
  });

  test("uncorrelated existing position does not trigger cluster", () => {
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.003,
      side: "LONG",
      returnSeries: genSeries(1),
    };
    // Use a different seed → uncorrelated series; small exposures keep
    // cluster under cap even if correlation by chance exceeds threshold.
    const existing: ExistingPosition[] = [
      {
        symbol: "BBB",
        sector: "energy",
        exposurePct: 0.003,
        side: "LONG",
        returnSeries: genSeries(99999),
      },
    ];
    const r = checkPreTradeRiskGate(proposal, existing, [0, 0, 0]);
    // Even if the two random series are correlated by chance, cluster
    // 0.003 + 0.003 = 0.006 < 0.0075 cap. Verdict should be allow.
    expect(r.verdict).toBe("allow");
  });

  test("priority: data_gap supersedes any blocked layer", () => {
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.02, // would block on position size
      side: "LONG",
      // missing returnSeries
    };
    const existing: ExistingPosition[] = [
      { symbol: "BBB", sector: "energy", exposurePct: 0.003, side: "LONG", returnSeries: genSeries(2) },
    ];
    const r = checkPreTradeRiskGate(proposal, existing, []);
    expect(r.verdict).toBe("data_gap");
  });

  test("layers always reported in fixed order", () => {
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.003,
      side: "LONG",
      returnSeries: genSeries(1),
    };
    const r = checkPreTradeRiskGate(proposal, [], [0, 0, 0]);
    expect(r.layers.map((l) => l.layer)).toEqual([
      "position_size",
      "correlation",
      "sector",
      "drawdown_window",
    ]);
  });

  test("custom thresholds change verdict", () => {
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.003,
      side: "LONG",
      returnSeries: genSeries(1),
    };
    const def = checkPreTradeRiskGate(proposal, [], [0, 0, 0]);
    expect(def.verdict).toBe("allow");
    const strict = checkPreTradeRiskGate(proposal, [], [0, 0, 0], {
      maxPerTradeRiskPct: 0.001,
    });
    expect(strict.verdict).toBe("block_position_size");
  });

  test("counterfactual: sector cap blocks even though everything else passes", () => {
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.004,
      side: "LONG",
      returnSeries: genSeries(1),
    };
    const existing: ExistingPosition[] = [
      { symbol: "T1", sector: "tech", exposurePct: 0.038, side: "LONG", returnSeries: genSeries(99) },
    ];
    const r = checkPreTradeRiskGate(proposal, existing, [0, 0, 0]);
    expect(r.verdict).toBe("block_sector");
  });
});

describe("formatPreTradeRiskGate", () => {
  test("renders verdict + per-layer status", () => {
    const proposal: TradeProposal = {
      symbol: "AAA",
      sector: "tech",
      exposurePct: 0.003,
      side: "LONG",
      returnSeries: genSeries(1),
    };
    const r = checkPreTradeRiskGate(proposal, [], [0, 0, 0]);
    const text = formatPreTradeRiskGate(r);
    expect(text).toContain("Pre-Trade Risk Layer Gate");
    expect(text).toContain("position_size");
    expect(text).toContain("correlation");
    expect(text).toContain("sector");
    expect(text).toContain("drawdown_window");
  });
});
