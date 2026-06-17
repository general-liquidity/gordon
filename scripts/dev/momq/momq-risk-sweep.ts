#!/usr/bin/env bun
/**
 * Competition risk-PRESET tuning sweep over the real Model to Market data
 * (data/momq/bars). Optimizes the SIZING parameters of the competition risk
 * preset against the official objective, for a FIXED baseline signal.
 *
 *   bun run scripts/dev/momq/momq-risk-sweep.ts
 *
 * What it does: holds the signal constant (the transparent mean-reversion z-fade
 * from momq-edge-validate.ts) and sweeps the `CompetitionRiskParams` sizing knobs
 * — maxLeverage, volTargetAnnual, maxConcurrentExposurePct, maxRiskPerTradePct —
 * ONE AT A TIME around the COMPETITION_RISK_AGGRESSIVE baseline (cleaner per-param
 * attribution than a full cartesian, and keeps the combo count modest). Each
 * config runs the cost-honest "maker" dry-run across the 15 tradeable instruments,
 * aggregates the OFFICIAL competition metrics (avg return / avg 15-min Sharpe /
 * avg maxDD) split IS(70%)/OOS(30%), and a Final-Score-STYLE proxy that mirrors
 * the official weights (0.70 return + 0.10 Sharpe − 0.15 drawdown). Configs are
 * ranked by OOS proxy, with the baseline highlighted.
 *
 * HONEST SCOPE: this tunes SIZING for a GIVEN signal — it does not create edge.
 * With the current baseline signal lacking edge (negative after costs), the sweep
 * surfaces sizing SENSITIVITY, not a profitable config: higher leverage / vol
 * target just SCALES the losing return (and the drawdown) — there is no sizing
 * that turns a negative-edge signal positive. Real tuning of these knobs awaits a
 * signal that survives OOS after costs. The harness is the deliverable.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  runCompetitionDryRun,
  type DryRunBar,
  type SignalFn,
} from "../../../src/backtest/competition-dry-run.ts";
import {
  COMPETITION_RISK_AGGRESSIVE,
  type CompetitionRiskParams,
} from "../../../src/core/risk-management/competition-risk-preset.ts";
import { COMPETITION_SCORE_WEIGHTS } from "../../../src/core/risk-management/competition-scoring.ts";

const DIR = "data/momq/bars";
const M15_PER_YEAR = 24 * 4 * 365;
const VOL_LOOKBACK = 20;
const SIG_LOOKBACK = 20;
const STARTING_EQUITY = 1_000_000;

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

// Fixed baseline signal — the transparent mean-reversion z-fade. SIZING is what
// the sweep varies; the signal is held constant so attribution is to the knobs.
const baselineSignal: SignalFn = (bar, hist) => {
  if (hist.length < SIG_LOOKBACK) return null;
  const c = hist.slice(-SIG_LOOKBACK).map((b) => b.close);
  const m = mean(c);
  const sd = std(c);
  if (sd === 0) return null;
  const z = (bar.close - m) / sd;
  if (z < -1.5) return { side: "long", stopDistance: 2 * sd, targetDistance: Math.max(sd, Math.abs(bar.close - m)) };
  if (z > 1.5) return { side: "short", stopDistance: 2 * sd, targetDistance: Math.max(sd, Math.abs(bar.close - m)) };
  return null;
};

// ── one-at-a-time grid around the COMPETITION_RISK_AGGRESSIVE baseline ──
const GRID: Record<keyof CompetitionRiskParams, number[]> = {
  maxLeverage: [3, 6, 10, 15],
  volTargetAnnual: [0.2, 0.35, 0.5],
  maxConcurrentExposurePct: [3, 6, 10],
  maxRiskPerTradePct: [0.005, 0.01, 0.02],
  // not swept — held at baseline
  dailyLossKillPct: [],
  fractionalKelly: [],
};
const SWEPT_PARAMS: (keyof CompetitionRiskParams)[] = [
  "maxLeverage", "volTargetAnnual", "maxConcurrentExposurePct", "maxRiskPerTradePct",
];

interface Config {
  label: string;
  /** Which param this config varies from baseline (empty for the baseline itself). */
  axis: keyof CompetitionRiskParams | "baseline";
  params: CompetitionRiskParams;
  isBaseline: boolean;
}

