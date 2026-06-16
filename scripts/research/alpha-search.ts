/**
 * Systematic alpha-search harness — the core research tool.
 *
 * Sweeps every registered strategy × param grid × tradeable instrument through
 * Gordon's competition money-path (`runCompetitionDryRun`, maker execution,
 * per-instrument median-spread + 1bps cost), under a WALK-FORWARD evaluation
 * (rolling IS/OOS folds), then ranks the survivors with statistical RIGOR using
 * Gordon's OWN anti-overfitting infra (`deflatedSharpeRatio` / `probabilisticSharpeRatio`
 * from `infra/trading/ops/backtestCredibility.ts`).
 *
 * The honest framing: we test MANY (strategy,config,instrument) combinations, so
 * the best raw OOS Sharpe is upward-biased by selection. A candidate only PASSES
 * if its OOS Sharpe is positive AND survives the deflated bar (corrected for the
 * effective number of trials) AND is stable across walk-forward folds. With one
 * month of M15 bars, the prior is that NOTHING clears the deflated bar — and the
 * tool is built to say that plainly rather than launder noise into a "winner".
 *
 * Run:  bun run scripts/research/alpha-search.ts
 *
 * Pure data + Gordon primitives; no I/O beyond reading the committed momq bars.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  runCompetitionDryRun,
  type DryRunSignal,
  type SignalFn,
} from "../../src/backtest/competition-dry-run.ts";
import {
  deflatedSharpeRatio,
  probabilisticSharpeRatio,
} from "../../src/infra/trading/ops/backtestCredibility.ts";
import { STRATEGY_REGISTRY, type ResearchBar, type StrategyFactory } from "./strategy-registry.ts";

// ── Config ──────────────────────────────────────────────────────────────────

const DATA_DIR = join(process.cwd(), "data", "momq");
// Default scope = the competition M15 bars. Override to re-test leads on more
// data (e.g. the extended multi-regime crypto history) without touching code:
//   ALPHA_BARS_DIR=data/momq/crypto-extended ALPHA_TF=1h bun run scripts/research/alpha-search.ts
const BARS_DIR = join(process.cwd(), process.env.ALPHA_BARS_DIR ?? join("data", "momq", "bars"));
const L2_DIR = join(DATA_DIR, "l2");
const MANIFEST = join(DATA_DIR, "manifest.json");
const TF = process.env.ALPHA_TF ?? "M15"; // bar-file suffix: M15 | 1h | 1d.

const STARTING_EQUITY = 100_000;
const EXTRA_COST_BPS = 1; // +1bps slippage on top of the per-instrument median spread.
// Bars/year for the chosen timeframe — drives vol annualization + PSR/DSR scaling.
const PERIODS_PER_YEAR =
  TF === "1d" ? 365 : TF === "1h" ? 365 * 24 : 365 * 24 * 4;

// Walk-forward: rolling folds. Each fold trains on `isFrac` then scores the
// following OOS block. We DON'T re-fit per fold (the param grid is the search) —
// the folds measure OOS stability of a FIXED config, which is what we rank on.
const N_FOLDS = 4;
const IS_FRAC = 0.5; // anchor window each fold uses the first half + a growing block.

// ── Raw bar shapes from disk ────────────────────────────────────────────────

interface RawBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  spread: number; // fraction of price
}
interface RawL2 {
  time: number;
  imbalance: number;
}
interface ManifestInstrument {
  symbol: string;
  bars: number;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1]! + s[m]!) / 2 : s[m]!;
}

/** Annualized realized vol (fraction) from a close series, for the sizer's vol-target. */
function annualizedVol(closes: number[]): number {
  if (closes.length < 3) return 0.2;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    if (prev > 0) rets.push(closes[i]! / prev - 1);
  }
  if (rets.length < 2) return 0.2;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  let acc = 0;
  for (const r of rets) acc += (r - m) ** 2;
  const perBar = Math.sqrt(acc / rets.length);
  return perBar * Math.sqrt(PERIODS_PER_YEAR);
}

interface LoadedInstrument {
  symbol: string;
  bars: ResearchBar[];
  medianSpreadBps: number;
  hasL2: boolean;
}

