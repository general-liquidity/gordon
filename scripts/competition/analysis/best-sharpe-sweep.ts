#!/usr/bin/env bun
/**
 * Best-Sharpe optimization sweep for the RV-reversion core (competition step 1 + 5).
 *
 * Sweeps the config of the LIVE `rvReversionCore` (continuous OU-proportional fade + maxPairs
 * cap) and scores every config on the COMPETITION'S EXACT objective — the non-annualized
 * 15-minute-equity Sharpe from `competition-scoring.ts` (§12.5/§17), plus max drawdown, total
 * return and the §17 ≥30-trade floor — under an IS(70%)/OOS(30%) split so we pick a ROBUST
 * config (small IS↔OOS gap), not the OOS-max (which overfits the one window we have).
 *
 * Faithful-to-live model: a portfolio of every within-cluster pair's log-ratio z-score,
 * continuous fade allocation (flat at |z|≤exitZ, full at |z|≥entryZ, sign = −sign(z)), the
 * `maxPairs` most-stretched held each bar, dollar-matched legs (perPairFraction per leg),
 * 5bps/side turnover cost. Aligned across the union 15-min timeline so the equity curve is
 * exactly what the venue would sample.
 *
 * Sharpe is INVARIANT to perPairFraction (scales mean & std equally) — so the Sharpe sweep is
 * over lookback / entryZ / exitZ / maxPairs; perPairFraction only sets return/DD MAGNITUDE +
 * gross leverage (a survival knob), reported separately at a fixed 0.03.
 *
 *   bun run scripts/competition/analysis/best-sharpe-sweep.ts
 *   ALPHA_BARS_DIR=data/momq/crypto-extended ALPHA_TF=1h bun run scripts/competition/analysis/best-sharpe-sweep.ts
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { computeNonAnnualizedSharpe, computeMaxDrawdown } from "../../../src/core/risk-management/competition-scoring.ts";
import { monteCarloPathRisk } from "../../../src/infra/trading/quant/pathRiskMonteCarlo.ts";

const BARS_DIR = join(process.cwd(), process.env.ALPHA_BARS_DIR ?? join("data", "momq", "bars"));
const TF = process.env.ALPHA_TF ?? "M15";
const IS_FRAC = 0.7;
const COST_BPS_PER_SIDE = Number(process.env.COST_BPS ?? 5);
// "cont" = continuous fade every bar (the live rvReversionCore); "disc" = discrete entry/exit
// hysteresis (the rehearsal) — flat→±1 at |z|≥entryZ, back to flat at |z|≤exitZ, no churn between.
const MODE = (process.env.RV_MODE ?? "cont") as "cont" | "disc" | "hard";
// "equal" = equal dollar per pair; "invvol" = inverse-vol (risk-parity) weights from the IS window.
const WEIGHT = (process.env.RV_WEIGHT ?? "equal") as "equal" | "invvol";
const PER_PAIR_FRACTION = 0.03; // magnitude knob (Sharpe-invariant); sets return/DD scale

// Correlated clusters — ratio reversion only makes sense WITHIN a cluster.
const ALL_CLUSTERS: Record<string, string[]> = {
  crypto: ["BTCUSD", "ETHUSD", "SOLUSD", "XRPUSD", "BARUSD"],
  metals: ["XAUUSD", "XAGUSD"],
};
// RV_CLUSTERS=crypto drops the metals pair (its own decision); default keeps both.
const CLUSTERS: Record<string, string[]> =
  (process.env.RV_CLUSTERS ?? "all") === "crypto" ? { crypto: ALL_CLUSTERS.crypto! } : ALL_CLUSTERS;

interface RawBar { time: number; close: number }
const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);

function loadCloseByTime(symbol: string): Map<number, number> | null {
  const path = join(BARS_DIR, `${symbol}_${TF}.json`);
  if (!existsSync(path)) return null;
  const raw = JSON.parse(readFileSync(path, "utf8")) as RawBar[];
  const m = new Map<number, number>();
  for (const b of raw) if (Number.isFinite(b.close) && b.close > 0) m.set(b.time, b.close);
  return m.size >= 120 ? m : null;
}

/** Aligned (times, logRatioSpread) for two symbols on common timestamps, chronological. */
function alignedSpread(a: Map<number, number>, b: Map<number, number>): { times: number[]; spread: number[] } {
  const pts: Array<[number, number]> = [];
  for (const [t, ca] of a) {
    const cb = b.get(t);
    if (cb !== undefined) pts.push([t, Math.log(ca) - Math.log(cb)]);
  }
  pts.sort((x, y) => x[0] - y[0]);
  return { times: pts.map((p) => p[0]), spread: pts.map((p) => p[1]) };
}