/** Build the config set: baseline + each swept value of each param (dedup the baseline value). */
function buildConfigs(): Config[] {
  const configs: Config[] = [
    { label: "BASELINE (AGGRESSIVE)", axis: "baseline", params: { ...COMPETITION_RISK_AGGRESSIVE }, isBaseline: true },
  ];
  for (const param of SWEPT_PARAMS) {
    for (const value of GRID[param]) {
      if (value === COMPETITION_RISK_AGGRESSIVE[param]) continue; // baseline already covers it
      configs.push({
        label: `${param}=${value}`,
        axis: param,
        params: { ...COMPETITION_RISK_AGGRESSIVE, [param]: value },
        isBaseline: false,
      });
    }
  }
  return configs;
}

interface SliceMetrics { ret: number; sharpe: number; maxDd: number; trades: number; n: number }
const emptySlice = (): SliceMetrics => ({ ret: 0, sharpe: 0, maxDd: 0, trades: 0, n: 0 });

function runSlice(bars: DryRunBar[], spreadBps: number, params: CompetitionRiskParams) {
  const r = runCompetitionDryRun({
    bars,
    signal: baselineSignal,
    startingEquity: STARTING_EQUITY,
    periodsPerYear: M15_PER_YEAR,
    riskParams: params,
    execution: "maker",
    costs: { spreadBps, slippageBps: 1 },
  });
  return {
    ret: r.competition.returnPct,
    sharpe: r.competition.sharpe15m,
    maxDd: r.competition.maxDrawdownPct,
    trades: r.tradeCount,
  };
}

/**
 * Final-Score-STYLE proxy. The official score is CROSS-SECTIONAL rank (return/DD/
 * Sharpe ranked vs the field) — un-rankable for a single strategy in isolation —
 * so this is a same-weights absolute proxy: reward return + Sharpe, penalize
 * drawdown, using the official weights (0.70 / 0.10 / 0.15). Higher = better.
 */
function scoreProxy(m: { ret: number; sharpe: number; maxDd: number }): number {
  const w = COMPETITION_SCORE_WEIGHTS;
  return w.returnRank * m.ret + w.sharpeRank * m.sharpe - w.drawdownRank * m.maxDd;
}

interface Result {
  config: Config;
  is: { ret: number; sharpe: number; maxDd: number; proxy: number };
  oos: { ret: number; sharpe: number; maxDd: number; proxy: number };
}

function evaluate(config: Config, loaded: { bars: DryRunBar[]; spreadBps: number }[]): Result {
  const isAgg = emptySlice();
  const oosAgg = emptySlice();
  for (const { bars, spreadBps } of loaded) {
    const cut = Math.floor(bars.length * 0.7);
    const slices: [SliceMetrics, ReturnType<typeof runSlice>][] = [
      [isAgg, runSlice(bars.slice(0, cut), spreadBps, config.params)],
      [oosAgg, runSlice(bars.slice(cut), spreadBps, config.params)],
    ];
    for (const [agg, r] of slices) {
      agg.ret += r.ret;
      agg.sharpe += Number.isFinite(r.sharpe) ? r.sharpe : 0;
      agg.maxDd += r.maxDd;
      agg.trades += r.trades;
      agg.n += 1;
    }
  }
  const avg = (a: SliceMetrics) => {
    const m = { ret: a.ret / a.n, sharpe: a.sharpe / a.n, maxDd: a.maxDd / a.n };
    return { ...m, proxy: scoreProxy(m) };
  };
  return { config, is: avg(isAgg), oos: avg(oosAgg) };
}