function loadInstrument(symbol: string): LoadedInstrument | null {
  const barPath = join(BARS_DIR, `${symbol}_${TF}.json`);
  if (!existsSync(barPath)) return null;
  const raw = readJson<RawBar[]>(barPath).filter((b) => Number.isFinite(b.close) && b.close > 0);
  if (raw.length < 60) return null;

  // Annualized vol is computed on a trailing window so the sizer adapts; here we
  // use a single full-series estimate (the dry-run re-marks vol per bar from this).
  const closes = raw.map((b) => b.close);
  const volAnnual = annualizedVol(closes);

  // Per-instrument median spread (fraction of price) → bps.
  const spreads = raw.map((b) => b.spread).filter((s) => Number.isFinite(s) && s > 0);
  const medianSpreadFrac = median(spreads);
  const medianSpreadBps = medianSpreadFrac * 10_000;

  // L2 imbalance aligned by time, if present.
  const l2Path = join(L2_DIR, `${symbol}_${TF}.json`);
  let imbalanceByTime: Map<number, number> | null = null;
  if (existsSync(l2Path)) {
    imbalanceByTime = new Map();
    for (const r of readJson<RawL2[]>(l2Path)) {
      if (Number.isFinite(r.imbalance)) imbalanceByTime.set(r.time, r.imbalance);
    }
  }

  const bars: ResearchBar[] = raw.map((b) => ({
    symbol,
    time: b.time * 1000, // momq stores seconds; dry-run uses ms epoch for day boundaries.
    close: b.close,
    open: b.open,
    high: b.high,
    low: b.low,
    volAnnual,
    imbalance: imbalanceByTime?.get(b.time),
  }));

  return {
    symbol,
    bars,
    medianSpreadBps,
    hasL2: imbalanceByTime !== null,
  };
}

// ── Per-run scoring through the money-path ──────────────────────────────────

interface RunMetrics {
  oosReturnPct: number;
  oosSharpe15m: number; // non-annualized 15m Sharpe (the competition metric)
  oosSharpeAnnual: number;
  maxDrawdownPct: number;
  trades: number;
  /** Per-bar equity returns over the OOS segment (feeds deflated/PSR). */
  barReturns: number[];
}

function barReturnsFromEquity(equity: { equity: number }[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1]!.equity;
    if (prev > 0) out.push(equity[i]!.equity / prev - 1);
  }
  return out;
}

function nonAnnualizedSharpe(rets: number[]): number {
  if (rets.length < 2) return 0;
  const m = rets.reduce((a, b) => a + b, 0) / rets.length;
  let acc = 0;
  for (const r of rets) acc += (r - m) ** 2;
  const sd = Math.sqrt(acc / (rets.length - 1));
  if (!(sd > 0)) return 0;
  return m / sd;
}

/** Run the dry-run over a bar slice and pull OOS metrics. */
function scoreSegment(
  bars: ResearchBar[],
  signal: SignalFn,
  spreadBps: number,
): RunMetrics {
  const report = runCompetitionDryRun({
    bars,
    signal,
    startingEquity: STARTING_EQUITY,
    execution: "maker",
    costs: { spreadBps, slippageBps: EXTRA_COST_BPS },
    periodsPerYear: PERIODS_PER_YEAR,
  });
  const barReturns = barReturnsFromEquity(report.equityCurve);
  return {
    oosReturnPct: report.totalReturnPct,
    oosSharpe15m: nonAnnualizedSharpe(barReturns),
    oosSharpeAnnual: report.sharpe,
    maxDrawdownPct: report.maxDrawdownPct,
    trades: report.tradeCount,
    barReturns,
  };
}

// ── Walk-forward: rolling OOS folds ─────────────────────────────────────────

interface WalkForwardOutcome {
  /** OOS metrics on the held-out tail (the primary scored segment). */
  oos: RunMetrics;
  /** Per-fold OOS 15m Sharpe across rolling folds → stability. */
  foldSharpes: number[];
  foldSharpeMean: number;
  foldSharpeStd: number;
  /** Concatenated OOS bar-returns across folds — the deflated/PSR sample. */
  pooledOosReturns: number[];
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  let acc = 0;
  for (const x of xs) acc += (x - m) ** 2;
  return Math.sqrt(acc / (xs.length - 1));
}