interface Config { lookback: number; entryZ: number; exitZ: number; maxPairs: number }

function fade(z: number, entryZ: number, exitZ: number): number {
  const denom = entryZ - exitZ;
  const mag = denom > 0 ? Math.min(Math.max((Math.abs(z) - exitZ) / denom, 0), 1) : Math.abs(z) >= entryZ ? 1 : 0;
  return -Math.sign(z) * mag;
}

interface PairSeries { label: string; times: number[]; spread: number[] }

interface PairDecision { z: number; alloc: number; dSNext: number } // signal, position to hold, next-bar move

/**
 * Per-bar z (sliding sample-std window), the position to HOLD, and the next-bar spread change.
 * `cont`: continuous fade alloc each bar (the live rvReversionCore). `disc`: a discrete
 * entry/exit hysteresis state machine (the rehearsal) — enters ±1 at |z|≥entryZ, holds until
 * |z|≤exitZ, so it does NOT churn (and pays cost) every bar.
 */
function pairDecisions(spread: number[], cfg: Config): (PairDecision | null)[] {
  const { lookback, entryZ, exitZ } = cfg;
  const n = spread.length;
  const out: (PairDecision | null)[] = new Array(n).fill(null);
  let sum = 0;
  let sumsq = 0;
  let pos = 0; // discrete state carried across bars
  for (let i = 0; i < n; i++) {
    sum += spread[i]!;
    sumsq += spread[i]! * spread[i]!;
    if (i >= lookback) {
      sum -= spread[i - lookback]!;
      sumsq -= spread[i - lookback]! * spread[i - lookback]!;
    }
    if (i >= lookback - 1) {
      const m = sum / lookback;
      const variance = (sumsq - sum * sum / lookback) / (lookback - 1);
      const sd = variance > 0 ? Math.sqrt(variance) : 0;
      if (sd > 0) {
        const z = (spread[i]! - m) / sd;
        if (MODE === "disc") {
          if (pos === 0) {
            if (z >= entryZ) pos = -1;
            else if (z <= -entryZ) pos = 1;
          } else if (pos === 1 && z > -exitZ) pos = 0;
          else if (pos === -1 && z < exitZ) pos = 0;
        }
        // "hard" = stateless low-churn: full fade only when |z|≥entryZ, else flat (no ramp,
        // no per-pair state — preserves the reconciliation loop's statelessness).
        const alloc =
          MODE === "disc" ? pos : MODE === "hard" ? (Math.abs(z) >= entryZ ? -Math.sign(z) : 0) : fade(z, entryZ, exitZ);
        const dSNext = i + 1 < n ? spread[i + 1]! - spread[i]! : 0;
        out[i] = { z, alloc, dSNext };
      }
    }
  }
  return out;
}

interface RunMetrics { sharpe: number; nObs: number; maxDD: number; totalReturn: number; trades: number }

/**
 * Portfolio backtest over the union timeline with the maxPairs cap applied per bar.
 * Returns the per-event-time portfolio return series (in chronological order) + trade count.
 */
