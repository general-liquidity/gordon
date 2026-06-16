#!/usr/bin/env bun
/**
 * Short-term REVERSAL edge validation over the real Model to Market data
 * (data/momq/bars).
 *
 * Runs the `reversalSignal` primitive (src/core/alpha/reversal-strategy.ts) —
 * adapted into a dry-run SignalFn — through the cost-honest competition dry-run,
 * per tradeable instrument, in BOTH taker and maker execution, split into
 * in-sample (first 70%) and out-of-sample (last 30%), sweeping the reversal
 * lookback ∈ {7, 14, 21}. Reports avg return / non-annualized 15-min Sharpe (the
 * judged metric) / max-drawdown / instrument-wins / trade count per
 * (lookback × execution × slice), so the edge is only believed if it survives
 * out-of-sample AND after costs (especially as a maker).
 *
 *   bun run scripts/dev/momq-reversal-validate.ts
 *
 * Honest scope: ONE month of data + a SINGLE IS/OOS split is INDICATIVE, not
 * conclusive — and this is the pre-competition window, not the live week.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runCompetitionDryRun,
  type DryRunBar,
  type SignalFn,
} from "../../src/backtest/competition-dry-run.ts";
import { COMPETITION_RISK_AGGRESSIVE } from "../../src/core/risk-management/competition-risk-preset.ts";
import { reversalSignal } from "../../src/core/alpha/reversal-strategy.ts";

const DIR = "data/momq/bars";
const M15_PER_YEAR = 24 * 4 * 365;
const VOL_LOOKBACK = 20;
const LOOKBACKS = [7, 14, 21];

// The 15 competition-tradeable instruments (FX majors + gold/silver + 5 crypto).
const TRADEABLE = [
  "EURUSD", "GBPUSD", "USDCHF", "USDJPY", "USDCAD", "AUDUSD", "EURGBP", "EURCHF",
  "XAUUSD", "XAGUSD", "BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD",
];

interface RawBar { time: number; open: number; high: number; low: number; close: number; spread: number }

const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);
const std = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((v) => (v - m) ** 2)));
};

/** Load a symbol's bars → DryRunBar[] with a rolling realized-vol estimate per bar. */
function loadBars(symbol: string): { bars: DryRunBar[]; spreadBps: number } | null {
  let raw: RawBar[];
  try {
    raw = JSON.parse(readFileSync(join(DIR, `${symbol}_M15.json`), "utf8")) as RawBar[];
  } catch {
    return null;
  }
  if (raw.length < 100) return null;
  const bars: DryRunBar[] = raw.map((b, i) => {
    const start = Math.max(1, i - VOL_LOOKBACK + 1);
    const rets: number[] = [];
    for (let j = start; j <= i; j++) {
      const prev = raw[j - 1]!.close;
      if (prev > 0) rets.push(raw[j]!.close / prev - 1);
    }
    const volAnnual = Math.max(1e-4, std(rets) * Math.sqrt(M15_PER_YEAR));
    return { symbol, time: b.time * 1000, close: b.close, volAnnual };
  });
  const bpsList = raw.filter((b) => b.close > 0 && b.spread > 0).map((b) => (b.spread / b.close) * 10_000);
  bpsList.sort((a, b) => a - b);
  const spreadBps = bpsList.length ? bpsList[Math.floor(bpsList.length / 2)]! : 2;
  return { bars, spreadBps };
}

/** Adapt the pure `reversalSignal` primitive into a dry-run SignalFn at a given lookback. */
function makeReversalSignal(lookback: number): SignalFn {
  return (bar, hist) => {
    // History strictly before this bar plus the current close → the close series.
    const closes = hist.map((b) => b.close);
    closes.push(bar.close);
    if (closes.length < lookback) return null;
    const sig = reversalSignal(closes, { lookback, zThreshold: 1.0, stopMult: 2, targetMult: 1.5 });
    if (!sig) return null;
    return { side: sig.side, stopDistance: sig.stopDistance, targetDistance: sig.targetDistance };
  };
}

interface Agg { ret: number; sharpe: number; maxDd: number; trades: number; n: number; winInstr: number }
const emptyAgg = (): Agg => ({ ret: 0, sharpe: 0, maxDd: 0, trades: 0, n: 0, winInstr: 0 });

function runSlice(bars: DryRunBar[], signal: SignalFn, spreadBps: number, execution: "taker" | "maker") {
  const r = runCompetitionDryRun({
    bars,
    signal,
    startingEquity: 1_000_000,
    periodsPerYear: M15_PER_YEAR,
    riskParams: COMPETITION_RISK_AGGRESSIVE,
    execution,
    costs: { spreadBps, slippageBps: 1 },
  });
  return {
    ret: r.competition.returnPct,
    sharpe: r.competition.sharpe15m,
    maxDd: r.competition.maxDrawdownPct,
    trades: r.tradeCount,
  };
}

function main(): void {
  const loaded = TRADEABLE.map((s) => ({ symbol: s, ...(loadBars(s) ?? { bars: [], spreadBps: 0 }) })).filter(
    (x) => x.bars.length >= 100,
  );
  console.log(`\n── short-term reversal validation: ${loaded.length}/${TRADEABLE.length} instruments, IS(70%)/OOS(30%) ──\n`);

  const fmt = (a: Agg) =>
    `ret ${((a.ret / a.n) * 100).toFixed(2).padStart(7)}%  sharpe ${(a.sharpe / a.n).toFixed(3).padStart(7)}  ` +
    `maxDD ${((a.maxDd / a.n) * 100).toFixed(1).padStart(5)}%  win ${a.winInstr}/${a.n}  trades ${(a.trades / a.n).toFixed(0)}`;

  for (const lookback of LOOKBACKS) {
    const signal = makeReversalSignal(lookback);
    const aggs: Record<string, Agg> = {
      "taker IS": emptyAgg(), "taker OOS": emptyAgg(), "maker IS": emptyAgg(), "maker OOS": emptyAgg(),
    };
    for (const { bars, spreadBps } of loaded) {
      const cut = Math.floor(bars.length * 0.7);
      for (const exec of ["taker", "maker"] as const) {
        const slices: [string, ReturnType<typeof runSlice>][] = [
          [`${exec} IS`, runSlice(bars.slice(0, cut), signal, spreadBps, exec)],
          [`${exec} OOS`, runSlice(bars.slice(cut), signal, spreadBps, exec)],
        ];
        for (const [key, r] of slices) {
          const agg = aggs[key]!;
          agg.ret += r.ret;
          agg.sharpe += Number.isFinite(r.sharpe) ? r.sharpe : 0;
          agg.maxDd += r.maxDd;
          agg.trades += r.trades;
          agg.n += 1;
          if (r.ret > 0) agg.winInstr += 1;
        }
      }
    }
    console.log(`reversal lookback=${lookback}`);
    for (const [label, agg] of Object.entries(aggs)) console.log(`  ${label.padEnd(9)} ${fmt(agg)}`);
    console.log("");
  }

  console.log("(avg per-instrument; 15-min Sharpe = the competition metric; costs = per-instrument median spread + 1bps slippage)");
  console.log("CAVEATS: one pre-competition month of data + a single IS/OOS split is INDICATIVE, not conclusive.\n");
}

main();