/**
 * Rolling walk-forward, single-pass. The maker dry-run is one forward pass over
 * the bars, so we run it ONCE on the full series and derive the held-out OOS
 * segment + the N_FOLDS rolling OOS blocks by SLICING the resulting equity-curve
 * bar-returns. The back half (after IS_FRAC) is the held-out OOS region; it is
 * split into N_FOLDS contiguous blocks whose per-block Sharpe gives stability,
 * and whose concatenation (the whole OOS tail) feeds the deflated-Sharpe test.
 *
 * This is honest OOS in the walk-forward sense: a FIXED config (the param grid is
 * the search — no per-fold refit) is scored on data after the in-sample warmup,
 * and we measure both its pooled OOS Sharpe and its block-to-block stability.
 */
function walkForward(bars: ResearchBar[], factory: StrategyFactory, params: Record<string, unknown>, spreadBps: number): WalkForwardOutcome {
  const n = bars.length;
  const signal = factory.build(params);
  const full = scoreSegment(bars, signal, spreadBps);

  // equityCurve has one point per bar; barReturns has length (#bars − 1). Map the
  // bar index `isEnd` onto the return index it begins at.
  const isEnd = Math.floor(n * IS_FRAC);
  const retOffset = Math.max(0, isEnd - 1);
  const oosReturns = full.barReturns.slice(retOffset);

  const foldSharpes: number[] = [];
  const pooledOosReturns: number[] = [];
  const oosBlock = Math.max(20, Math.floor(oosReturns.length / N_FOLDS));

  for (let f = 0; f < N_FOLDS; f++) {
    const start = f * oosBlock;
    const end = f === N_FOLDS - 1 ? oosReturns.length : start + oosBlock;
    const block = oosReturns.slice(start, end);
    if (block.length < 2) continue;
    foldSharpes.push(nonAnnualizedSharpe(block));
    for (const r of block) pooledOosReturns.push(r);
  }

  const oosMetrics: RunMetrics = {
    ...full,
    oosSharpe15m: nonAnnualizedSharpe(oosReturns),
    barReturns: oosReturns,
  };

  return {
    oos: oosMetrics,
    foldSharpes,
    foldSharpeMean: foldSharpes.length ? foldSharpes.reduce((a, b) => a + b, 0) / foldSharpes.length : 0,
    foldSharpeStd: std(foldSharpes),
    pooledOosReturns,
  };
}

// ── Result rows + ranking ───────────────────────────────────────────────────

interface ResultRow {
  strategyId: string;
  family: string;
  symbol: string;
  params: Record<string, unknown>;
  trades: number;
  oosReturnPct: number;
  oosSharpe15m: number;
  oosSharpeAnnual: number;
  maxDrawdownPct: number;
  foldSharpeMean: number;
  foldSharpeStd: number;
  /** Fraction of folds with positive OOS Sharpe — stability proxy. */
  foldPositiveFrac: number;
  /** PSR on pooled OOS returns (vs 0 benchmark). */
  psr: number;
  /** Deflated Sharpe (corrected for total trials). */
  dsr: number;
  /** Annualized observed Sharpe from the DSR test. */
  observedSharpeAnnual: number;
  expectedMaxNullSharpe: number;
  verdict: "PASS" | "marginal" | "FAIL";
}

function classify(row: Omit<ResultRow, "verdict">): ResultRow["verdict"] {
  const stable = row.foldPositiveFrac >= 0.75 && row.foldSharpeMean > 0;
  if (row.oosSharpe15m > 0 && row.dsr > 0.95 && row.psr > 0.95 && stable) return "PASS";
  if (row.oosSharpe15m > 0 && (row.psr > 0.9 || row.dsr > 0.5) && row.foldPositiveFrac >= 0.5) return "marginal";
  return "FAIL";
}

function fmt(x: number, d = 3): string {
  if (!Number.isFinite(x)) return "n/a";
  return x.toFixed(d);
}

// ── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  // Symbol universe: the momq manifest when present; otherwise derive it from the
  // bar files in BARS_DIR (the extended-data dirs ship no manifest).
  let symbols: string[];
  if (existsSync(MANIFEST) && BARS_DIR.endsWith(join("data", "momq", "bars"))) {
    symbols = readJson<{ instruments: ManifestInstrument[] }>(MANIFEST).instruments.map((i) => i.symbol);
  } else {
    const suffix = `_${TF}.json`;
    symbols = readdirSync(BARS_DIR)
      .filter((f) => f.endsWith(suffix))
      .map((f) => f.slice(0, -suffix.length))
      .sort();
  }

  const instruments: LoadedInstrument[] = [];
  for (const sym of symbols) {
    const loaded = loadInstrument(sym);
    if (loaded) instruments.push(loaded);
  }

  const totalConfigs = STRATEGY_REGISTRY.reduce((a, s) => a + s.paramGrid.length, 0);
  // Effective number of trials for the multiple-testing correction: every
  // (config × instrument) combination that could have produced the "winner".
  const effectiveTrials = totalConfigs * instruments.length;

  console.log("=".repeat(78));
  console.log("SYSTEMATIC ALPHA SEARCH — Gordon signal library, walk-forward + deflated Sharpe");
  console.log("=".repeat(78));
  console.log(`Instruments loaded : ${instruments.length} (${instruments.map((i) => i.symbol).join(", ")})`);
  console.log(`Strategies         : ${STRATEGY_REGISTRY.length}`);
  console.log(`Configs (params)   : ${totalConfigs}`);
  console.log(`Search cells       : ${effectiveTrials} (configs × instruments)`);
  console.log(`Execution          : maker, per-instrument median spread + ${EXTRA_COST_BPS}bps`);
  console.log(`Walk-forward       : ${N_FOLDS} rolling OOS folds over the back ${(100 * (1 - IS_FRAC)).toFixed(0)}%`);
  console.log(`Bars/instrument    : ${median(instruments.map((i) => i.bars.length))} median`);
  console.log("");

  const rows: ResultRow[] = [];

  for (const factory of STRATEGY_REGISTRY) {
    for (const params of factory.paramGrid) {
      for (const inst of instruments) {
        // Skip L2 strategies on instruments without L2.
        if (factory.inputs === "l2" && !inst.hasL2) continue;

        let wf: WalkForwardOutcome;
        try {
          wf = walkForward(inst.bars, factory, params, inst.medianSpreadBps);
        } catch {
          continue;
        }

        const pooled = wf.pooledOosReturns;
        if (pooled.length < 10) continue;

        const psr = probabilisticSharpeRatio(pooled, 0, PERIODS_PER_YEAR);
        const dsr = deflatedSharpeRatio(pooled, effectiveTrials, PERIODS_PER_YEAR);

        const foldPositiveFrac = wf.foldSharpes.length
          ? wf.foldSharpes.filter((s) => s > 0).length / wf.foldSharpes.length
          : 0;

        const base: Omit<ResultRow, "verdict"> = {
          strategyId: factory.id,
          family: factory.family,
          symbol: inst.symbol,
          params,
          trades: wf.oos.trades,
          oosReturnPct: wf.oos.oosReturnPct,
          oosSharpe15m: wf.oos.oosSharpe15m,
          oosSharpeAnnual: wf.oos.oosSharpeAnnual,
          maxDrawdownPct: wf.oos.maxDrawdownPct,
          foldSharpeMean: wf.foldSharpeMean,
          foldSharpeStd: wf.foldSharpeStd,
          foldPositiveFrac,
          psr: psr.psr,
          dsr: dsr.dsr,
          observedSharpeAnnual: dsr.observedSharpe,
          expectedMaxNullSharpe: dsr.expectedMaxSharpeUnderNull,
        };
        rows.push({ ...base, verdict: classify(base) });
      }
    }
  }

  // Rank: PASS first, then by deflated-Sharpe, then by pooled OOS Sharpe.
  const verdictRank = { PASS: 0, marginal: 1, FAIL: 2 } as const;
  rows.sort((a, b) => {
    if (verdictRank[a.verdict] !== verdictRank[b.verdict]) return verdictRank[a.verdict] - verdictRank[b.verdict];
    if (b.dsr !== a.dsr) return b.dsr - a.dsr;
    return b.oosSharpe15m - a.oosSharpe15m;
  });

  const passes = rows.filter((r) => r.verdict === "PASS");
  const marginals = rows.filter((r) => r.verdict === "marginal");

  console.log(`Total (strategy×config×instrument) cells evaluated : ${rows.length}`);
  console.log(`Expected-max Sharpe under null (annualized, ${effectiveTrials} trials) : ${fmt(rows[0]?.expectedMaxNullSharpe ?? 0, 2)}`);
  console.log("");

  // Top candidates table.
  const TOP = 20;
  console.log(`TOP ${TOP} CANDIDATES (ranked by verdict → deflated Sharpe → OOS Sharpe)`);
  console.log("-".repeat(78));
  const head = [
    "strategy".padEnd(22),
    "symbol".padEnd(8),
    "trd".padStart(4),
    "oosSh".padStart(7),
    "rawShA".padStart(7),
    "PSR".padStart(5),
    "DSR".padStart(5),
    "fold+".padStart(5),
    "verdict".padStart(8),
  ].join(" ");
  console.log(head);
  for (const r of rows.slice(0, TOP)) {
    console.log([
      r.strategyId.padEnd(22),
      r.symbol.padEnd(8),
      String(r.trades).padStart(4),
      fmt(r.oosSharpe15m, 3).padStart(7),
      fmt(r.observedSharpeAnnual, 2).padStart(7),
      fmt(r.psr, 2).padStart(5),
      fmt(r.dsr, 2).padStart(5),
      fmt(r.foldPositiveFrac, 2).padStart(5),
      r.verdict.padStart(8),
    ].join(" "));
  }
  console.log("");

  // Per-strategy aggregate: how many cells passed/were marginal, best DSR.
  console.log("PER-STRATEGY SUMMARY");
  console.log("-".repeat(78));
  console.log(["strategy".padEnd(22), "cells".padStart(6), "pass".padStart(5), "marg".padStart(5), "bestDSR".padStart(8), "bestOOSsh".padStart(10)].join(" "));
  for (const factory of STRATEGY_REGISTRY) {
    const cells = rows.filter((r) => r.strategyId === factory.id);
    if (cells.length === 0) continue;
    const p = cells.filter((r) => r.verdict === "PASS").length;
    const m = cells.filter((r) => r.verdict === "marginal").length;
    const bestDsr = Math.max(...cells.map((r) => r.dsr));
    const bestOos = Math.max(...cells.map((r) => r.oosSharpe15m));
    console.log([
      factory.id.padEnd(22),
      String(cells.length).padStart(6),
      String(p).padStart(5),
      String(m).padStart(5),
      fmt(bestDsr, 2).padStart(8),
      fmt(bestOos, 3).padStart(10),
    ].join(" "));
  }
  console.log("");

  // Verdict.
  console.log("=".repeat(78));
  console.log("VERDICT");
  console.log("=".repeat(78));
  if (passes.length > 0) {
    console.log(`${passes.length} (strategy,config,instrument) cell(s) CLEARED the deflated bar:`);
    for (const r of passes.slice(0, 10)) {
      console.log(`  • ${r.strategyId} on ${r.symbol} ${JSON.stringify(r.params)} — ` +
        `OOS 15m Sharpe ${fmt(r.oosSharpe15m, 3)}, DSR ${fmt(r.dsr, 3)}, PSR ${fmt(r.psr, 3)}, ` +
        `fold+ ${fmt(r.foldPositiveFrac, 2)}`);
    }
    console.log("");
    console.log("CAUTION: even a 'PASS' on ~1 month of M15 bars is provisional. Re-test OOS on");
    console.log("a fresh window before allocating — the deflated bar controls selection bias,");
    console.log("not regime change or the small absolute sample.");
  } else {
    console.log("NOTHING cleared the deflated bar.");
    console.log("");
    console.log(`Across ${rows.length} (strategy×config×instrument) cells and ${effectiveTrials} effective trials,`);
    console.log("not one candidate showed an OOS 15-minute Sharpe that survives the multiple-");
    console.log("testing correction (deflated Sharpe > 0.95) AND was stable across walk-forward");
    console.log("folds. This is the EXPECTED result for ~1 month of M15 data: the best raw Sharpe");
    console.log("is consistent with noise once you account for how many strategies were tried.");
    if (marginals.length > 0) {
      console.log("");
      console.log(`${marginals.length} cell(s) were 'marginal' (positive OOS Sharpe + decent PSR, but did not`);
      console.log("clear the deflated bar). Treat these as leads to re-test on more data, NOT edges:");
      for (const r of marginals.slice(0, 8)) {
        console.log(`  • ${r.strategyId} on ${r.symbol} — OOS Sharpe ${fmt(r.oosSharpe15m, 3)}, ` +
          `PSR ${fmt(r.psr, 2)}, DSR ${fmt(r.dsr, 2)}, fold+ ${fmt(r.foldPositiveFrac, 2)}`);
      }
    }
  }
  console.log("");
}

main();