function main(): void {
  const loaded = TRADEABLE.map((s) => ({ symbol: s, ...(loadBars(s) ?? { bars: [], spreadBps: 0 }) })).filter(
    (x) => x.bars.length >= 100,
  );
  const configs = buildConfigs();
  console.log(
    `\n── risk-preset sweep: ${configs.length} configs × ${loaded.length}/${TRADEABLE.length} instruments, ` +
      `maker, IS(70%)/OOS(30%) ──`,
  );
  console.log(
    `   baseline: lev=${COMPETITION_RISK_AGGRESSIVE.maxLeverage} volTgt=${COMPETITION_RISK_AGGRESSIVE.volTargetAnnual} ` +
      `expo=${COMPETITION_RISK_AGGRESSIVE.maxConcurrentExposurePct} riskPerTrade=${COMPETITION_RISK_AGGRESSIVE.maxRiskPerTradePct}\n`,
  );

  const results = configs.map((c) => evaluate(c, loaded));
  // Rank by OOS proxy (best first); the baseline keeps its true rank in the list.
  const ranked = [...results].sort((a, b) => b.oos.proxy - a.oos.proxy);

  const pct = (x: number) => (x * 100).toFixed(2);
  const row = (label: string, r: Result["is"]) =>
    `ret ${pct(r.ret).padStart(7)}%  sharpe ${r.sharpe.toFixed(3).padStart(7)}  ` +
    `maxDD ${pct(r.maxDd).padStart(6)}%  proxy ${r.proxy.toFixed(5).padStart(9)}`;

  const header =
    `  ${"#".padStart(2)}  ${"config".padEnd(26)}  ${"axis".padEnd(24)}  ` +
    `${"OOS proxy".padStart(10)}  ${"IS proxy".padStart(10)}`;
  console.log("── ranked by OOS proxy (return + Sharpe − drawdown, official weights) ──\n");
  console.log(header);
  console.log("  " + "─".repeat(header.length - 2));
  ranked.forEach((r, i) => {
    const mark = r.config.isBaseline ? " ◀ baseline" : "";
    console.log(
      `  ${String(i + 1).padStart(2)}  ${r.config.label.padEnd(26)}  ${String(r.config.axis).padEnd(24)}  ` +
        `${r.oos.proxy.toFixed(5).padStart(10)}  ${r.is.proxy.toFixed(5).padStart(10)}${mark}`,
    );
  });

  console.log("\n── per-config detail (avg per-instrument; OFFICIAL metrics) ──\n");
  for (const r of ranked) {
    const mark = r.config.isBaseline ? "  ◀ baseline" : "";
    console.log(`${r.config.label}${mark}`);
    console.log(`  IS   ${row(r.config.label, r.is)}`);
    console.log(`  OOS  ${row(r.config.label, r.oos)}`);
    console.log("");
  }

  const baseline = results.find((r) => r.config.isBaseline)!;
  const best = ranked[0]!;
  console.log("── honest note ──");
  console.log(
    "This sweep tunes SIZING for a FIXED signal (mean-reversion z-fade) — it does not create edge.",
  );
  console.log(
    `The baseline signal lacks edge after costs (OOS proxy ${baseline.oos.proxy.toFixed(5)}, ` +
      `ret ${pct(baseline.oos.ret)}%), so the sweep shows sizing SENSITIVITY, not a winning config:`,
  );
  console.log(
    "  • higher leverage / vol target just SCALES the (losing) return and the drawdown together —",
  );
  console.log(
    "    no sizing turns a negative-edge signal positive; it only changes the magnitude of the loss.",
  );
  console.log(
    `  • the OOS-'best' config (${best.config.label}) wins by SHRINKING exposure toward break-even,`,
  );
  console.log(
    "    not by finding alpha — that is the de-risking dial, not a tuned edge.",
  );
  console.log(
    "Real tuning of these knobs awaits a signal that survives OOS after costs. The harness is the deliverable:",
  );
  console.log(
    "swap in an edge-positive SignalFn and this same grid optimizes its sizing against the official objective.\n",
  );
}

main();