function portfolioReturns(pairs: PairSeries[], cfg: Config, weights: number[]): { rets: number[]; trades: number } {
  const costFrac = (2 * COST_BPS_PER_SIDE) / 10_000; // both legs on a full alloc change
  // Events: time → list of {pairIdx, z, dSNext}.
  const events = new Map<number, Array<{ p: number; z: number; alloc: number; dSNext: number }>>();
  pairs.forEach((ps, p) => {
    const dec = pairDecisions(ps.spread, cfg);
    for (let i = 0; i < dec.length; i++) {
      const d = dec[i];
      if (!d) continue;
      const t = ps.times[i]!;
      let arr = events.get(t);
      if (!arr) events.set(t, (arr = []));
      arr.push({ p, z: d.z, alloc: d.alloc, dSNext: d.dSNext });
    }
  });
  const times = [...events.keys()].sort((a, b) => a - b);

  const prevAlloc = new Map<number, number>(); // pairIdx → held alloc last event
  const rets: number[] = [];
  let trades = 0;

  for (const t of times) {
    const arr = events.get(t)!;
    // Among pairs with a nonzero target, keep the maxPairs most-stretched (largest |z|).
    const active = arr.filter((e) => e.alloc !== 0).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
    const held = new Map<number, { alloc: number; dSNext: number }>();
    for (let k = 0; k < active.length && k < cfg.maxPairs; k++) {
      const e = active[k]!;
      held.set(e.p, { alloc: e.alloc, dSNext: e.dSNext });
    }
    // Turnover cost + trade count over the union of previously-held and now-held pairs.
    const touched = new Set<number>([...prevAlloc.keys(), ...held.keys()]);
    let turnover = 0;
    let grossRet = 0;
    for (const p of touched) {
      const prev = prevAlloc.get(p) ?? 0;
      const now = held.get(p)?.alloc ?? 0;
      turnover += (weights[p] ?? 1) * Math.abs(now - prev); // cost on the risk-weighted notional
      // a "trade" = entering from flat or flipping sign
      if ((prev === 0 && now !== 0) || (prev !== 0 && now !== 0 && Math.sign(now) !== Math.sign(prev))) trades++;
    }
    for (const [p, { alloc, dSNext }] of held) grossRet += (weights[p] ?? 1) * alloc * dSNext;
    // Both gross P&L and turnover cost are on the SAME per-pair notional (perPairFraction·equity),
    // so cost must scale by perPairFraction too — otherwise it's ~1/perPairFraction× too large.
    const ret = PER_PAIR_FRACTION * (grossRet - turnover * costFrac);
    rets.push(ret);

    prevAlloc.clear();
    for (const [p, v] of held) prevAlloc.set(p, v.alloc);
  }
  return { rets, trades };
}

/** Build an equity curve from per-bar returns and score on the EXACT competition metric. */
function score(rets: number[], trades: number): RunMetrics {
  const equity: number[] = [1];
  for (const r of rets) equity.push(equity[equity.length - 1]! * (1 + r));
  const { sharpe, nObs } = computeNonAnnualizedSharpe(equity);
  return {
    sharpe,
    nObs,
    maxDD: computeMaxDrawdown(equity),
    totalReturn: equity[equity.length - 1]! - 1,
    trades,
  };
}

function evalConfig(pairs: PairSeries[], cfg: Config, weights: number[]): { is: RunMetrics; oos: RunMetrics; full: RunMetrics } {
  const { rets, trades } = portfolioReturns(pairs, cfg, weights);
  const split = Math.floor(rets.length * IS_FRAC);
  // Trades attributed proportionally is wrong; recount per segment via a second pass is costly,
  // so approximate per-segment trades by the share of bars (the floor check uses the full count).
  const isShare = split / (rets.length || 1);
  return {
    is: score(rets.slice(0, split), Math.round(trades * isShare)),
    oos: score(rets.slice(split), trades - Math.round(trades * isShare)),
    full: score(rets, trades),
  };
}

function main(): void {
  // Load every symbol present, build within-cluster pairs.
  const closes = new Map<string, Map<number, number>>();
  for (const syms of Object.values(CLUSTERS)) {
    for (const s of syms) {
      const c = loadCloseByTime(s);
      if (c) closes.set(s, c);
    }
  }
  const pairs: PairSeries[] = [];
  for (const syms of Object.values(CLUSTERS)) {
    const present = syms.filter((s) => closes.has(s));
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const { times, spread } = alignedSpread(closes.get(present[i]!)!, closes.get(present[j]!)!);
        if (spread.length > 200) pairs.push({ label: `${present[i]!.replace("USD", "")}/${present[j]!.replace("USD", "")}`, times, spread });
      }
    }
  }

  // Inverse-vol (risk-parity) weights from the IS window — lower-vol pairs get more weight so no
  // single pair dominates portfolio variance. Causal: estimated on IS only, applied to the whole
  // series. "equal" → all 1. Normalized to mean 1 (Sharpe is scale-invariant; this keeps magnitude).
  const weights = (() => {
    if (WEIGHT === "equal") return pairs.map(() => 1);
    const vols = pairs.map((p) => {
      const split = Math.floor(p.spread.length * IS_FRAC);
      const ds: number[] = [];
      for (let i = 1; i < split; i++) ds.push(p.spread[i]! - p.spread[i - 1]!);
      const m = mean(ds);
      const v = ds.length > 1 ? Math.sqrt(ds.reduce((s, x) => s + (x - m) ** 2, 0) / (ds.length - 1)) : 0;
      return v > 0 ? v : 1e-9;
    });
    const inv = vols.map((v) => 1 / v);
    const meanInv = mean(inv);
    return inv.map((x) => x / meanInv);
  })();

  console.log("=".repeat(80));
  console.log(`BEST-SHARPE SWEEP — RV-reversion core | ${BARS_DIR.split(/[\\/]/).slice(-2).join("/")} ${TF} | mode ${MODE} | weight ${WEIGHT}`);
  console.log("=".repeat(80));
  console.log(`Pairs (${pairs.length}): ${pairs.map((p) => p.label).join(", ")}`);
  console.log(`Scored on the EXACT competition metric (non-annualized 15-min Sharpe), IS ${IS_FRAC * 100}% / OOS ${(1 - IS_FRAC) * 100}%.`);
  console.log("");

  // The Sharpe-relevant grid (perPairFraction is Sharpe-invariant → fixed).
  const LOOKBACKS = [24, 36, 48, 72, 96, 144];
  const ENTRY_ZS = [1.0, 1.25, 1.5, 2.0, 2.5];
  const EXIT_ZS = [0.0, 0.25, 0.5, 0.75];
  const MAX_PAIRS = [4, 6, 8, 11];

  interface Row { cfg: Config; is: RunMetrics; oos: RunMetrics; full: RunMetrics; robust: number }
  const rows: Row[] = [];
  for (const lookback of LOOKBACKS)
    for (const entryZ of ENTRY_ZS)
      for (const exitZ of EXIT_ZS) {
        if (exitZ >= entryZ) continue;
        for (const maxPairs of MAX_PAIRS) {
          const cfg = { lookback, entryZ, exitZ, maxPairs };
          const r = evalConfig(pairs, cfg, weights);
          // Robustness score: OOS Sharpe penalized by the IS↔OOS gap (overfit guard).
          const robust = r.oos.sharpe - 0.5 * Math.abs(r.is.sharpe - r.oos.sharpe);
          rows.push({ cfg, ...r, robust });
        }
      }

  const dds = rows.map((r) => Math.abs(r.full.maxDD)).sort((a, b) => a - b);
  const trs = rows.map((r) => r.full.trades).sort((a, b) => a - b);
  const shs = rows.map((r) => r.full.sharpe).sort((a, b) => a - b);
  const q = (xs: number[], p: number) => xs[Math.floor(p * (xs.length - 1))]!;
  console.log(`DIAG  maxDD min/med/max: ${(q(dds, 0) * 100).toFixed(2)}% / ${(q(dds, 0.5) * 100).toFixed(2)}% / ${(q(dds, 1) * 100).toFixed(2)}%`);
  console.log(`DIAG  trades min/med/max: ${q(trs, 0)} / ${q(trs, 0.5)} / ${q(trs, 1)}`);
  console.log(`DIAG  full Sharpe min/med/max: ${q(shs, 0).toFixed(4)} / ${q(shs, 0.5).toFixed(4)} / ${q(shs, 1).toFixed(4)}`);

  // DD cap is on the FULL backtest curve; on long multi-regime data set MAX_DD=1 to rank by
  // Sharpe/robustness (the comp-relevant DD is the 5-day survival MC below, not the full span).
  const maxDdCap = Number(process.env.MAX_DD ?? 0.05);
  const eligible = rows.filter((r) => r.full.trades >= 30 && Math.abs(r.full.maxDD) < maxDdCap);
  const fmt = (r: Row, sortKey: string) =>
    `  L${String(r.cfg.lookback).padStart(3)} e${r.cfg.entryZ.toFixed(2)} x${r.cfg.exitZ.toFixed(2)} p${String(r.cfg.maxPairs).padStart(2)} | ` +
    `OOS Sh ${r.oos.sharpe.toFixed(4).padStart(8)}  IS Sh ${r.is.sharpe.toFixed(4).padStart(8)}  robust ${r.robust.toFixed(4).padStart(8)} | ` +
    `DD ${(r.full.maxDD * 100).toFixed(2).padStart(5)}%  ret ${(r.full.totalReturn * 100).toFixed(2).padStart(7)}%  trades ${String(r.full.trades).padStart(5)}`;

  console.log(`Configs: ${rows.length} | eligible (≥30 trades, DD<5%): ${eligible.length}`);
  console.log("");
  console.log("TOP 12 by OOS Sharpe (optimistic — overfits the OOS window):");
  [...eligible].sort((a, b) => b.oos.sharpe - a.oos.sharpe).slice(0, 12).forEach((r) => console.log(fmt(r, "oos")));
  console.log("");
  console.log("TOP 12 by ROBUSTNESS (OOS Sharpe − ½·|IS−OOS| gap) — the config to actually run:");
  const byRobust = [...eligible].sort((a, b) => b.robust - a.robust);
  byRobust.slice(0, 12).forEach((r) => console.log(fmt(r, "robust")));
  console.log("");

  const best = byRobust[0];
  if (best) {
    console.log("=".repeat(80));
    console.log("RECOMMENDED CONFIG (most robust)");
    console.log("=".repeat(80));
    console.log(`  lookback ${best.cfg.lookback}, entryZ ${best.cfg.entryZ}, exitZ ${best.cfg.exitZ}, maxPairs ${best.cfg.maxPairs}`);
    console.log(`  IS  Sharpe ${best.is.sharpe.toFixed(4)} (n=${best.is.nObs}) | OOS Sharpe ${best.oos.sharpe.toFixed(4)} (n=${best.oos.nObs})`);
    console.log(`  full: maxDD ${(best.full.maxDD * 100).toFixed(2)}% | total ret ${(best.full.totalReturn * 100).toFixed(2)}% @ perPairFraction ${PER_PAIR_FRACTION} | trades ${best.full.trades}`);
    console.log("");
    // STEP 5 — per-pair OOS robustness under the recommended config (which pairs revert OOS).
    console.log("PER-PAIR OOS Sharpe under the recommended config (step 5 — which pairs carry it):");
    for (const ps of pairs) {
      const { rets, trades } = portfolioReturns([ps], best.cfg, [1]);
      const split = Math.floor(rets.length * IS_FRAC);
      const isM = score(rets.slice(0, split), 0);
      const oosM = score(rets.slice(split), 0);
      const flag = oosM.sharpe > 0 && isM.sharpe > 0 ? "✓" : oosM.sharpe <= 0 ? "✗ OOS≤0" : "~";
      console.log(`  ${ps.label.padEnd(14)} IS ${isM.sharpe.toFixed(3).padStart(7)}  OOS ${oosM.sharpe.toFixed(3).padStart(7)}  ${flag}`);
    }
    console.log("");
    console.log("");
    // STEP 3 — survival: 5-day (480×M15) path-risk MC on the recommended book's per-bar returns.
    const { rets } = portfolioReturns(pairs, best.cfg, weights);
    const LIVE_BARS = 5 * 24 * 4; // 480 M15 bars ≈ the 5-day live window
    const mc = monteCarloPathRisk(rets, "stationary", { nPaths: 5000, pathLen: LIVE_BARS, seed: 7, ruinDrawdown: 0.2 });
    const liveTradeRate = (best.full.trades * LIVE_BARS) / (rets.length || 1);
    console.log("STEP 3 — SURVIVAL (5-day path-risk MC, block-bootstrap, @ perPairFraction 0.03):");
    console.log(`  5-day max-DD  p50 ${(mc.drawdownP50 * 100).toFixed(2)}%  p95 ${(mc.drawdownP95 * 100).toFixed(2)}%  p99 ${(mc.drawdownP99 * 100).toFixed(2)}%  worst ${(mc.drawdownWorst * 100).toFixed(2)}%`);
    console.log(`  P(DD>20%) ${(mc.probRuin * 100).toFixed(2)}%  → forced-liquidation/elimination risk at this size is ${mc.probRuin < 0.01 ? "negligible" : "NON-trivial — cut size"}.`);
    console.log(`  est. live trades in 5d: ~${Math.round(liveTradeRate)} (§17 ≥30 floor: ${liveTradeRate >= 30 ? "CLEARS" : "AT RISK — widen entry less / add pairs"})`);
    console.log("");
    console.log(`NOTE: ${rows.length} configs tested → the OOS-max is multiple-testing-inflated; the robust pick`);
    console.log(`(small IS↔OOS gap) is the honest one. One regime of data ⇒ this calibrates curve SHAPE, not a return forecast.`);
    console.log(`ABSOLUTE Sharpe ≈ 0 after 5bps/side cost — the value is the RELATIVE rank: a smooth ${(best.full.maxDD * 100).toFixed(1)}%-DD curve`);
    console.log(`beats a field gambling for return rank (who tank their Sharpe + drawdown ranks). Cost (spread) is the binding constraint.`);
  } else {
    console.log("No config cleared the ≥30-trade + DD<5% floor — widen the grid or check the data.");
  }
}

main();
